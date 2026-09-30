"""
VaxGuard AI Service - FastAPI + PyTorch + Real-time Thermal Simulator
====================================================================

Runs on port 8001. Provides:
  - REST: /api/predict, /api/scenarios, /api/sms/dispatch, /api/dispensaires, /api/info, /api/history
  - WS  : /stream  (real-time sensor stream + AI predictions + alert events)

The thermal simulator generates a synthetic SHT31 stream at 1 step per second
of real time, where each step = 30s of simulated mission time.
A scenario (normal/solar_burst/lid_open/ac_failure/recovery) controls the
physics injected into the stream.
"""

import os
import json
import math
import asyncio
import random
import time
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, field, asdict

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# --- Paths ---
PROJECT_ROOT = "/home/z/my-project"
MODEL_TS_PATH = os.path.join(PROJECT_ROOT, "download/models/vaxguard_cnn_gru_ts.pt")
MODEL_INT8_PATH = os.path.join(PROJECT_ROOT, "download/models/vaxguard_cnn_gru_int8.pt")
SCALER_PATH = os.path.join(PROJECT_ROOT, "download/models/scaler.npy")
MANIFEST_PATH = os.path.join(PROJECT_ROOT, "download/models/model_manifest.json")
DATA_CSV = os.path.join(PROJECT_ROOT, "download/data/vaxguard_thermal_dataset.csv")
DB_PATH = os.path.join(PROJECT_ROOT, "mini-services/ai-service/vaxguard_history.json")

PORT = 8001
WINDOW = 30  # 30 steps = 15 min simulated mission
N_FEATURES = 3
T_DESTRUCTION = 8.0  # °C

# --- Physics constants (must match generate_dataset.py) ---
T_INIT_INTERNAL = 4.5
T_INIT_AMBIENT  = 28.0
RH_INIT         = 65.0
HA = 0.18
THERMAL_CAPACITANCE = 12000.0
SAMPLING_INTERVAL_S = 30.0

# --- Dispensaries (Bénin - representative GPS coords) ---
DISPENSAIRES = [
    {"id": "dzovou",      "name": "Centre de Santé de Dasso",          "lat": 7.0767,  "lng": 2.2256,  "phone": "+22966000001"},
    {"id": "abomey",      "name": "Hôpital de Zone d'Abomey",           "lat": 7.1886,  "lng": 2.0419,  "phone": "+22966000002"},
    {"id": "cove",        "name": "Dispensaire de Covè",                "lat": 7.2261,  "lng": 2.3222,  "phone": "+22966000003"},
    {"id": "bohicon",     "name": "Centre Médical de Bohicon",         "lat": 7.1811,  "lng": 2.5547,  "phone": "+22966000004"},
    {"id": "za-Kpota",    "name": "Poste de Santé de Za-Kpota",        "lat": 7.4333,  "lng": 2.0833,  "phone": "+22966000005"},
    {"id": "oudo",        "name": "Centre de Santé d'Oudotchedji",      "lat": 7.3500,  "lng": 2.5000,  "phone": "+22966000006"},
]

# --- Vehicle route (Bénin, Abomey-Bohicon-Covè-Dasso loop) ---
ROUTE_WAYPOINTS = [
    (7.1886, 2.0419),  # Abomey
    (7.1811, 2.3),     # midpoint
    (7.1811, 2.5547),  # Bohicon
    (7.2261, 2.3222),  # Covè
    (7.0767, 2.2256),  # Dasso
]

# --- Scenarios ---
SCENARIOS_AVAILABLE = {
    "normal":       {"label_fr": "Normal",          "label_en": "Normal",            "description": "Glacière fermée, ombre, transport nominal"},
    "solar_burst":  {"label_fr": "Soleil direct",   "label_en": "Direct sunlight",    "description": "Véhicule stationné sous soleil de plomb 45 min"},
    "lid_open":     {"label_fr": "Glacière ouverte","label_en": "Lid open",           "description": "Ouverture brève mais massive convexion"},
    "ac_failure":   {"label_fr": "Panne clim.",    "label_en": "AC failure",          "description": "Dérive thermique lente sur 8h"},
    "recovery":     {"label_fr": "Récupération",   "label_en": "Recovery",            "description": "Pic puis re-glacement d'urgence"},
}

