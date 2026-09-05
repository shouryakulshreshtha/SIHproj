"""
Relay Freight Platform — ETA Prediction Model
==============================================
Trains a gradient-boosted regressor to predict segment duration
(minutes) from features known at booking/assignment time: distance,
vehicle type, cargo weight, time-of-day, and relay leg position.

Usage:
    python3 train_eta_model.py --data-dir ./synthetic_data --outdir ./models
"""

import argparse
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor


def load_and_join(data_dir):
    segments = pd.read_csv(os.path.join(data_dir, "segments.csv"))
    trips = pd.read_csv(os.path.join(data_dir, "trips.csv"))
    vehicle_types = pd.read_csv(os.path.join(data_dir, "vehicle_types.csv"))

    df = segments.merge(
        trips[["id", "vehicle_type_id", "goods_type_id", "weight_kg", "mode"]],
        left_on="trip_id", right_on="id", suffixes=("", "_trip")
    )
    df = df.merge(
        vehicle_types[["id", "max_weight_kg", "per_km_rate"]],
        left_on="vehicle_type_id", right_on="id", suffixes=("", "_vt")
    )

    df["started_at"] = pd.to_datetime(df["started_at"])
    df["hour_of_day"] = df["started_at"].dt.hour
    df["day_of_week"] = df["started_at"].dt.dayofweek
    df["is_relay"] = (df["mode"] == "relay").astype(int)
    df["load_ratio"] = df["weight_kg"] / df["max_weight_kg"]  # how full the truck is

    return df


def build_features(df):
    feature_cols = [
        "distance_km", "sequence_no", "vehicle_type_id", "goods_type_id",
        "hour_of_day", "day_of_week", "is_relay", "load_ratio", "per_km_rate",
    ]
    X = df[feature_cols].copy()
    y = df["estimated_minutes"]  # actual simulated duration = training target
    return X, y, feature_cols


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=str, default="./synthetic_data")
    parser.add_argument("--outdir", type=str, default="./models")
    args = parser.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    df = load_and_join(args.data_dir)
    X, y, feature_cols = build_features(df)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    model = XGBRegressor(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    r2 = r2_score(y_test, preds)

    print(f"Test MAE:  {mae:.1f} minutes")
    print(f"Test RMSE: {rmse:.1f} minutes")
    print(f"Test R^2:  {r2:.3f}")

    importances = pd.Series(model.feature_importances_, index=feature_cols)
    importances = importances.sort_values(ascending=False)
    print("\nFeature importances:")
    for feat, imp in importances.items():
        print(f"  {feat:<16} {imp:.3f}")

    model_path = os.path.join(args.outdir, "eta_model.joblib")
    joblib.dump({"model": model, "feature_cols": feature_cols}, model_path)
    print(f"\nSaved model -> {model_path}")

    # quick sanity check: predict a plausible new segment
    sample = pd.DataFrame([{
        "distance_km": 320, "sequence_no": 1, "vehicle_type_id": 9,
        "goods_type_id": 12, "hour_of_day": 14, "day_of_week": 2,
        "is_relay": 1, "load_ratio": 0.65, "per_km_rate": 55,
    }])
    sample_pred = model.predict(sample[feature_cols])[0]
    print(f"\nSample prediction: 320km relay leg -> {sample_pred:.0f} min "
          f"(~{sample_pred/60:.1f} hr)")


if __name__ == "__main__":
    main()
