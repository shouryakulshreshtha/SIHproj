"""
Relay Freight Platform — Driver-Segment Matching Engine
========================================================
Rule-based (explainable) scoring model for assigning a driver to a
relay segment. This is intentionally NOT a black-box ML model for v1 —
matching decisions need to be explainable to ops/support when a driver
disputes an assignment, and there's no historical "correct match"
label to train against yet. Swap in a learned ranking model later once
real assignment-outcome data exists (see NOTE at bottom).

Scoring factors, mirroring what Rivigo's relay allocation considers:
  - corridor/zone fit          (does the driver run this route?)
  - recent driving load        (hours driven in the last 24h — fatigue)
  - segment-cap compliance     (hard exclude if it would breach the
                                 ~4.5hr per-segment driving cap)
  - rating                     (service quality signal)
  - cancellation history       (reliability signal)

Usage:
    python3 match_driver_segment.py --data-dir ./synthetic_data_large \
        --pickup-city Delhi --corridor Delhi Jaipur Ahmedabad \
        --weight-kg 5000 --request-time "2026-09-06T10:00:00"
"""

import argparse
from datetime import datetime, timedelta

import pandas as pd

# Tunable weights — sum doesn't need to be 1, only relative magnitude matters
WEIGHTS = {
    "corridor_fit": 0.35,
    "low_fatigue": 0.30,
    "rating": 0.20,
    "reliability": 0.15,
}

DAILY_DRIVING_CAP_MINUTES = 600  # ~10hr/day, standard hours-of-service style cap
SEGMENT_CAP_MINUTES = 270        # hard exclude if this segment would breach it


def recent_driving_minutes(driver_id, segments_df, as_of, window_hours=24):
    """Minutes this driver has already driven in the lookback window —
    the fatigue signal. In production this reads from live segment
    state; here it reads the synthetic segment history."""
    window_start = as_of - timedelta(hours=window_hours)
    mask = (
        (segments_df["driver_id"] == driver_id)
        & (pd.to_datetime(segments_df["started_at"]) >= window_start)
        & (pd.to_datetime(segments_df["started_at"]) <= as_of)
    )
    return segments_df.loc[mask, "estimated_minutes"].sum()


def corridor_fit_score(driver_zones, corridor_cities):
    """Fraction of the requested corridor's cities the driver already
    lists as a preferred zone — proxy for route familiarity."""
    if not isinstance(driver_zones, str):
        return 0.0
    driver_cities = set(driver_zones.split("|"))
    corridor_set = set(corridor_cities)
    if not corridor_set:
        return 0.0
    return len(driver_cities & corridor_set) / len(corridor_set)


def match_driver(pickup_city, corridor_cities, segment_distance_km, request_time,
                  drivers_df, segments_df, top_n=5, avg_speed_kmph=42):

    estimated_minutes = (segment_distance_km / avg_speed_kmph) * 60

    # segment itself exceeds what any single driver may legally drive —
    # this needs to be split into smaller relay legs upstream, not matched
    if estimated_minutes > SEGMENT_CAP_MINUTES:
        return pd.DataFrame(), estimated_minutes

    candidates = drivers_df.copy()
    candidates["minutes_driven_24h"] = candidates["id"].apply(
        lambda d: recent_driving_minutes(d, segments_df, request_time)
    )
    candidates["would_be_total_minutes"] = (
        candidates["minutes_driven_24h"] + estimated_minutes
    )

    # --- hard constraint: exclude, don't just penalize ---
    candidates = candidates[candidates["would_be_total_minutes"] <= DAILY_DRIVING_CAP_MINUTES]

    if candidates.empty:
        return pd.DataFrame(), estimated_minutes

    # --- soft scoring ---
    candidates["corridor_fit"] = candidates["preferred_zones"].apply(
        lambda z: corridor_fit_score(z, corridor_cities)
    )
    candidates["fatigue_ratio"] = candidates["minutes_driven_24h"] / DAILY_DRIVING_CAP_MINUTES
    candidates["low_fatigue_score"] = 1 - candidates["fatigue_ratio"]
    candidates["rating_score"] = (candidates["rating_avg"] - 1) / 4  # normalize 1-5 -> 0-1
    candidates["reliability_score"] = 1 / (1 + candidates["total_cancellations"])

    candidates["match_score"] = (
        WEIGHTS["corridor_fit"] * candidates["corridor_fit"]
        + WEIGHTS["low_fatigue"] * candidates["low_fatigue_score"]
        + WEIGHTS["rating"] * candidates["rating_score"]
        + WEIGHTS["reliability"] * candidates["reliability_score"]
    )

    ranked = candidates.sort_values("match_score", ascending=False).head(top_n)
    return ranked[[
        "id", "name", "match_score", "corridor_fit", "minutes_driven_24h",
        "rating_avg", "total_cancellations",
    ]], estimated_minutes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=str, default="./synthetic_data_large")
    parser.add_argument("--pickup-city", type=str, required=True)
    parser.add_argument("--corridor", type=str, nargs="+", required=True)
    parser.add_argument("--weight-kg", type=float, required=True)
    parser.add_argument("--distance-km", type=float, default=300.0)
    parser.add_argument("--request-time", type=str, default=None)
    parser.add_argument("--top-n", type=int, default=5)
    args = parser.parse_args()

    request_time = (
        pd.Timestamp(args.request_time) if args.request_time else pd.Timestamp.now()
    )

    drivers_df = pd.read_csv(f"{args.data_dir}/drivers.csv")
    segments_df = pd.read_csv(f"{args.data_dir}/segments.csv")

    ranked, est_minutes = match_driver(
        args.pickup_city, args.corridor, args.distance_km, request_time,
        drivers_df, segments_df, top_n=args.top_n,
    )

    print(f"Segment: {args.pickup_city} along {args.corridor}, "
          f"{args.distance_km}km (~{est_minutes:.0f} min)\n")

    if ranked.empty:
        print("No eligible drivers — all candidates would breach the segment "
              "or daily driving cap. Widen the search radius or corridor pool.")
        return

    print(f"Top {len(ranked)} matches:")
    for _, row in ranked.iterrows():
        print(
            f"  {row['name']:<14} score={row['match_score']:.3f}  "
            f"corridor_fit={row['corridor_fit']:.2f}  "
            f"driven_24h={row['minutes_driven_24h']:.0f}min  "
            f"rating={row['rating_avg']:.2f}  "
            f"cancellations={int(row['total_cancellations'])}"
        )


if __name__ == "__main__":
    main()

# NOTE on evolving this to a learned model:
# Once real assignment outcomes exist (on-time %, driver acceptance rate,
# dispute rate per match), reframe this as a learning-to-rank problem:
# features = [corridor_fit, fatigue_ratio, rating, reliability, ETA-model
# output for this driver's likely route familiarity], label = did this
# match lead to an on-time, dispute-free delivery. A LightGBM ranker
# (lambdarank objective) is the natural upgrade path — the hard
# constraints (segment cap, daily cap) should stay as pre-filtering
# rules regardless, since those are safety limits, not preferences.
