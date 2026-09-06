"""
Relay Freight Platform — Dynamic Pricing Engine
=================================================
Deliberately a transparent formula, not a trained model — pricing
needs to be explainable to shippers ("why is this ₹X and not ₹Y") and
auditable by ops, not a black box. This mirrors the same reasoning
used for driver-matching and backhaul: explainability first, ML later
once there's real conversion/acceptance data to optimize against.

Fare = (base_fare + per_km_rate * distance) * load_surcharge
       * time_of_day_multiplier * demand_supply_multiplier
       + insurance_premium (if opted)

Detention charges and cancellation fees are computed separately at
their own trigger points (see schema) — they aren't part of the
upfront quote since they depend on events that haven't happened yet.

Usage:
    python3 pricing_engine.py --data-dir ./synthetic_data_large \
        --pickup-city Delhi --vehicle-type-id 9 --distance-km 280 \
        --weight-kg 12000 --scheduled-at "2026-09-06T19:00:00"
"""

import argparse
from datetime import timedelta

import pandas as pd

LOAD_SURCHARGE_THRESHOLD = 0.85   # load_ratio above this = heavier handling/fuel cost
LOAD_SURCHARGE_PCT = 0.05

PEAK_HOURS = set(list(range(8, 12)) + list(range(17, 21)))
NIGHT_HOURS = set(list(range(23, 24)) + list(range(0, 5)))
PEAK_MULTIPLIER = 1.10
NIGHT_MULTIPLIER = 1.15

DEMAND_WINDOW_HOURS = 6
SURGE_HIGH_RATIO = 1.5     # demand:supply ratio that triggers max surge
MAX_SURGE_MULTIPLIER = 1.4
MIN_SURGE_MULTIPLIER = 0.92  # mild discount when oversupplied, encourages utilization

INSURANCE_PREMIUM_PCT = 0.015  # 1.5% of fare, flat proxy in absence of declared cargo value


def time_of_day_multiplier(scheduled_at):
    hour = pd.Timestamp(scheduled_at).hour
    if hour in NIGHT_HOURS:
        return NIGHT_MULTIPLIER, "night"
    if hour in PEAK_HOURS:
        return PEAK_MULTIPLIER, "peak"
    return 1.0, "off-peak"


def demand_supply_multiplier(pickup_city, scheduled_at, trips_df, drivers_df):
    scheduled_at = pd.Timestamp(scheduled_at)
    window_start = scheduled_at - timedelta(hours=DEMAND_WINDOW_HOURS)
    window_end = scheduled_at + timedelta(hours=DEMAND_WINDOW_HOURS)

    demand = trips_df[
        (trips_df["pickup_city"] == pickup_city)
        & (pd.to_datetime(trips_df["scheduled_at"]) >= window_start)
        & (pd.to_datetime(trips_df["scheduled_at"]) <= window_end)
    ].shape[0]

    supply = drivers_df[
        drivers_df["preferred_zones"].fillna("").str.contains(pickup_city)
    ].shape[0]
    supply = max(supply, 1)  # avoid divide-by-zero

    ratio = demand / supply
    if ratio >= SURGE_HIGH_RATIO:
        return MAX_SURGE_MULTIPLIER, ratio
    if ratio <= 0.3:
        return MIN_SURGE_MULTIPLIER, ratio
    # linear interpolation between 1.0 (ratio=0.3) and MAX_SURGE (ratio=SURGE_HIGH_RATIO)
    frac = (ratio - 0.3) / (SURGE_HIGH_RATIO - 0.3)
    return 1.0 + frac * (MAX_SURGE_MULTIPLIER - 1.0), ratio


def calculate_fare(vehicle_row, distance_km, weight_kg, pickup_city, scheduled_at,
                    trips_df, drivers_df, advance_pct=80, insurance_opted=False):

    base_component = vehicle_row["base_fare"] + vehicle_row["per_km_rate"] * distance_km

    load_ratio = weight_kg / vehicle_row["max_weight_kg"]
    load_mult = 1 + LOAD_SURCHARGE_PCT if load_ratio > LOAD_SURCHARGE_THRESHOLD else 1.0

    time_mult, time_label = time_of_day_multiplier(scheduled_at)
    demand_mult, demand_ratio = demand_supply_multiplier(
        pickup_city, scheduled_at, trips_df, drivers_df
    )

    subtotal = base_component * load_mult * time_mult * demand_mult
    insurance_premium = round(subtotal * INSURANCE_PREMIUM_PCT, 2) if insurance_opted else 0.0
    total = round(subtotal + insurance_premium, 2)

    advance_amount = round(total * advance_pct / 100, 2)
    balance_amount = round(total - advance_amount, 2)

    return {
        "base_component": round(base_component, 2),
        "load_ratio": round(load_ratio, 2),
        "load_multiplier": load_mult,
        "time_of_day": time_label,
        "time_multiplier": time_mult,
        "demand_supply_ratio": round(demand_ratio, 2),
        "demand_multiplier": round(demand_mult, 3),
        "insurance_premium": insurance_premium,
        "total_fare": total,
        "advance_amount": advance_amount,
        "balance_amount": balance_amount,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=str, default="./synthetic_data_large")
    parser.add_argument("--pickup-city", type=str, required=True)
    parser.add_argument("--vehicle-type-id", type=int, required=True)
    parser.add_argument("--distance-km", type=float, required=True)
    parser.add_argument("--weight-kg", type=float, required=True)
    parser.add_argument("--scheduled-at", type=str, required=True)
    parser.add_argument("--advance-pct", type=int, default=80)
    parser.add_argument("--insurance", action="store_true")
    args = parser.parse_args()

    vehicle_types = pd.read_csv(f"{args.data_dir}/vehicle_types.csv")
    trips_df = pd.read_csv(f"{args.data_dir}/trips.csv")
    drivers_df = pd.read_csv(f"{args.data_dir}/drivers.csv")

    vehicle_row = vehicle_types.loc[vehicle_types["id"] == args.vehicle_type_id].iloc[0]

    breakdown = calculate_fare(
        vehicle_row, args.distance_km, args.weight_kg, args.pickup_city,
        args.scheduled_at, trips_df, drivers_df,
        advance_pct=args.advance_pct, insurance_opted=args.insurance,
    )

    print(f"Fare breakdown — {vehicle_row['name']}, {args.distance_km}km from "
          f"{args.pickup_city}\n")
    for k, v in breakdown.items():
        print(f"  {k:<20} {v}")


if __name__ == "__main__":
    main()
