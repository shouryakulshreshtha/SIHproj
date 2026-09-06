"""
Relay Freight Platform — Anomaly & Fraud Detection
====================================================
Rule-based detectors for the three anomaly types we can validate
against the synthetic ground-truth labels (gps_spoof, route_diversion,
handover_mismatch), plus a combined per-driver risk score.

OTP-failure and cancellation-pattern detectors are included as
production-ready rule stubs — the synthetic data doesn't simulate raw
OTP attempt logs or a cancellation event stream, so there's nothing to
validate them against yet. Wire them to real backend event logs once
those exist; the thresholds are config, not model weights, so no
training data is required to turn them on.

Usage:
    python3 anomaly_detection.py --data-dir ./synthetic_data_large
"""

import argparse
import math

import numpy as np
import pandas as pd

# --- thresholds (config, not learned — tune against real ops feedback) ---
SPOOF_SPEED_KMPH = 100          # no laden truck legitimately exceeds this
DIVERSION_KM = 15               # perpendicular deviation from expected path
HANDOVER_MISMATCH_KM = 3        # distance from declared hub at handover time
OTP_FAILURE_THRESHOLD = 3       # consecutive failed attempts before flagging
CANCELLATION_ZSCORE_THRESHOLD = 2.0


def latlon_to_km_xy(lat, lon, ref_lat):
    """Flat-earth approximation, fine at the ~10-500km scale of a segment."""
    x = (lon) * 111.0 * math.cos(math.radians(ref_lat))
    y = (lat) * 111.0
    return x, y


def point_to_segment_distance_km(p, a, b):
    """Perpendicular distance (km) from point p to line segment a-b,
    all given as (lat, lon)."""
    ref_lat = a[0]
    px, py = latlon_to_km_xy(p[1], p[0], ref_lat)
    ax, ay = latlon_to_km_xy(a[1], a[0], ref_lat)
    bx, by = latlon_to_km_xy(b[1], b[0], ref_lat)

    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    proj_x, proj_y = ax + t * dx, ay + t * dy
    return math.hypot(px - proj_x, py - proj_y)


def detect_gps_spoofing(pings_df):
    flagged = pings_df[pings_df["speed_kmph"] > SPOOF_SPEED_KMPH]
    return set(flagged["segment_id"].unique())


def detect_route_diversion(pings_df):
    flagged_segments = set()
    for seg_id, group in pings_df.groupby("segment_id"):
        group = group.sort_values("recorded_at")
        if len(group) < 3:
            continue
        start = (group.iloc[0]["lat"], group.iloc[0]["lon"])
        end = (group.iloc[-1]["lat"], group.iloc[-1]["lon"])
        max_dev = max(
            point_to_segment_distance_km((row["lat"], row["lon"]), start, end)
            for _, row in group.iloc[1:-1].iterrows()
        ) if len(group) > 2 else 0
        if max_dev > DIVERSION_KM:
            flagged_segments.add(seg_id)
    return flagged_segments


def detect_handover_mismatch(handovers_df):
    flagged = handovers_df[handovers_df["distance_from_hub_km"] > HANDOVER_MISMATCH_KM]
    return set(flagged["segment_to_id"].unique())


def detect_otp_failures(otp_attempt_log):
    """STUB — wire to real backend OTP-attempt events.
    otp_attempt_log expected columns: handover_id, attempt_no, success (bool)
    Flags handovers with >= OTP_FAILURE_THRESHOLD consecutive failures."""
    if otp_attempt_log is None or otp_attempt_log.empty:
        return set()
    fail_counts = (
        otp_attempt_log[~otp_attempt_log["success"]]
        .groupby("handover_id").size()
    )
    return set(fail_counts[fail_counts >= OTP_FAILURE_THRESHOLD].index)


def detect_cancellation_pattern(drivers_df):
    """Flags drivers whose cancellation count is a statistical outlier
    relative to the driver population (z-score), rather than a fixed
    count — adapts automatically as the platform's baseline shifts."""
    mean, std = drivers_df["total_cancellations"].mean(), drivers_df["total_cancellations"].std()
    if std == 0:
        return set()
    z = (drivers_df["total_cancellations"] - mean) / std
    return set(drivers_df.loc[z > CANCELLATION_ZSCORE_THRESHOLD, "id"])


def evaluate(predicted_segment_ids, ground_truth_df, anomaly_type):
    truth_ids = set(
        ground_truth_df.loc[ground_truth_df["type"] == anomaly_type, "segment_id"]
    )
    tp = len(predicted_segment_ids & truth_ids)
    fp = len(predicted_segment_ids - truth_ids)
    fn = len(truth_ids - predicted_segment_ids)
    precision = tp / (tp + fp) if (tp + fp) else float("nan")
    recall = tp / (tp + fn) if (tp + fn) else float("nan")
    return precision, recall, tp, fp, fn


def build_driver_risk_scores(pings_df, handovers_df, drivers_df,
                              spoof_segments, diversion_segments, mismatch_segments):
    """Combined 0-100 risk score per driver: more/varied anomaly types
    associated with a driver's segments pushes the score up."""
    seg_to_driver = pings_df.drop_duplicates("segment_id").set_index("segment_id")["driver_id"]

    flags_per_driver = {}
    for seg_set, weight in [(spoof_segments, 40), (diversion_segments, 35), (mismatch_segments, 25)]:
        for seg_id in seg_set:
            driver_id = seg_to_driver.get(seg_id)
            if driver_id:
                flags_per_driver[driver_id] = flags_per_driver.get(driver_id, 0) + weight

    risk_df = pd.DataFrame([
        {"driver_id": d, "risk_score": min(score, 100)}
        for d, score in flags_per_driver.items()
    ]).sort_values("risk_score", ascending=False)
    return risk_df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=str, default="./synthetic_data_large")
    args = parser.parse_args()

    pings_df = pd.read_csv(f"{args.data_dir}/location_pings.csv")
    handovers_df = pd.read_csv(f"{args.data_dir}/handovers.csv")
    drivers_df = pd.read_csv(f"{args.data_dir}/drivers.csv")
    ground_truth = pd.read_csv(f"{args.data_dir}/anomaly_flags.csv")

    spoof = detect_gps_spoofing(pings_df)
    diversion = detect_route_diversion(pings_df)
    mismatch = detect_handover_mismatch(handovers_df)
    cancel_flags = detect_cancellation_pattern(drivers_df)

    print("=== Detection results vs. synthetic ground truth ===\n")
    for name, preds in [("gps_spoof", spoof), ("route_diversion", diversion),
                         ("handover_mismatch", mismatch)]:
        p, r, tp, fp, fn = evaluate(preds, ground_truth, name)
        print(f"{name:<20} precision={p:.2f}  recall={r:.2f}  "
              f"(tp={tp}, fp={fp}, fn={fn})")

    print(f"\ncancellation_pattern outliers flagged: {len(cancel_flags)} driver(s)")

    risk_df = build_driver_risk_scores(pings_df, handovers_df, drivers_df,
                                        spoof, diversion, mismatch)
    print(f"\nTop 5 highest-risk drivers:")
    print(risk_df.head(5).to_string(index=False))

    risk_df.to_csv(f"{args.data_dir}/driver_risk_scores.csv", index=False)
    print(f"\nSaved -> {args.data_dir}/driver_risk_scores.csv")


if __name__ == "__main__":
    main()