# --- Quantizable CNN-GRU class (must match train_model.py) ---
class QuantizableCNN_GRU(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv1d(3, 16, 3, padding=1)
        self.conv2 = nn.Conv1d(16, 8, 3, padding=1)
        self.gru = nn.GRU(input_size=8, hidden_size=32, num_layers=1, batch_first=True)
        self.dropout = nn.Dropout(0.1)
        self.head_mtt = nn.Sequential(nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 1))
        self.head_risk = nn.Sequential(nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 3))

    def forward(self, x):
        x = x.transpose(1, 2)
        x = F.relu(self.conv1(x))
        x = F.max_pool1d(x, 2)
        x = F.relu(self.conv2(x))
        x = x.transpose(1, 2)
        out, _ = self.gru(x)
        last = out[:, -1, :]
        last = self.dropout(last)
        mtt = self.head_mtt(last).squeeze(-1)
        risk = self.head_risk(last)
        return mtt, risk


def load_model():
    """Load the INT8 quantized model. Falls back to TorchScript if needed."""
    if os.path.exists(MODEL_INT8_PATH):
        try:
            m = QuantizableCNN_GRU()
            m = torch.quantization.quantize_dynamic(m, {nn.Linear, nn.GRU}, dtype=torch.qint8)
            m.load_state_dict(torch.load(MODEL_INT8_PATH, map_location="cpu", weights_only=False))
            m.eval()
            print(f"[model] Loaded INT8 quantized model ({os.path.getsize(MODEL_INT8_PATH)/1024:.1f} KB)")
            return m, "int8"
        except Exception as e:
            print(f"[model] INT8 load failed: {e}; falling back to TorchScript")
    # Fallback: TorchScript FP32
    m = torch.jit.load(MODEL_TS_PATH, map_location="cpu")
    m.eval()
    return m, "torchscript_fp32"


def load_scaler():
    arr = np.load(SCALER_PATH)
    return arr[:3], arr[3:]  # mean, scale


MODEL, MODEL_KIND = load_model()
SCALER_MEAN, SCALER_SCALE = load_scaler()

# Manifest for the /api/info endpoint
with open(MANIFEST_PATH) as f:
    MANIFEST = json.load(f)


# --- JSON helper for numpy types ---
class NpEncoder(json.JSONEncoder):
    """JSON encoder that handles numpy types."""
    def default(self, o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o)
        if isinstance(o, (np.ndarray,)):
            return o.tolist()
        if isinstance(o, (np.bool_,)):
            return bool(o)
        return super().default(o)


def safe_json_dumps(o) -> str:
    return json.dumps(o, default=lambda x: float(x) if isinstance(x, (np.floating, np.integer)) else str(x))


# --- Live session state ---
@dataclass
class LiveSession:
    """Active simulation session - one per AI service (single user)."""
    scenario: str = "normal"
    t_internal: float = T_INIT_INTERNAL
    t_ambient: float = T_INIT_AMBIENT
    humidity: float = RH_INIT
    t_seconds: int = 0  # simulated mission seconds
    step: int = 0
    is_running: bool = True
    history_buffer: List[Dict[str, Any]] = field(default_factory=list)  # last N readings
    predictions_log: List[Dict[str, Any]] = field(default_factory=list)
    sms_log: List[Dict[str, Any]] = field(default_factory=list)
    alerts_state: str = "normal"  # normal | warning | critical | sms_sent
    last_alert_at_sim_s: Optional[int] = None  # simulated mission seconds when alert triggered
    vehicle_route_progress: float = 0.0  # 0..1 along route
    vehicle_lat: float = ROUTE_WAYPOINTS[0][0]
    vehicle_lng: float = ROUTE_WAYPOINTS[0][1]
    nearest_dispensaire: Optional[Dict] = None
    threshold_c: float = 8.0
    sms_delay_s: int = 300  # 5 min
    sensor_interval_s: int = 30  # SHT31 cadence
    demo_speed: float = 1.0  # 1 step = 1 real second; each step = 30 simulated sec


SESSION = LiveSession()
CLIENTS: List[WebSocket] = []
HISTORY_DB: List[Dict] = []  # persisted expeditions (in-memory + file)


# --- Physics simulation (one step) ---
def ambient_temperature(t_seconds: float) -> float:
    hour_of_day = (t_seconds / 3600.0) % 24.0
    phase = (hour_of_day - 5.0) / 24.0 * 2 * math.pi
    cycle = (math.sin(phase) + 1.0) / 2.0
    base_temp = 28.0 + (38.0 - 28.0) * cycle
    return base_temp + np.random.normal(0, 0.3)


