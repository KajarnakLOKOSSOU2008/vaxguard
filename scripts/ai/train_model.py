"""
VaxGuard - CNN-GRU Thermal Prediction Model (PyTorch)
=====================================================

Architecture (Edge-AI / TinyML friendly):
- Input  : (batch, 30, 3)  = 15 min of [T_internal, T_ambient, RH] at 30s cadence
- Block 1: Conv1d(3 -> 16, k=3, pad=1) + ReLU + MaxPool(2)   -> (batch, 16, 15)
- Block 2: Conv1d(16 -> 8, k=3, pad=1) + ReLU                -> (batch, 8, 15)
- GRU    : input 8, hidden 32, 1 layer, batch_first          -> (batch, 32)
- Head 1 : Linear(32 -> 16) + ReLU + Linear(16 -> 1)         -> minutes_to_threshold
- Head 2 : Linear(32 -> 16) + ReLU + Linear(16 -> 3)         -> risk_level (3 classes)

Total params ~5k -> INT8 quantized footprint < 8 KB (fits easily on ESP32-S3).

Pipeline:
1. Load dataset (vaxguard_train.npz)
2. Normalize features (scaler saved for inference)
3. Train (50 epochs, Adam, batch 256, early stopping)
4. Evaluate (MAE on mtt, F1 on risk)
5. Dynamic INT8 quantization (PTQE) -> save as TorchScript
6. Export ONNX (for TFLite Micro / Edge Impulse pipeline)
7. Report size metrics for ESP32 feasibility
"""

import os
import json
import time
from typing import Tuple, Dict

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, f1_score, confusion_matrix

# --- Config ---
SEED = 42
DATA_PATH = "/home/z/my-project/download/data/vaxguard_train.npz"
MODEL_DIR = "/home/z/my-project/download/models"
EPOCHS = 35
BATCH = 256
LR = 1e-3
WINDOW = 30
N_FEATURES = 3
DEVICE = "cpu"  # Edge inference is CPU

torch.manual_seed(SEED)
np.random.seed(SEED)
os.makedirs(MODEL_DIR, exist_ok=True)


# --- Model ---
class VaxGuardCNN_GRU(nn.Module):
    """Hybrid 1D CNN + GRU for thermal time-series prediction."""

    def __init__(self, n_features: int = 3, gru_hidden: int = 32, n_risk_classes: int = 3):
        super().__init__()
        self.conv1 = nn.Conv1d(n_features, 16, kernel_size=3, padding=1)
        self.conv2 = nn.Conv1d(16, 8, kernel_size=3, padding=1)
        self.gru = nn.GRU(input_size=8, hidden_size=gru_hidden,
                          num_layers=1, batch_first=True)
        self.dropout = nn.Dropout(0.1)
        self.head_mtt = nn.Sequential(nn.Linear(gru_hidden, 16), nn.ReLU(), nn.Linear(16, 1))
        self.head_risk = nn.Sequential(nn.Linear(gru_hidden, 16), nn.ReLU(), nn.Linear(16, n_risk_classes))

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        # x: (batch, timesteps, features) -> conv expects (batch, features, timesteps)
        x = x.transpose(1, 2)
        x = F.relu(self.conv1(x))
        x = F.max_pool1d(x, kernel_size=2)        # (batch, 16, timesteps/2)
        x = F.relu(self.conv2(x))                 # (batch, 8, timesteps/2)
        x = x.transpose(1, 2)                     # (batch, timesteps/2, 8) for GRU
        out, _ = self.gru(x)
        last = out[:, -1, :]                       # take last timestep
        last = self.dropout(last)
        mtt = self.head_mtt(last).squeeze(-1)      # (batch,)
        risk = self.head_risk(last)                # (batch, 3)
        return mtt, risk


class ThermalDataset(Dataset):
    def __init__(self, X: np.ndarray, y_mtt: np.ndarray, y_risk: np.ndarray):
        self.X = torch.from_numpy(X).float()
        self.y_mtt = torch.from_numpy(y_mtt).float()
        self.y_risk = torch.from_numpy(y_risk).long()

    def __len__(self): return len(self.X)
    def __getitem__(self, i):
        return self.X[i], self.y_mtt[i], self.y_risk[i]


