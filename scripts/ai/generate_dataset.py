"""
VaxGuard - Synthetic Thermal Dataset Generator
=============================================

Generates a physics-grounded synthetic dataset that mimics the SHT31 sensor
readings (T_internal, T_ambient, RH) inside a passive cooler during the
"last mile" vaccine transport in tropical conditions (Benin-like climate).

The physics model:
- Newton's law of cooling for heat transfer through the cooler walls
- Solar irradiance bursts (sun exposure, lid opening)
- Thermal inertia modeled as a low-pass filter (R*C equivalent)
- Humidity coupled to temperature (relative humidity rises when T drops)
- Stochastic ambient noise (tropical day cycle)

Labels:
- minutes_to_threshold : minutes until T_internal crosses 8C destruction threshold
- risk_level           : 0 (safe), 1 (warning), 2 (critical)
- scenario             : normal | solar_burst | lid_open | ac_failure | recovery

Output: CSV at /home/z/my-project/download/data/vaxguard_thermal_dataset.csv
       + a few preview PNGs in the same folder
"""

import os
import math
import json
import random
from dataclasses import dataclass, field
from typing import List, Tuple

import numpy as np
import pandas as pd

# --- Reproducibility ---
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

# --- Physics constants ---
T_INIT_INTERNAL = 4.5          # °C : vaccines start cold (between 2-8°C)
T_INIT_AMBIENT  = 28.0         # °C : tropical morning ambient
T_DESTRUCTION   = 8.0          # °C : WHO threshold for vaccine degradation
RH_INIT         = 65.0          # % : relative humidity inside cooler

# Thermal model parameters (calibrated to mimic a real 25L passive cooler)
THERMAL_RESISTANCE = 2.5       # K/W (effective R of cooler wall + insulation)
THERMAL_CAPACITANCE = 12000.0  # J/K (water+payload thermal mass ~ 3L equiv)
SAMPLING_INTERVAL_S = 30.0     # s  : SHT31 read interval (matches prototype spec)

# Coupling factor: how much ambient heat flows into internal per step
# (simplified Newton cooling): dT/dt = (T_amb - T_int) / (R*C)
COUPLING = 1.0 / (THERMAL_RESISTANCE * THERMAL_CAPACITANCE)  # K per Joule
# Convert to per-step with energy flux from ambient
# Q = h*A*(T_amb - T_int)*dt ; h*A chosen so that thermal time constant ~3-4h
HA = 0.18  # W/K effective conductance (tuned so τ ~ 4h, matches real cooler)

# Day cycle for tropical ambient
def ambient_temperature(t_seconds: float, base: float = 28.0, peak: float = 38.0) -> float:
    """Simulate a tropical day with sinusoidal temperature + noise."""
    # day cycle: min at 5am, max at 2pm
    hour_of_day = (t_seconds / 3600.0) % 24.0
    phase = (hour_of_day - 5.0) / 24.0 * 2 * math.pi
    cycle = (math.sin(phase) + 1.0) / 2.0  # 0..1
    base_temp = base + (peak - base) * cycle
    noise = np.random.normal(0, 0.3)
    return base_temp + noise

def solar_burst_factor(t_seconds: float, scenario: str, scenario_start: float,
                       scenario_duration: float) -> float:
    """Additional heat flux when scenario = solar_burst or lid_open."""
    if scenario not in ("solar_burst", "lid_open"):
        return 0.0
    if not (scenario_start <= t_seconds < scenario_start + scenario_duration):
        return 0.0
    if scenario == "solar_burst":
        # 60 W/m²-equivalent extra flux into the cooler (sun beating directly)
        return 80.0  # W extra heat flow
    # lid_open: massive convective exchange
    return 220.0  # W extra heat flow (rapid warmup)


@dataclass
class Scenario:
    name: str
    duration_s: int
    event_start_s: int
    event_duration_s: int


SCENARIOS: List[Scenario] = [
    Scenario("normal",         6 * 3600, 0,         0),         # 6h, no event
    Scenario("solar_burst",    4 * 3600, 30 * 60,   45 * 60),   # 4h, sun at 30min for 45min
    Scenario("lid_open",       3 * 3600, 20 * 60,    8 * 60),   # 3h, lid open 8min at 20min
    Scenario("ac_failure",     8 * 3600, 60 * 60, 7 * 3600),    # 8h, slow drift
    Scenario("recovery",       5 * 3600, 25 * 60,   15 * 60),   # 5h, brief warmup then back to cool
]


