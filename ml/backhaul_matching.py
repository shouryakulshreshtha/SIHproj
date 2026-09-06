"""
Relay Freight Platform — Backhaul / Empty-Mile Matching
=========================================================
When a driver finishes a trip, trucks conventionally drive back empty
unless a return load is found. This suggests nearby upcoming bookings
near the driver's drop point so the return leg can be paid work instead
of empty mileage — the single biggest efficiency lever in trucking
(Freight Tiger and similar platforms build entire products around this).

Approach: proximity + timing + capacity fit, not a trained model —
same explainability reasoning as the driver-segment matcher. This
becomes a ranking model later once you have data on which backhaul
suggestions drivers actually accepted.

Usage:
    python3 backhaul_matching.py --data-dir ./synthetic_data_large
"""

import argparse
import math

import pandas as pd

# Real city coordinates — same reference set as the data generator,
# kept local here so this script only needs trips.csv + drivers.csv.
CITIES = {
    "Chandigarh": (30.7333, 76.7794), "Ludhiana": (30.9010, 75.8573),
    "Delhi": (28.6139, 77.2090), "Agra": (27.1767, 78.0081),
    "Jaipur": (26.9124, 75.7873), "Kanpur": (26.4499, 80.3319),
    "Lucknow": (26.8467, 80.9462), "Ahmedabad": (23.0225, 72.5714),
    "Surat": (21.1702, 72.8311), "Indore": (22.7196, 75.8577),
    "Nagpur": (21.1458, 79.0882), "Mumbai": (19.0760, 72.8777),
    "Pune": (18.5204, 73.8567), "Hyderabad": (17.3850, 78.4867),
    "Bangalore": (12.9716, 77.5946), "Chennai": (13.0827, 80.2707),
    "Kolkata": (22.5726, 88.3639),
}

MAX_BACKHAUL_RADIUS_KM = 120     # how far from the drop point a "nearby" load can be
MAX_WAIT_HOURS = 18              # driver won't wait longer than this for a return load

WEIGHTS = {"proximity": 0.45, "fare": 0.30, "return_direction": 0.25}


def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def find_backhaul_matches(driver_id, drop_city, available_from, home_zone_city,
                           trips_df, top_n=5):
    """drop_city: where the driver just finished a leg.
    home_zone_city: the driver's preferred/home corridor city — used to
    bonus-score loads that also happen to head back that direction."""

    drop_coord = CITIES[drop_city]
    candidates = trips_df[trips_df["status"].isin(["requested", "confirmed", "delivered"])].copy()
    candidates = candidates[candidates["pickup_city"] != drop_city]  # not the same point

    candidates["pickup_dist_km"] = candidates["pickup_city"].apply(
        lambda c: haversine_km(drop_coord, CITIES.get(c, drop_coord))
    )
    candidates = candidates[candidates["pickup_dist_km"] <= MAX_BACKHAUL_RADIUS_KM]

    candidates["scheduled_at"] = pd.to_datetime(candidates["scheduled_at"])
    wait_hours = (candidates["scheduled_at"] - available_from).dt.total_seconds() / 3600
    candidates = candidates[(wait_hours >= 0) & (wait_hours <= MAX_WAIT_HOURS)]

    if candidates.empty:
        return pd.DataFrame()

    if home_zone_city and home_zone_city in CITIES:
        home_coord = CITIES[home_zone_city]
        candidates["drop_dist_to_home"] = candidates["drop_city"].apply(
            lambda c: haversine_km(home_coord, CITIES.get(c, home_coord))
        )
        max_possible = candidates["drop_dist_to_home"].max() or 1
        candidates["return_direction_score"] = 1 - (candidates["drop_dist_to_home"] / max_possible)
    else:
        candidates["return_direction_score"] = 0.5  # neutral if no home zone known

    candidates["proximity_score"] = 1 - (candidates["pickup_dist_km"] / MAX_BACKHAUL_RADIUS_KM)
    max_fare = candidates["fare_estimated"].max() or 1
    candidates["fare_score"] = candidates["fare_estimated"] / max_fare

    candidates["backhaul_score"] = (
        WEIGHTS["proximity"] * candidates["proximity_score"]
        + WEIGHTS["fare"] * candidates["fare_score"]
        + WEIGHTS["return_direction"] * candidates["return_direction_score"]
    )

    ranked = candidates.sort_values("backhaul_score", ascending=False).head(top_n)
    return ranked[[
        "id", "pickup_city", "drop_city", "pickup_dist_km",
        "fare_estimated", "backhaul_score",
    ]]


def estimate_empty_mile_savings(trips_df, drivers_df, sample_size=200):
    """Rough platform-level metric: for a sample of completed trips,
    how often was a viable backhaul load actually available nearby?
    Useful pitch statistic — 'X% of trips had a backhaul opportunity
    within Ykm, saving an estimated Zkm of empty return travel'."""
    sample = trips_df.sample(min(sample_size, len(trips_df)), random_state=1)
    matched, km_saved = 0, 0.0
    for _, trip in sample.iterrows():
        drop_coord = CITIES.get(trip["drop_city"])
        if drop_coord is None:
            continue
        matches = find_backhaul_matches(
            driver_id=None, drop_city=trip["drop_city"],
            available_from=pd.Timestamp(trip["scheduled_at"]),
            home_zone_city=trip["pickup_city"],
            trips_df=trips_df, top_n=1,
        )
        if not matches.empty:
            matched += 1
            km_saved += trip["distance_km"]  # proxy: return leg would've been ~this far empty

    return matched, len(sample), km_saved


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=str, default="./synthetic_data_large")
    args = parser.parse_args()

    trips_df = pd.read_csv(f"{args.data_dir}/trips.csv")
    drivers_df = pd.read_csv(f"{args.data_dir}/drivers.csv")

    # demo: a driver who just dropped a load in Lucknow, home corridor is Delhi
    example = find_backhaul_matches(
        driver_id="demo-driver", drop_city="Lucknow",
        available_from=pd.Timestamp("2026-09-06T12:00:00"),
        home_zone_city="Delhi", trips_df=trips_df,
    )
    print("=== Example: driver just dropped off in Lucknow ===\n")
    if example.empty:
        print("No backhaul loads found within radius/time window.")
    else:
        print(example.to_string(index=False))

    print("\n=== Platform-level empty-mile opportunity estimate ===")
    matched, total, km_saved = estimate_empty_mile_savings(trips_df, drivers_df)
    print(f"{matched}/{total} sampled trips ({matched/total*100:.0f}%) had a viable "
          f"backhaul load nearby, worth an estimated {km_saved:.0f}km of "
          f"otherwise-empty return travel across the sample.")


if __name__ == "__main__":
    main()