def load_data() -> Tuple[np.ndarray, np.ndarray, np.ndarray,
                         np.ndarray, np.ndarray, np.ndarray,
                         StandardScaler]:
    print("[data] loading", DATA_PATH)
    d = np.load(DATA_PATH)
    X, y_mtt, y_risk = d["X"], d["y_mtt"], d["y_risk"]

    # Stratified-ish split: 80/10/10
    n = len(X)
    idx = np.random.permutation(n)
    n_train = int(0.8 * n)
    n_val = int(0.1 * n)
    train_idx = idx[:n_train]
    val_idx = idx[n_train:n_train + n_val]
    test_idx = idx[n_train + n_val:]

    # Fit scaler on train only
    flat = X[train_idx].reshape(-1, N_FEATURES)
    scaler = StandardScaler().fit(flat)
    X_norm = np.empty_like(X)
    X_norm[:] = scaler.transform(X.reshape(-1, N_FEATURES)).reshape(X.shape)

    return (X_norm[train_idx], y_mtt[train_idx], y_risk[train_idx],
            X_norm[val_idx],   y_mtt[val_idx],   y_risk[val_idx],
            X_norm[test_idx],  y_mtt[test_idx],  y_risk[test_idx],
            scaler)


def train_one_epoch(model, loader, optimizer, mtt_loss_fn, risk_loss_fn,
                    risk_weight=0.5, mtt_weight=1.0):
    model.train()
    total_loss = 0.0
    total_mtt_loss = 0.0
    total_risk_loss = 0.0
    n = 0
    for X_b, y_mtt_b, y_risk_b in loader:
        X_b = X_b.to(DEVICE)
        y_mtt_b = y_mtt_b.to(DEVICE)
        y_risk_b = y_risk_b.to(DEVICE)

        optimizer.zero_grad()
        mtt_pred, risk_pred = model(X_b)

        # Clip mtt target to [0, 240] to focus learning on actionable horizon
        y_mtt_clipped = torch.clamp(y_mtt_b, 0.0, 240.0)
        loss_mtt = mtt_loss_fn(mtt_pred, y_mtt_clipped)

        loss_risk = risk_loss_fn(risk_pred, y_risk_b)

        loss = mtt_weight * loss_mtt + risk_weight * loss_risk
        loss.backward()
        optimizer.step()

        bs = X_b.size(0)
        total_loss += loss.item() * bs
        total_mtt_loss += loss_mtt.item() * bs
        total_risk_loss += loss_risk.item() * bs
        n += bs
    return total_loss / n, total_mtt_loss / n, total_risk_loss / n


@torch.no_grad()
def evaluate(model, X, y_mtt, y_risk):
    model.eval()
    X_t = torch.from_numpy(X).float().to(DEVICE)
    mtt_pred, risk_pred = model(X_t)
    mtt_pred_np = mtt_pred.cpu().numpy()
    risk_pred_np = risk_pred.argmax(dim=-1).cpu().numpy()

    mtt_mae = mean_absolute_error(np.clip(y_mtt, 0, 240), np.clip(mtt_pred_np, 0, 240))
    # For samples where ground truth is "near threshold" (< 60 min), error matters most
    near_mask = y_mtt < 60
    mtt_mae_near = mean_absolute_error(np.clip(y_mtt[near_mask], 0, 240),
                                       np.clip(mtt_pred_np[near_mask], 0, 240)) if near_mask.any() else 0.0

    risk_f1_macro = f1_score(y_risk, risk_pred_np, average="macro")
    risk_f1_critical = f1_score(y_risk, risk_pred_np, labels=[2], average="macro",
                                 zero_division=0) if (y_risk == 2).any() else 0.0
    cm = confusion_matrix(y_risk, risk_pred_np, labels=[0, 1, 2])
    return {
        "mtt_mae":        float(mtt_mae),
        "mtt_mae_near":   float(mtt_mae_near),
        "risk_f1_macro": float(risk_f1_macro),
        "risk_f1_critical": float(risk_f1_critical),
        "confusion_matrix": cm.tolist(),
        "mtt_pred_sample": mtt_pred_np[:10].tolist(),
        "mtt_truth_sample": np.clip(y_mtt, 0, 240)[:10].tolist(),
    }