def simulate_run(scenario: Scenario, run_id: int) -> pd.DataFrame:
    """Run a single thermal simulation, return sensor readings DataFrame."""
    n_steps = int(scenario.duration_s / SAMPLING_INTERVAL_S)
    t_arr = np.arange(n_steps) * SAMPLING_INTERVAL_S

    T_int = T_INIT_INTERNAL + np.random.normal(0, 0.1)
    T_amb_history = [T_INIT_AMBIENT] * n_steps
    T_int_history = np.zeros(n_steps)
    RH_history    = np.zeros(n_steps)
    extra_flux    = np.zeros(n_steps)
    anomaly_flag  = np.zeros(n_steps)

    for i, t in enumerate(t_arr):
        T_amb = ambient_temperature(t)
        T_amb_history[i] = T_amb

        flux_event = solar_burst_factor(
            t, scenario.name, scenario.event_start_s, scenario.event_duration_s
        )
        extra_flux[i] = flux_event

        # Recovery scenario: cooling back down after event (ice pack replenished)
        if scenario.name == "recovery" and t > scenario.event_start_s + scenario.event_duration_s:
            # Active cooling: -120W for 30 min after event
            recovery_window = 30 * 60
            if t < scenario.event_start_s + scenario.event_duration_s + recovery_window:
                flux_event -= 120.0

        # Net heat flux into internal: passive (HA * (T_amb - T_int)) + event flux
        net_flux = HA * (T_amb - T_int) + flux_event  # Watts

        # dT = (P * dt) / C
        dT_int = (net_flux * SAMPLING_INTERVAL_S) / THERMAL_CAPACITANCE
        T_int += dT_int
        T_int += np.random.normal(0, 0.02)  # sensor noise

        # SHT31 humidity: RH changes inversely with T (ideal gas approx)
        # RH_new = RH_old * (T_old+273)/(T_new+273) plus small drift
        rh = RH_INIT * (T_INIT_INTERNAL + 273.15) / (T_int + 273.15) + np.random.normal(0, 0.4)
        rh = max(20.0, min(99.0, rh))

        T_int_history[i] = T_int
        RH_history[i] = rh

        # Anomaly flag: 1 if event flux is happening OR T_int > 7.5°C
        anomaly_flag[i] = 1.0 if (flux_event > 0 or T_int > 7.5) else 0.0

    # Labels: minutes_to_threshold (forward-looking from each step)
    minutes_to_threshold = np.full(n_steps, np.nan)
    threshold_crossed = np.where(T_int_history >= T_DESTRUCTION)[0]
    if len(threshold_crossed) > 0:
        first_cross = threshold_crossed[0]
        for i in range(n_steps):
            if i < first_cross:
                minutes_to_threshold[i] = (first_cross - i) * SAMPLING_INTERVAL_S / 60.0
            else:
                minutes_to_threshold[i] = 0.0
    else:
        # never crosses threshold in this run
        minutes_to_threshold[:] = 999.0

    # Risk level: 0 safe, 1 warning (mtt < 30 min), 2 critical (mtt < 15 min)
    risk_level = np.zeros(n_steps, dtype=int)
    risk_level[(minutes_to_threshold < 30) & (minutes_to_threshold >= 15)] = 1
    risk_level[(minutes_to_threshold < 15) & (minutes_to_threshold >= 0)] = 2

    df = pd.DataFrame({
        "run_id": run_id,
        "step": np.arange(n_steps, dtype=int),
        "t_seconds": t_arr.astype(int),
        "t_minutes": (t_arr / 60.0).astype(float),
        "t_internal": T_int_history.round(4),
        "t_ambient":  np.array(T_amb_history).round(4),
        "humidity":   RH_history.round(2),
        "extra_flux_w": extra_flux.round(2),
        "anomaly":    anomaly_flag.astype(int),
        "scenario":   scenario.name,
        "minutes_to_threshold": minutes_to_threshold.round(2),
        "risk_level": risk_level,
    })
    return df


