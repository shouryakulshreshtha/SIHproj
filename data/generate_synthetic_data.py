"""
Relay Freight Platform — Synthetic Data Generator
==================================================
Generates realistic trip/segment/handover/GPS/anomaly data grounded in
real Indian city coordinates and corridor geography, matching the
Postgres schema (relay_freight_schema.sql).

Output: one CSV per table, written to --outdir, ready to:
  (a) load into Postgres for the backend demo, and
  (b) train the ETA / matching / anomaly models directly.

Usage:
    python3 generate_synthetic_data.py --num-trips 1000 --outdir ./synthetic_data
"""

import argparse
import math
import random
import uuid
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

RNG_SEED = 42
random.seed(RNG_SEED)
np.random.seed(RNG_SEED)

# ---------------------------------------------------------------------
# 1. REFERENCE DATA — real city coordinates, used as relay hubs
# ---------------------------------------------------------------------

CITIES = {
    "Chandigarh": (30.7333, 76.7794),
    "Ludhiana":   (30.9010, 75.8573),
    "Delhi":      (28.6139, 77.2090),
    "Agra":       (27.1767, 78.0081),
    "Jaipur":     (26.9124, 75.7873),
    "Kanpur":     (26.4499, 80.3319),
    "Lucknow":    (26.8467, 80.9462),
    "Ahmedabad":  (23.0225, 72.5714),
    "Surat":      (21.1702, 72.8311),
    "Indore":     (22.7196, 75.8577),
    "Nagpur":     (21.1458, 79.0882),
    "Mumbai":     (19.0760, 72.8777),
    "Pune":       (18.5204, 73.8567),
    "Hyderabad":  (17.3850, 78.4867),
    "Bangalore":  (12.9716, 77.5946),
    "Chennai":    (13.0827, 80.2707),
    "Kolkata":    (22.5726, 88.3639),
}

# Ordered corridors — consecutive cities are relay hub candidates.
# Roughly follows NH44 / NH48 style long-haul freight lanes.
CORRIDORS = [
    ["Chandigarh", "Ludhiana", "Delhi", "Jaipur", "Ahmedabad", "Surat", "Mumbai"],
    ["Delhi", "Agra", "Kanpur", "Lucknow"],
    ["Delhi", "Agra", "Indore", "Nagpur", "Hyderabad", "Bangalore"],
    ["Mumbai", "Pune", "Hyderabad"],
    ["Kolkata", "Nagpur", "Mumbai"],
]

VEHICLE_TYPES = [
    # name, max_weight_kg, max_volume_cbm, base_fare, per_km_rate
    ("TATA ACE", 750, 4.0, 300, 18),
    ("BOLERO PICK UP", 1500, 6.0, 350, 20),
    ("TATA 407", 2500, 9.0, 450, 24),
    ("EICHER 14FT", 4000, 14.0, 700, 30),
    ("EICHER 17FT", 6000, 18.0, 850, 34),
    ("EICHER 19FT", 7000, 22.0, 950, 38),
    ("CLOSED 20FT", 8000, 28.0, 1100, 42),
    ("TRUCK 9 TON", 9000, 30.0, 1300, 46),
    ("TAURUS 16 TON", 16000, 45.0, 2200, 55),
    ("TAURUS 21 TON", 21000, 55.0, 2800, 62),
    ("32FT CONTAINER 7 TON", 7000, 60.0, 2400, 58),
    ("32FT CONTAINER 14 TON", 14000, 65.0, 3000, 65),
    ("40FT OPEN TRAILER", 25000, 75.0, 3600, 72),
]

GOODS_TYPES = [
    "Healthcare / Pharmacy Products", "FMCG / Food Items",
    "Electrical / Electronics / Home Appliances", "Books / Stationery / Toys / Gifts",
    "Aluminium / Steel / Metal Products", "Electrical Transformer",
    "Building / Construction Material", "Paint / Houseware Supplies",
    "Engineering Goods", "Textile / Garments", "Plastic / PVC / Rubber",
    "Furniture / Plywood / Laminate", "ODC Consignment", "Industrial Machinery",
    "Household & Office Items", "Chemicals and Liquid Barrels",
    "Electrical Panels / Equipments / Spare Parts", "Solar Products",
    "Ceramic / Hardware Supplies", "Paper / Packaging / Printed Material",
    "Exhibition / Event Supplies", "Electrical Wires / Cables", "Others",
]
HAZMAT_PRONE = {"Chemicals and Liquid Barrels"}