def main():
    print("=" * 70)
    print("VaxGuard - CNN-GRU Training")
    print("=" * 70)

    # 1) Data
    (X_train, y_mtt_train, y_risk_train,
     X_val,   y_mtt_val,   y_risk_val,
     X_test,  y_mtt_test,  y_risk_test,
     scaler) = load_data()
    print(f"[data] train: {X_train.shape}  val: {X_val.shape}  test: {X_test.shape}")

    # Save scaler for inference
    scaler_path = os.path.join(MODEL_DIR, "scaler.npy")
    np.save(scaler_path, np.concatenate([scaler.mean_, scaler.scale_]))
    print(f"[save] scaler -> {scaler_path}")

    train_ds = ThermalDataset(X_train, y_mtt_train, y_risk_train)
    train_loader = DataLoader(train_ds, batch_size=BATCH, shuffle=True, num_workers=0)

    # 2) Model
    model = VaxGuardCNN_GRU().to(DEVICE)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"[model] CNN-GRU params: {n_params:,}  ({n_params * 4 / 1024:.1f} KB FP32)")

    # Class weights for risk head (heavily imbalanced: class 1 warning is rare)
    counts = np.bincount(y_risk_train)
    class_weights = counts.sum() / (3 * counts)
    class_weights_t = torch.from_numpy(class_weights).float().to(DEVICE)
    print(f"[model] class weights: {class_weights.tolist()}")

    optimizer = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
    mtt_loss_fn = nn.SmoothL1Loss()
    risk_loss_fn = nn.CrossEntropyLoss(weight=class_weights_t)

    # 3) Train
    best_val_mae = float("inf")
    patience = 5
    no_improve = 0
    history = []
    for epoch in range(1, EPOCHS + 1):
        t0 = time.time()
        train_loss, train_mtt, train_risk = train_one_epoch(
            model, train_loader, optimizer, mtt_loss_fn, risk_loss_fn,
            risk_weight=0.4, mtt_weight=1.0
        )
        val_metrics = evaluate(model, X_val, y_mtt_val, y_risk_val)
        scheduler.step(val_metrics["mtt_mae"])
        elapsed = time.time() - t0
        history.append({"epoch": epoch, "train_loss": train_loss,
                        "train_mtt": train_mtt, "train_risk": train_risk,
                        **val_metrics, "elapsed_s": elapsed})
        print(f"  ep {epoch:3d} | loss {train_loss:6.3f} | mtt(val MAE) {val_metrics['mtt_mae']:.2f} min "
              f"| mtt_near {val_metrics['mtt_mae_near']:.2f} | risk F1 {val_metrics['risk_f1_macro']:.3f} "
              f"| {elapsed:.1f}s")

        if val_metrics["mtt_mae"] < best_val_mae - 0.01:
            best_val_mae = val_metrics["mtt_mae"]
            no_improve = 0
            torch.save(model.state_dict(), os.path.join(MODEL_DIR, "vaxguard_cnn_gru.pt"))
        else:
            no_improve += 1
            if no_improve >= patience:
                print(f"  early stop at epoch {epoch}")
                break

    # 4) Load best and evaluate on test
    model.load_state_dict(torch.load(os.path.join(MODEL_DIR, "vaxguard_cnn_gru.pt")))
    test_metrics = evaluate(model, X_test, y_mtt_test, y_risk_test)
    print(f"\n[test] mtt MAE = {test_metrics['mtt_mae']:.2f} min | near-threshold MAE = {test_metrics['mtt_mae_near']:.2f} min")
    print(f"[test] risk F1 macro = {test_metrics['risk_f1_macro']:.3f} | critical F1 = {test_metrics['risk_f1_critical']:.3f}")
    print(f"[test] confusion matrix (rows=true, cols=pred, classes=[safe, warn, crit]):")
    print(np.array(test_metrics["confusion_matrix"]))
    print(f"[test] mtt pred sample: {[round(v, 1) for v in test_metrics['mtt_pred_sample']]}")
    print(f"[test] mtt truth sample: {[round(v, 1) for v in test_metrics['mtt_truth_sample']]}")

    # 5) TorchScript export (for inference)
    model.eval()
    example = torch.rand(1, WINDOW, N_FEATURES)
    traced = torch.jit.trace(model, example)
    ts_path = os.path.join(MODEL_DIR, "vaxguard_cnn_gru_ts.pt")
    traced.save(ts_path)
    ts_size_kb = os.path.getsize(ts_path) / 1024
    print(f"\n[export] TorchScript: {ts_path}  ({ts_size_kb:.1f} KB)")

    # 6) Dynamic INT8 quantization (post-training)
    class QuantizableCNN_GRU(nn.Module):
        """Wrapper that fuses Conv+ReLU for quantization, keeps GRU + heads."""
        def __init__(self, orig: VaxGuardCNN_GRU):
            super().__init__()
            # Manually fuse conv1 + relu (the rest of layers quantize naturally)
            self.conv1 = orig.conv1
            self.conv2 = orig.conv2
            self.gru = orig.gru
            self.head_mtt = orig.head_mtt
            self.head_risk = orig.head_risk
            self.dropout = nn.Identity()  # remove for inference

        def forward(self, x):
            x = x.transpose(1, 2)
            x = F.relu(self.conv1(x))
            x = F.max_pool1d(x, 2)
            x = F.relu(self.conv2(x))
            x = x.transpose(1, 2)
            out, _ = self.gru(x)
            last = out[:, -1, :]
            mtt = self.head_mtt(last).squeeze(-1)
            risk = self.head_risk(last)
            return mtt, risk

    quant_model = QuantizableCNN_GRU(model)
    quant_model.eval()
    # Apply dynamic quantization to Linear layers (GRU stays fp32 - PyTorch dynamic quant supports Linear & LSTM/GRU)
    quantized = torch.quantization.quantize_dynamic(
        quant_model,
        {nn.Linear, nn.GRU},
        dtype=torch.qint8
    )
    q_path = os.path.join(MODEL_DIR, "vaxguard_cnn_gru_int8.pt")
    torch.save(quantized.state_dict(), q_path)
    q_size_kb = os.path.getsize(q_path) / 1024
    print(f"[export] INT8 quantized: {q_path}  ({q_size_kb:.1f} KB)")

    # Verify INT8 model still predicts correctly
    quant_metrics = evaluate(quantized, X_test, y_mtt_test, y_risk_test)
    print(f"[verify] INT8 mtt MAE = {quant_metrics['mtt_mae']:.2f} min | F1 = {quant_metrics['risk_f1_macro']:.3f}")
    print(f"[verify] MAE delta vs FP32 = {abs(quant_metrics['mtt_mae'] - test_metrics['mtt_mae']):.3f} min")

    # 7) ONNX export (path to TFLite Micro / Edge Impulse for ESP32)
    onnx_path = os.path.join(MODEL_DIR, "vaxguard_cnn_gru.onnx")
    try:
        torch.onnx.export(
            model, example, onnx_path,
            export_params=True, opset_version=13,
            input_names=["sensor_window"],
            output_names=["mtt", "risk_logits"],
            dynamic_axes={"sensor_window": {0: "batch"}, "mtt": {0: "batch"}, "risk_logits": {0: "batch"}},
        )
        onnx_size_kb = os.path.getsize(onnx_path) / 1024
        print(f"[export] ONNX: {onnx_path}  ({onnx_size_kb:.1f} KB)")
    except Exception as e:
        print(f"[export] ONNX failed: {e}")
        onnx_size_kb = -1

    # 8) Final manifest (for dashboard display & ESP32 deployment notes)
    manifest = {
        "model_name": "VaxGuard CNN-GRU",
        "task": "Thermal peak prediction (last-mile vaccine transport)",
        "input_shape": [WINDOW, N_FEATURES],
        "input_features": ["t_internal", "t_ambient", "humidity"],
        "input_window_minutes": WINDOW * 30 / 60,  # 30 steps * 30s = 15 min
        "prediction_horizon_label": "minutes_to_threshold (T_internal crossing 8°C)",
        "outputs": {
            "mtt": "float (minutes to 8°C threshold)",
            "risk": "int (0=safe, 1=warning, 2=critical)",
        },
        "n_params": int(n_params),
        "size_kb": {
            "fp32_pt":       round(os.path.getsize(os.path.join(MODEL_DIR, "vaxguard_cnn_gru.pt")) / 1024, 1),
            "torchscript":   round(ts_size_kb, 1),
            "int8_dynamic":  round(q_size_kb, 1),
            "onnx":          round(onnx_size_kb, 1) if onnx_size_kb > 0 else None,
        },
        "esp32_feasibility": {
            "fits_int8":       q_size_kb < 250,    # ESP32-S3 has 512KB SRAM, plenty for 8KB
            "esp32_s3_sram_kb": 512,
            "recommended_runtime": "TensorFlow Lite Micro (after ONNX->TFLite via onnx2tf) or MicroTorch (custom)",
            "notes": "INT8 dynamic quant reduces Linear+GRU weights to 1 byte each. For ESP32 deployment, convert ONNX->TFLite via onnx2tf+tflite, then quantize-aware retrain (QAT) is recommended.",
        },
        "test_metrics": test_metrics,
        "int8_metrics": quant_metrics,
        "training_history": history,
        "scaler_path": scaler_path,
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "files": {
            "fp32_state_dict": os.path.join(MODEL_DIR, "vaxguard_cnn_gru.pt"),
            "torchscript":      os.path.join(MODEL_DIR, "vaxguard_cnn_gru_ts.pt"),
            "int8_state_dict":  os.path.join(MODEL_DIR, "vaxguard_cnn_gru_int8.pt"),
            "onnx":             onnx_path,
        },
    }
    with open(os.path.join(MODEL_DIR, "model_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, default=str)
    print(f"\n[done] manifest: {os.path.join(MODEL_DIR, 'model_manifest.json')}")
    print("\n" + "=" * 70)
    print(f"  Model trained and ready. INT8 size: {q_size_kb:.1f} KB "
          f"({'ESP32 OK' if q_size_kb < 250 else 'TOO BIG'})")
    print("=" * 70)


if __name__ == "__main__":
    main()