def scenario_extra_flux(scenario: str, t_seconds: float) -> float:
    """Extra heat flux based on current scenario + t_seconds."""
    if scenario == "solar_burst":
        # Sun beating for 45 min after 30 min
        if 30 * 60 <= t_seconds < 30 * 60 + 45 * 60:
            return 80.0 + np.random.normal(0, 4)
    elif scenario == "lid_open":
        # 8 min lid open at 20 min
        if 20 * 60 <= t_seconds < 20 * 60 + 8 * 60:
            return 220.0 + np.random.normal(0, 8)
    elif scenario == "ac_failure":
        # Slow drift: extra 25W constant
        return 25.0 + np.random.normal(0, 2)
    elif scenario == "recovery":
        # 15 min warmup at 25 min, then -120W for 30 min (ice refill)
        if 25 * 60 <= t_seconds < 25 * 60 + 15 * 60:
            return 120.0
        if 25 * 60 + 15 * 60 <= t_seconds < 25 * 60 + 15 * 60 + 30 * 60:
            return -120.0
    return 0.0


def step_simulation(session: LiveSession) -> Dict[str, Any]:
    """Advance simulation by one step (30 simulated seconds)."""
    if not session.is_running:
        return None

    t = session.t_seconds
    T_amb = ambient_temperature(t)
    flux_event = scenario_extra_flux(session.scenario, t)

    net_flux = HA * (T_amb - session.t_internal) + flux_event
    dT = (net_flux * SAMPLING_INTERVAL_S) / THERMAL_CAPACITANCE
    session.t_internal += dT + np.random.normal(0, 0.02)
    session.humidity = max(20.0, min(99.0,
        RH_INIT * (T_INIT_INTERNAL + 273.15) / (session.t_internal + 273.15)
        + np.random.normal(0, 0.4)
    ))
    session.t_ambient = T_amb
    session.t_seconds += int(SAMPLING_INTERVAL_S)
    session.step += 1

    # Vehicle route progress: complete one loop per 4h simulated
    session.vehicle_route_progress = (session.t_seconds / (4 * 3600)) % 1.0
    # interpolate along route
    n = len(ROUTE_WAYPOINTS)
    f = session.vehicle_route_progress * (n - 1)
    i = int(f)
    frac = f - i
    if i >= n - 1:
        i = n - 2
        frac = 1.0
    session.vehicle_lat = ROUTE_WAYPOINTS[i][0] + (ROUTE_WAYPOINTS[i+1][0] - ROUTE_WAYPOINTS[i][0]) * frac
    session.vehicle_lng = ROUTE_WAYPOINTS[i][1] + (ROUTE_WAYPOINTS[i+1][1] - ROUTE_WAYPOINTS[i][1]) * frac

    # Find nearest dispensaire
    best = None
    best_d = float("inf")
    for d in DISPENSAIRES:
        dist_deg = math.sqrt((d["lat"] - session.vehicle_lat)**2 + (d["lng"] - session.vehicle_lng)**2)
        if dist_deg < best_d:
            best_d = dist_deg
            best = d
    # Add distance in km (approx)
    if best is not None:
        best_km = best_d * 111.0
        best = {**best, "distance_km": round(best_km, 1)}
    session.nearest_dispensaire = best

    # Reading dict
    reading = {
        "step": session.step,
        "t_seconds": session.t_seconds,
        "t_minutes": round(session.t_seconds / 60.0, 1),
        "t_internal": round(session.t_internal, 3),
        "t_ambient":  round(T_amb, 3),
        "humidity":   round(session.humidity, 2),
        "extra_flux_w": round(flux_event, 1),
        "scenario": session.scenario,
        "vehicle_lat": round(session.vehicle_lat, 6),
        "vehicle_lng": round(session.vehicle_lng, 6),
        "nearest_dispensaire": session.nearest_dispensaire,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    session.history_buffer.append(reading)
    # keep last 240 steps (2h mission) in memory
    if len(session.history_buffer) > 240:
        session.history_buffer = session.history_buffer[-240:]
    return reading


def run_prediction(session: LiveSession) -> Dict[str, Any]:
    """Run model inference on the last WINDOW readings."""
    if len(session.history_buffer) < WINDOW:
        return {"ready": False, "reason": "buffer_warmup", "have": len(session.history_buffer), "need": WINDOW}

    window = session.history_buffer[-WINDOW:]
    feats = np.array([[r["t_internal"], r["t_ambient"], r["humidity"]] for r in window], dtype=np.float32)
    # Cast mean/scale to float32 to avoid promotion to float64
    feats_norm = ((feats - SCALER_MEAN.astype(np.float32)) / SCALER_SCALE.astype(np.float32)).astype(np.float32)
    x = torch.from_numpy(feats_norm).unsqueeze(0)  # (1, 30, 3)

    with torch.no_grad():
        mtt_pred, risk_logits = MODEL(x)
        mtt_val = float(mtt_pred.squeeze().item())
        risk_probs = F.softmax(risk_logits, dim=-1).squeeze().tolist()
        risk_class = int(risk_logits.argmax(dim=-1).item())

    # Clip & floor predictions for display
    mtt_clipped = max(0.0, min(240.0, mtt_val))
    # confidence = max prob
    confidence = max(risk_probs)

    # Map risk class to label
    risk_label = ["safe", "warning", "critical"][risk_class]

    return {
        "ready": True,
        "minutes_to_threshold": round(mtt_clipped, 2),
        "risk_class": risk_class,
        "risk_label": risk_label,
        "risk_probs": [round(p, 4) for p in risk_probs],
        "confidence": round(confidence, 3),
        "threshold_c": session.threshold_c,
        "step": session.step,
        "t_internal_current": session.history_buffer[-1]["t_internal"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# --- Alerting logic ---
def check_and_alert(session: LiveSession, prediction: Dict[str, Any]):
    """Transition alert state machine + dispatch SMS if needed (uses SIMULATED time)."""
    if not prediction.get("ready"):
        return None

    risk = prediction["risk_class"]
    now_real = time.time()
    now_sim = session.t_seconds  # simulated mission seconds

    events = []

    # State transitions
    if risk == 2 and session.alerts_state != "critical":
        session.alerts_state = "critical"
        session.last_alert_at_sim_s = now_sim
        events.append({
            "type": "alert_critical",
            "message_fr": f"⚠️ ALERTE CRITIQUE : pic thermique prédit dans {prediction['minutes_to_threshold']:.0f} min",
            "message_en": f"⚠️ CRITICAL ALERT: thermal peak predicted in {prediction['minutes_to_threshold']:.0f} min",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    elif risk == 1 and session.alerts_state == "normal":
        session.alerts_state = "warning"
        session.last_alert_at_sim_s = now_sim
        events.append({
            "type": "alert_warning",
            "message_fr": f"Attention : dérive thermique détectée ({prediction['minutes_to_threshold']:.0f} min au seuil)",
            "message_en": f"Warning: thermal drift detected ({prediction['minutes_to_threshold']:.0f} min to threshold)",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    elif risk == 0:
        session.alerts_state = "normal"
        session.last_alert_at_sim_s = None

    # SMS dispatch after waiting period (in simulated time)
    if session.alerts_state == "critical" and session.last_alert_at_sim_s is not None:
        elapsed_sim = now_sim - session.last_alert_at_sim_s
        if elapsed_sim >= session.sms_delay_s and not any(s.get("auto") for s in session.sms_log[-3:]):
            sms = {
                "id": f"sms_{int(now_real*1000)}",
                "auto": True,
                "phone": session.nearest_dispensaire["phone"] if session.nearest_dispensaire else "+22966000000",
                "recipient": session.nearest_dispensaire["name"] if session.nearest_dispensaire else "Dispensaire inconnu",
                "message": (f"VAXGUARD ALERT: Expedition {session.step} | T_interne={session.t_internal:.1f}C | "
                            f"MTT={prediction['minutes_to_threshold']:.0f}min | "
                            f"GPS={session.vehicle_lat:.4f},{session.vehicle_lng:.4f} | "
                            f"Dispensaire le plus proche: {session.nearest_dispensaire['name'] if session.nearest_dispensaire else 'N/A'}"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "lat": session.vehicle_lat,
                "lng": session.vehicle_lng,
            }
            session.sms_log.append(sms)
            events.append({"type": "sms_dispatched", "sms": sms})

    return events if events else None


# --- Background simulator task ---
async def simulation_loop():
    """Run simulation at 1 Hz, push to all WS clients."""
    last_step_time = time.time()
    while True:
        if SESSION.is_running:
            reading = step_simulation(SESSION)
            if reading:
                # Run prediction if buffer ready
                prediction = run_prediction(SESSION)
                # Check alerts
                events = check_and_alert(SESSION, prediction) if prediction.get("ready") else None
                # Log prediction for history
                if prediction.get("ready"):
                    SESSION.predictions_log.append({
                        **prediction,
                        "scenario": SESSION.scenario,
                        "t_internal": reading["t_internal"],
                    })
                    if len(SESSION.predictions_log) > 600:
                        SESSION.predictions_log = SESSION.predictions_log[-600:]

                # Broadcast to all clients
                msg = {
                    "type": "tick",
                    "reading": reading,
                    "prediction": prediction,
                    "alert_state": SESSION.alerts_state,
                    "events": events or [],
                    "session": {
                        "scenario": SESSION.scenario,
                        "step": SESSION.step,
                        "is_running": SESSION.is_running,
                        "threshold_c": SESSION.threshold_c,
                        "sms_delay_s": SESSION.sms_delay_s,
                        "sensor_interval_s": SESSION.sensor_interval_s,
                        "history_buffer_size": len(SESSION.history_buffer),
                        "sms_count": len(SESSION.sms_log),
                    },
                }
                # Serialize safely (numpy float64 -> Python float)
                msg_str = safe_json_dumps(msg)
                dead = []
                for ws in CLIENTS:
                    try:
                        await ws.send_text(msg_str)
                    except Exception:
                        dead.append(ws)
                for ws in dead:
                    if ws in CLIENTS:
                        CLIENTS.remove(ws)
        await asyncio.sleep(1.0)


# --- FastAPI app ---
app = FastAPI(title="VaxGuard AI Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    asyncio.create_task(simulation_loop())
    print(f"[service] VaxGuard AI service started on port {PORT}")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "vaxguard-ai", "model_kind": MODEL_KIND, "port": PORT}


@app.get("/api/info")
async def info():
    """Return model manifest info for dashboard display."""
    return {
        "model_name": MANIFEST.get("model_name"),
        "model_kind": MODEL_KIND,
        "n_params": MANIFEST.get("n_params"),
        "input_shape": MANIFEST.get("input_shape"),
        "input_features": MANIFEST.get("input_features"),
        "prediction_horizon_label": MANIFEST.get("prediction_horizon_label"),
        "outputs": MANIFEST.get("outputs"),
        "test_metrics": MANIFEST.get("test_metrics"),
        "int8_metrics": MANIFEST.get("int8_metrics"),
        "sizes_kb": MANIFEST.get("size_kb"),
        "esp32_feasibility": MANIFEST.get("esp32_feasibility"),
        "threshold_c": T_DESTRUCTION,
        "window_size": WINDOW,
    }


@app.get("/api/scenarios")
async def scenarios():
    return {"scenarios": SCENARIOS_AVAILABLE, "current": SESSION.scenario}


class ScenarioChange(BaseModel):
    scenario: str
    reset: bool = False


@app.post("/api/scenario/set")
async def set_scenario(req: ScenarioChange):
    if req.scenario not in SCENARIOS_AVAILABLE:
        raise HTTPException(400, f"unknown scenario: {req.scenario}")
    SESSION.scenario = req.scenario
    if req.reset:
        SESSION.t_internal = T_INIT_INTERNAL
        SESSION.t_ambient = T_INIT_AMBIENT
        SESSION.humidity = RH_INIT
        SESSION.t_seconds = 0
        SESSION.step = 0
        SESSION.history_buffer.clear()
        SESSION.predictions_log.clear()
        SESSION.alerts_state = "normal"
        SESSION.last_alert_at_sim_s = None
    return {"status": "ok", "scenario": SESSION.scenario, "reset": req.reset}


class ControlReq(BaseModel):
    running: bool


@app.post("/api/control")
async def control(req: ControlReq):
    SESSION.is_running = req.running
    return {"is_running": SESSION.is_running}


class ConfigReq(BaseModel):
    threshold_c: Optional[float] = None
    sms_delay_s: Optional[int] = None
    sensor_interval_s: Optional[int] = None


@app.post("/api/config")
async def config(req: ConfigReq):
    if req.threshold_c is not None:  SESSION.threshold_c = req.threshold_c
    if req.sms_delay_s is not None:  SESSION.sms_delay_s = max(60, req.sms_delay_s)
    if req.sensor_interval_s is not None: SESSION.sensor_interval_s = max(5, req.sensor_interval_s)
    return {
        "threshold_c": SESSION.threshold_c,
        "sms_delay_s": SESSION.sms_delay_s,
        "sensor_interval_s": SESSION.sensor_interval_s,
    }


@app.get("/api/dispensaires")
async def dispensaires():
    return {"dispensaires": DISPENSAIRES, "route": [{"lat": la, "lng": ln} for la, ln in ROUTE_WAYPOINTS]}


class PredictReq(BaseModel):
    window: List[List[float]]  # (30, 3)


@app.post("/api/predict")
async def predict(req: PredictReq):
    if len(req.window) != WINDOW or any(len(r) != N_FEATURES for r in req.window):
        raise HTTPException(400, f"window must be ({WINDOW},{N_FEATURES})")
    feats = np.array(req.window, dtype=np.float32)
    feats_norm = ((feats - SCALER_MEAN.astype(np.float32)) / SCALER_SCALE.astype(np.float32)).astype(np.float32)
    x = torch.from_numpy(feats_norm).unsqueeze(0)
    with torch.no_grad():
        mtt_pred, risk_logits = MODEL(x)
        mtt_val = float(mtt_pred.squeeze().item())
        risk_probs = F.softmax(risk_logits, dim=-1).squeeze().tolist()
        risk_class = int(risk_logits.argmax(dim=-1).item())
    return {
        "minutes_to_threshold": max(0.0, min(240.0, mtt_val)),
        "risk_class": risk_class,
        "risk_label": ["safe", "warning", "critical"][risk_class],
        "risk_probs": [round(p, 4) for p in risk_probs],
        "confidence": round(max(risk_probs), 3),
    }


class SmsReq(BaseModel):
    manual: bool = True


@app.post("/api/sms/dispatch")
async def sms_dispatch(req: SmsReq):
    sms = {
        "id": f"sms_manual_{int(time.time()*1000)}",
        "auto": not req.manual,
        "phone": SESSION.nearest_dispensaire["phone"] if SESSION.nearest_dispensaire else "+22966000000",
        "recipient": SESSION.nearest_dispensaire["name"] if SESSION.nearest_dispensaire else "Dispensaire inconnu",
        "message": (f"VAXGUARD MANUAL ALERT | Expedition step={SESSION.step} | "
                    f"T_interne={SESSION.t_internal:.1f}C | "
                    f"GPS={SESSION.vehicle_lat:.4f},{SESSION.vehicle_lng:.4f}"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "lat": SESSION.vehicle_lat,
        "lng": SESSION.vehicle_lng,
    }
    SESSION.sms_log.append(sms)
    return {"status": "ok", "sms": sms, "total_dispatched": len(SESSION.sms_log)}


@app.get("/api/sms/log")
async def sms_log():
    return {"log": SESSION.sms_log[-50:], "total": len(SESSION.sms_log)}


@app.get("/api/history")
async def history():
    """Return recent sensor history + predictions for charts."""
    return {
        "readings": SESSION.history_buffer[-200:],
        "predictions": SESSION.predictions_log[-200:],
        "session": {
            "scenario": SESSION.scenario,
            "step": SESSION.step,
            "t_seconds": SESSION.t_seconds,
            "is_running": SESSION.is_running,
            "alert_state": SESSION.alerts_state,
        },
    }


@app.get("/api/expeditions")
async def expeditions():
    """List past expeditions (loaded from file if exists)."""
    if os.path.exists(DB_PATH):
        with open(DB_PATH) as f:
            return {"expeditions": json.load(f)}
    # No persisted expeditions yet — return seeded demo
    seed = [
        {"id": "exp_001", "vehicle": "Benin-ColdTruck-01", "route": "Abomey -> Bohicon",
         "scenario": "normal", "duration_min": 240, "alert_count": 0,
         "sms_count": 0, "min_mtt": 240.0, "ended_at": "2026-09-28T16:00:00Z"},
        {"id": "exp_002", "vehicle": "Benin-ColdTruck-01", "route": "Bohicon -> Covè",
         "scenario": "solar_burst", "duration_min": 180, "alert_count": 3,
         "sms_count": 1, "min_mtt": 12.5, "ended_at": "2026-09-29T11:30:00Z"},
        {"id": "exp_003", "vehicle": "Moto-ColdBox-02", "route": "Covè -> Dasso",
         "scenario": "lid_open", "duration_min": 90, "alert_count": 5,
         "sms_count": 2, "min_mtt": 4.2, "ended_at": "2026-09-29T15:00:00Z"},
        {"id": "exp_004", "vehicle": "Moto-ColdBox-02", "route": "Dasso -> Za-Kpota",
         "scenario": "recovery", "duration_min": 300, "alert_count": 2,
         "sms_count": 0, "min_mtt": 18.0, "ended_at": "2026-09-30T09:15:00Z"},
    ]
    with open(DB_PATH, "w") as f:
        json.dump(seed, f, indent=2)
    return {"expeditions": seed}


@app.post("/api/expeditions/save")
async def save_expedition(req: Request):
    """Persist current session as an expedition."""
    body = await req.json()
    if os.path.exists(DB_PATH):
        with open(DB_PATH) as f:
            db = json.load(f)
    else:
        db = []
    db.append(body)
    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2)
    return {"status": "ok", "total": len(db)}


@app.get("/api/download")
async def download(type: str = "manifest"):
    """Serve model files for download."""
    if type == "int8":
        path = MODEL_INT8_PATH
        if not os.path.exists(path):
            raise HTTPException(404, "INT8 model not found")
        return FileResponse(path, filename="vaxguard_cnn_gru_int8.pt",
                             media_type="application/octet-stream")
    elif type == "onnx":
        path = os.path.join(PROJECT_ROOT, "download/models/vaxguard_cnn_gru.onnx")
        if not os.path.exists(path):
            raise HTTPException(404, "ONNX model not found")
        return FileResponse(path, filename="vaxguard_cnn_gru.onnx",
                             media_type="application/octet-stream")
    elif type == "torchscript":
        path = MODEL_TS_PATH
        if not os.path.exists(path):
            raise HTTPException(404, "TorchScript model not found")
        return FileResponse(path, filename="vaxguard_cnn_gru_ts.pt",
                             media_type="application/octet-stream")
    elif type == "fp32":
        path = os.path.join(PROJECT_ROOT, "download/models/vaxguard_cnn_gru.pt")
        if not os.path.exists(path):
            raise HTTPException(404, "FP32 model not found")
        return FileResponse(path, filename="vaxguard_cnn_gru.pt",
                             media_type="application/octet-stream")
    elif type == "manifest":
        return FileResponse(MANIFEST_PATH, filename="vaxguard_manifest.json",
                             media_type="application/json")
    elif type == "scaler":
        path = SCALER_PATH
        if not os.path.exists(path):
            raise HTTPException(404, "Scaler not found")
        return FileResponse(path, filename="vaxguard_scaler.npy",
                             media_type="application/octet-stream")
    elif type == "dataset":
        path = os.path.join(PROJECT_ROOT, "download/data/vaxguard_thermal_dataset.csv")
        if not os.path.exists(path):
            raise HTTPException(404, "Dataset not found")
        return FileResponse(path, filename="vaxguard_thermal_dataset.csv",
                             media_type="text/csv")
    else:
        raise HTTPException(400, f"unknown download type: {type}")


@app.websocket("/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    CLIENTS.append(ws)
    # Send a snapshot immediately
    snapshot = {
        "type": "snapshot",
        "reading": SESSION.history_buffer[-1] if SESSION.history_buffer else None,
        "history": SESSION.history_buffer[-200:],
        "predictions": SESSION.predictions_log[-200:],
        "session": {
            "scenario": SESSION.scenario,
            "step": SESSION.step,
            "is_running": SESSION.is_running,
            "threshold_c": SESSION.threshold_c,
            "sms_delay_s": SESSION.sms_delay_s,
            "alert_state": SESSION.alerts_state,
            "sms_count": len(SESSION.sms_log),
        },
        "dispensaires": DISPENSAIRES,
        "route": [{"lat": la, "lng": ln} for la, ln in ROUTE_WAYPOINTS],
        "vehicle": {"lat": SESSION.vehicle_lat, "lng": SESSION.vehicle_lng,
                    "nearest": SESSION.nearest_dispensaire},
    }
    try:
        await ws.send_text(safe_json_dumps(snapshot))
        while True:
            # Receive any client commands (e.g. ping)
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ws] error: {e}")
    finally:
        if ws in CLIENTS:
            CLIENTS.remove(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