MAX_DRIVING_MINUTES = 270          # ~4.5 hr Rivigo-style segment cap
RELAY_DISTANCE_THRESHOLD_KM = 350  # beyond this, trip is offered as relay
ANOMALY_RATE = 0.06                # ~6% of segments get an injected anomaly


def haversine_km(p1, p2):
    lat1, lon1, lat2, lon2 = map(math.radians, [p1[0], p1[1], p2[0], p2[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def jitter(coord, km=2.0):
    """Small random offset to simulate GPS noise / non-exact hub arrival."""
    d_lat = (km / 111.0) * (random.random() - 0.5) * 2
    d_lon = (km / 111.0) * (random.random() - 0.5) * 2
    return (coord[0] + d_lat, coord[1] + d_lon)


def new_id():
    return str(uuid.uuid4())


# ---------------------------------------------------------------------
# 2. STATIC TABLES: vehicle_types, goods_types, hubs
# ---------------------------------------------------------------------

def build_static_tables():
    vt_rows = [
        {"id": i + 1, "name": n, "max_weight_kg": w, "max_volume_cbm": v,
         "base_fare": bf, "per_km_rate": pkr}
        for i, (n, w, v, bf, pkr) in enumerate(VEHICLE_TYPES)
    ]
    gt_rows = [
        {"id": i + 1, "name": n, "is_hazmat_prone": n in HAZMAT_PRONE}
        for i, n in enumerate(GOODS_TYPES)
    ]
    hub_ids = {}
    hub_rows = []
    for city, coord in CITIES.items():
        hid = new_id()
        hub_ids[city] = hid
        hub_rows.append({
            "id": hid, "name": f"{city} Relay Hub",
            "lat": coord[0], "lon": coord[1],
            "facilities": '{"parking": true, "food": true, "security": true}',
        })
    return pd.DataFrame(vt_rows), pd.DataFrame(gt_rows), pd.DataFrame(hub_rows), hub_ids


# ---------------------------------------------------------------------
# 3. DRIVERS & SHIPPERS
# ---------------------------------------------------------------------

def build_users(num_drivers, num_shippers):
    drivers, shippers = [], []
    for i in range(num_drivers):
        corridor = random.choice(CORRIDORS)
        drivers.append({
            "id": new_id(),
            "name": f"Driver_{i:04d}",
            "phone": f"9{random.randint(100000000, 999999999)}",
            "preferred_zones": "|".join(corridor),
            "rating_avg": round(np.random.normal(4.4, 0.35), 2),
            "max_driving_minutes_per_segment": MAX_DRIVING_MINUTES,
            "total_cancellations": np.random.poisson(0.5),
        })
    for i in range(num_shippers):
        shippers.append({
            "id": new_id(),
            "name": f"Shipper_{i:04d}",
            "phone": f"8{random.randint(100000000, 999999999)}",
            "company_name": f"Company_{i:04d} Pvt Ltd" if random.random() < 0.6 else None,
        })
    return pd.DataFrame(drivers), pd.DataFrame(shippers)


# ---------------------------------------------------------------------
# 4. TRIPS, SEGMENTS, HANDOVERS, LOCATION PINGS, ANOMALIES
# ---------------------------------------------------------------------

def generate_trips(num_trips, vt_df, gt_df, hub_ids, drivers_df, shippers_df):
    trips, segments, handovers = [], [], []
    location_pings, anomaly_flags, ratings = [], [], []

    for t in range(num_trips):
        corridor = random.choice(CORRIDORS)
        i, j = sorted(random.sample(range(len(corridor)), 2))
        leg_cities = corridor[i:j + 1]
        if random.random() < 0.5:
            leg_cities = leg_cities[::-1]  # direction can go either way

        total_km = sum(
            haversine_km(CITIES[leg_cities[k]], CITIES[leg_cities[k + 1]])
            for k in range(len(leg_cities) - 1)
        )
        mode = "relay" if total_km > RELAY_DISTANCE_THRESHOLD_KM and len(leg_cities) > 2 else "single"

        vt = vt_df.sample(1).iloc[0]
        gt = gt_df.sample(1).iloc[0]
        weight = round(random.uniform(0.2, 1.0) * vt["max_weight_kg"], 1)
        is_hazmat = bool(gt["is_hazmat_prone"]) and random.random() < 0.3

        trip_id = new_id()
        shipper = shippers_df.sample(1).iloc[0]
        scheduled_at = datetime.now() + timedelta(hours=random.randint(-72, 72))

        trips.append({
            "id": trip_id, "shipper_id": shipper["id"], "vehicle_type_id": vt["id"],
            "goods_type_id": gt["id"], "weight_kg": weight, "is_hazardous": is_hazmat,
            "mode": mode, "status": random.choice(
                ["delivered"] * 7 + ["in_progress"] * 2 + ["cancelled"]
            ),
            "pickup_city": leg_cities[0], "drop_city": leg_cities[-1],
            "distance_km": round(total_km, 1),
            "allow_consolidation": random.random() < 0.25,
            "fare_estimated": round(vt["base_fare"] + total_km * vt["per_km_rate"], 2),
            "advance_payment_pct": random.choice([80, 90]),
            "scheduled_at": scheduled_at.isoformat(),
        })

        # --- segments: one leg per hub-to-hub hop (single mode => 1 segment) ---
        seg_legs = leg_cities if mode == "relay" else [leg_cities[0], leg_cities[-1]]
        cursor_time = scheduled_at
        for s_idx in range(len(seg_legs) - 1):
            from_city, to_city = seg_legs[s_idx], seg_legs[s_idx + 1]
            seg_km = haversine_km(CITIES[from_city], CITIES[to_city])
            avg_speed = np.random.normal(42, 6)  # km/h, realistic laden-truck avg
            duration_min = max(20, (seg_km / max(avg_speed, 15)) * 60 * np.random.normal(1.0, 0.12))

            driver = drivers_df.sample(1).iloc[0]
            seg_id = new_id()
            started_at = cursor_time
            ended_at = started_at + timedelta(minutes=duration_min)
            cursor_time = ended_at

            segments.append({
                "id": seg_id, "trip_id": trip_id, "sequence_no": s_idx,
                "driver_id": driver["id"],
                "hub_from_id": hub_ids[from_city] if mode == "relay" and s_idx > 0 else None,
                "hub_to_id": hub_ids[to_city] if mode == "relay" and s_idx < len(seg_legs) - 2 else None,
                "distance_km": round(seg_km, 1),
                "estimated_minutes": round(duration_min, 1),
                "avg_speed_kmph": round(avg_speed, 1),
                "status": "completed",
                "started_at": started_at.isoformat(),
                "ended_at": ended_at.isoformat(),
            })

            # --- location pings along this segment, interpolated + noise ---
            n_pings = max(4, int(duration_min // 10))
            is_anomalous_seg = random.random() < ANOMALY_RATE
            anomaly_type = random.choice(
                ["gps_spoof", "route_diversion"]
            ) if is_anomalous_seg else None

            for p in range(n_pings):
                frac = p / max(n_pings - 1, 1)
                lat = CITIES[from_city][0] + frac * (CITIES[to_city][0] - CITIES[from_city][0])
                lon = CITIES[from_city][1] + frac * (CITIES[to_city][1] - CITIES[from_city][1])
                lat, lon = jitter((lat, lon), km=3)
                speed = max(10, np.random.normal(avg_speed, 5))
                source = "gps"

                if is_anomalous_seg and anomaly_type == "gps_spoof" and p == n_pings // 2:
                    speed = random.uniform(140, 200)  # physically implausible for a truck
                if is_anomalous_seg and anomaly_type == "route_diversion" and p == n_pings // 2:
                    lat += random.uniform(0.3, 0.6) * random.choice([-1, 1])
                    lon += random.uniform(0.3, 0.6) * random.choice([-1, 1])
                    source = "cell_triangulation"

                location_pings.append({
                    "driver_id": driver["id"], "segment_id": seg_id,
                    "lat": round(lat, 5), "lon": round(lon, 5),
                    "speed_kmph": round(speed, 1), "source": source,
                    "recorded_at": (started_at + timedelta(
                        minutes=duration_min * frac)).isoformat(),
                })

            if is_anomalous_seg:
                anomaly_flags.append({
                    "trip_id": trip_id, "segment_id": seg_id, "driver_id": driver["id"],
                    "type": anomaly_type, "risk_score": round(random.uniform(65, 98), 1),
                })

            # rating, mostly good with occasional low scores
            ratings.append({
                "trip_id": trip_id, "rated_user_id": driver["id"], "rated_role": "driver",
                "score": np.random.choice([5, 4, 3, 2], p=[0.7, 0.2, 0.07, 0.03]),
            })
            ratings.append({
                "trip_id": trip_id, "rated_user_id": shipper["id"], "rated_role": "shipper",
                "score": np.random.choice([5, 4, 3, 2], p=[0.75, 0.18, 0.05, 0.02]),
            })

        # --- handovers between consecutive segments (relay only) ---
        seg_ids_for_trip = [s["id"] for s in segments if s["trip_id"] == trip_id]
        for h in range(len(seg_ids_for_trip) - 1):
            hub_city = seg_legs[h + 1]
            mismatch = random.random() < 0.04
            handovers.append({
                "id": new_id(),
                "segment_from_id": seg_ids_for_trip[h],
                "segment_to_id": seg_ids_for_trip[h + 1],
                "hub_id": hub_ids[hub_city],
                "otp_code": f"{random.randint(100000, 999999)}",
                "disputed": mismatch,
                "distance_from_hub_km": round(random.uniform(5, 15), 1) if mismatch else round(random.uniform(0, 0.5), 2),
            })
            if mismatch:
                anomaly_flags.append({
                    "trip_id": trip_id, "segment_id": seg_ids_for_trip[h + 1],
                    "driver_id": None, "type": "handover_mismatch",
                    "risk_score": round(random.uniform(60, 90), 1),
                })

    return (pd.DataFrame(trips), pd.DataFrame(segments), pd.DataFrame(handovers),
            pd.DataFrame(location_pings), pd.DataFrame(anomaly_flags), pd.DataFrame(ratings))


# ---------------------------------------------------------------------
# 5. MAIN
# ---------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--num-trips", type=int, default=1000)
    parser.add_argument("--num-drivers", type=int, default=150)
    parser.add_argument("--num-shippers", type=int, default=300)
    parser.add_argument("--outdir", type=str, default="./synthetic_data")
    args = parser.parse_args()

    import os
    os.makedirs(args.outdir, exist_ok=True)

    vt_df, gt_df, hub_df, hub_ids = build_static_tables()
    drivers_df, shippers_df = build_users(args.num_drivers, args.num_shippers)
    trips_df, seg_df, ho_df, ping_df, anomaly_df, rating_df = generate_trips(
        args.num_trips, vt_df, gt_df, hub_ids, drivers_df, shippers_df
    )

    tables = {
        "vehicle_types": vt_df, "goods_types": gt_df, "hubs": hub_df,
        "drivers": drivers_df, "shippers": shippers_df,
        "trips": trips_df, "segments": seg_df, "handovers": ho_df,
        "location_pings": ping_df, "anomaly_flags": anomaly_df, "ratings": rating_df,
    }
    for name, df in tables.items():
        path = os.path.join(args.outdir, f"{name}.csv")
        df.to_csv(path, index=False)
        print(f"  wrote {path}  ({len(df)} rows)")

    print(f"\nDone. {args.num_trips} trips -> {len(seg_df)} segments, "
          f"{len(ping_df)} GPS pings, {len(anomaly_df)} labeled anomalies.")


if __name__ == "__main__":
    main()