def generate_sequences_for_model(n_runs_per_scenario: int = 80,
                                 window_size: int = 30) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Generate windowed sequences for training the CNN-GRU model.

    Each window = 30 steps * 30s = 15 minutes of history (matches pitch 15-20 min horizon).
    Inputs per step: [t_internal, t_ambient, humidity] (3 features)
    Targets:
      - regression : minutes_to_threshold at last step
      - classification : risk_level at last step (3 classes)
    """
    all_windows = []
    all_mtt = []
    all_risk = []

    run_id = 0
    for scenario in SCENARIOS:
        for _ in range(n_runs_per_scenario):
            df = simulate_run(scenario, run_id)
            run_id += 1

            feats = df[["t_internal", "t_ambient", "humidity"]].values
            mtt = df["minutes_to_threshold"].values
            risk = df["risk_level"].values

            # slide window of 30 steps, stride 5
            for start in range(0, len(df) - window_size, 5):
                window = feats[start:start + window_size]
                all_windows.append(window)
                all_mtt.append(mtt[start + window_size - 1])
                all_risk.append(risk[start + window_size - 1])

    X = np.array(all_windows, dtype=np.float32)
    y_mtt = np.array(all_mtt, dtype=np.float32)
    y_risk = np.array(all_risk, dtype=np.int64)
    return X, y_mtt, y_risk


def main():
    out_dir = "/home/z/my-project/download/data"
    os.makedirs(out_dir, exist_ok=True)

    print("=" * 70)
    print("VaxGuard - Synthetic Thermal Dataset Generator")
    print("=" * 70)

    # 1) Generate full scenario runs (raw sensor data with labels) → CSV
    print("\n[1/3] Generating raw scenario runs...")
    all_runs = []
    for run_idx, scenario in enumerate(SCENARIOS):
        # 50 runs per scenario for the raw CSV
        for r in range(50):
            df = simulate_run(scenario, run_idx * 100 + r)
            all_runs.append(df)
    raw_df = pd.concat(all_runs, ignore_index=True)
    raw_csv = os.path.join(out_dir, "vaxguard_thermal_dataset.csv")
    raw_df.to_csv(raw_csv, index=False)
    print(f"   -> raw dataset: {raw_csv}")
    print(f"   -> total rows: {len(raw_df):,}")
    print(f"   -> scenarios: {raw_df['scenario'].value_counts().to_dict()}")
    print(f"   -> risk distribution: {raw_df['risk_level'].value_counts().to_dict()}")

    # 2) Generate windowed arrays (.npz) for training
    print("\n[2/3] Generating windowed training arrays...")
    X, y_mtt, y_risk = generate_sequences_for_model(n_runs_per_scenario=80, window_size=30)
    npz_path = os.path.join(out_dir, "vaxguard_train.npz")
    np.savez_compressed(npz_path, X=X, y_mtt=y_mtt, y_risk=y_risk)
    print(f"   -> train arrays: {npz_path}")
    print(f"   -> X shape: {X.shape}  (samples, timesteps, features)")
    print(f"   -> y_mtt shape: {y_mtt.shape}")
    print(f"   -> y_risk shape: {y_risk.shape}")

    # 3) Stats summary
    print("\n[3/3] Dataset summary:")
    print(f"   - mean minutes_to_threshold (train): {y_mtt.mean():.2f}")
    print(f"   - risk class distribution: 0={np.sum(y_risk==0)} 1={np.sum(y_risk==1)} 2={np.sum(y_risk==2)}")
    print(f"   - T_internal range: [{X[:,:,0].min():.2f}°C, {X[:,:,0].max():.2f}°C]")
    print(f"   - T_ambient  range: [{X[:,:,1].min():.2f}°C, {X[:,:,1].max():.2f}°C]")
    print(f"   - Humidity   range: [{X[:,:,2].min():.2f}%, {X[:,:,2].max():.2f}%]")

    summary = {
        "raw_csv": raw_csv,
        "train_npz": npz_path,
        "n_raw_rows": len(raw_df),
        "n_train_samples": int(X.shape[0]),
        "window_size": int(X.shape[1]),
        "n_features": int(X.shape[2]),
        "scenarios": [s.name for s in SCENARIOS],
        "sampling_interval_s": SAMPLING_INTERVAL_S,
        "t_destruction_c": T_DESTRUCTION,
        "stats": {
            "y_mtt_mean": float(y_mtt.mean()),
            "y_mtt_std":  float(y_mtt.std()),
            "risk_class_counts": {int(k): int(v) for k, v in zip(*np.unique(y_risk, return_counts=True))},
        },
    }
    with open(os.path.join(out_dir, "dataset_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\n   summary: {os.path.join(out_dir, 'dataset_summary.json')}")
    print("\nDone.")


if __name__ == "__main__":
    main()
