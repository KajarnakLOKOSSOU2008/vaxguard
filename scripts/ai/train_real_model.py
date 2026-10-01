"""
VaxGuard - Train CNN-GRU on REAL-grounded dataset
==================================================

Same architecture as v1, but trained on the REAL-grounded dataset
(Open-Meteo real Bénin weather + physics simulation).
"""

import os, json, time, sys
from typing import Tuple
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, f1_score, confusion_matrix

# --- Config ---
SEED = 42
DATA_PATH = "/home/z/my-project/download/data/vaxguard_real_train.npz"
MODEL_DIR = "/home/z/my-project/download/models"
EPOCHS = 25
BATCH = 256
LR = 1e-3
WINDOW = 30
N_FEATURES = 3
DEVICE = "cpu"

torch.manual_seed(SEED); np.random.seed(SEED)
os.makedirs(MODEL_DIR, exist_ok=True)


class VaxGuardCNN_GRU(nn.Module):
    def __init__(self, n_features=3, gru_hidden=32, n_risk_classes=3):
        super().__init__()
        self.conv1 = nn.Conv1d(n_features, 16, kernel_size=3, padding=1)
        self.conv2 = nn.Conv1d(16, 8, kernel_size=3, padding=1)
        self.gru = nn.GRU(input_size=8, hidden_size=gru_hidden, num_layers=1, batch_first=True)
        self.dropout = nn.Dropout(0.1)
        self.head_mtt = nn.Sequential(nn.Linear(gru_hidden, 16), nn.ReLU(), nn.Linear(16, 1))
        self.head_risk = nn.Sequential(nn.Linear(gru_hidden, 16), nn.ReLU(), nn.Linear(16, n_risk_classes))

    def forward(self, x):
        x = x.transpose(1, 2)
        x = F.relu(self.conv1(x))
        x = F.max_pool1d(x, 2)
        x = F.relu(self.conv2(x))
        x = x.transpose(1, 2)
        out, _ = self.gru(x)
        last = self.dropout(out[:, -1, :])
        return self.head_mtt(last).squeeze(-1), self.head_risk(last)


class ThermalDataset(Dataset):
    def __init__(self, X, y_mtt, y_risk):
        self.X = torch.from_numpy(X).float()
        self.y_mtt = torch.from_numpy(y_mtt).float()
        self.y_risk = torch.from_numpy(y_risk).long()
    def __len__(self): return len(self.X)
    def __getitem__(self, i): return self.X[i], self.y_mtt[i], self.y_risk[i]


def load_data():
    print(f"[data] loading {DATA_PATH}")
    d = np.load(DATA_PATH)
    X, y_mtt, y_risk = d["X"], d["y_mtt"], d["y_risk"]
    n = len(X)
    idx = np.random.permutation(n)
    n_train = int(0.8 * n); n_val = int(0.1 * n)
    flat = X[idx[:n_train]].reshape(-1, N_FEATURES)
    scaler = StandardScaler().fit(flat)
    X_norm = np.empty_like(X)
    X_norm[:] = scaler.transform(X.reshape(-1, N_FEATURES)).reshape(X.shape)
    return (X_norm[idx[:n_train]], y_mtt[idx[:n_train]], y_risk[idx[:n_train]],
            X_norm[idx[n_train:n_train+n_val]], y_mtt[idx[n_train:n_train+n_val]], y_risk[idx[n_train:n_train+n_val]],
            X_norm[idx[n_train+n_val:]], y_mtt[idx[n_train+n_val:]], y_risk[idx[n_train+n_val:]],
            scaler)


def train_one_epoch(model, loader, optimizer, mtt_loss_fn, risk_loss_fn):
    model.train()
    tot = 0; m_tot = 0; r_tot = 0; n = 0
    for X_b, y_m, y_r in loader:
        X_b, y_m, y_r = X_b.to(DEVICE), y_m.to(DEVICE), y_r.to(DEVICE)
        optimizer.zero_grad()
        mtt_p, risk_p = model(X_b)
        y_m_c = torch.clamp(y_m, 0.0, 240.0)
        loss_m = mtt_loss_fn(mtt_p, y_m_c)
        loss_r = risk_loss_fn(risk_p, y_r)
        loss = loss_m + 0.4 * loss_r
        loss.backward(); optimizer.step()
        bs = X_b.size(0)
        tot += loss.item()*bs; m_tot += loss_m.item()*bs; r_tot += loss_r.item()*bs; n += bs
    return tot/n, m_tot/n, r_tot/n


@torch.no_grad()
def evaluate(model, X, y_mtt, y_risk):
    model.eval()
    Xt = torch.from_numpy(X).float().to(DEVICE)
    mtt_p, risk_p = model(Xt)
    mtt_np = mtt_p.cpu().numpy()
    risk_np = risk_p.argmax(dim=-1).cpu().numpy()
    mae = mean_absolute_error(np.clip(y_mtt, 0, 240), np.clip(mtt_np, 0, 240))
    near = y_mtt < 60
    mae_near = mean_absolute_error(np.clip(y_mtt[near], 0, 240), np.clip(mtt_np[near], 0, 240)) if near.any() else 0
    f1 = f1_score(y_risk, risk_np, average="macro")
    f1c = f1_score(y_risk, risk_np, labels=[2], average="macro", zero_division=0) if (y_risk==2).any() else 0
    cm = confusion_matrix(y_risk, risk_np, labels=[0,1,2])
    return {"mtt_mae": float(mae), "mtt_mae_near": float(mae_near),
            "risk_f1_macro": float(f1), "risk_f1_critical": float(f1c),
            "confusion_matrix": cm.tolist()}


def main():
    print("="*70); print("VaxGuard - CNN-GRU training on REAL-grounded dataset"); print("="*70)
    (X_train, y_mtt_train, y_risk_train,
     X_val, y_mtt_val, y_risk_val,
     X_test, y_mtt_test, y_risk_test, scaler) = load_data()
    print(f"[data] train {X_train.shape} val {X_val.shape} test {X_test.shape}")

    scaler_path = os.path.join(MODEL_DIR, "scaler_real.npy")
    np.save(scaler_path, np.concatenate([scaler.mean_, scaler.scale_]))
    print(f"[save] scaler -> {scaler_path}")

    train_ds = ThermalDataset(X_train, y_mtt_train, y_risk_train)
    train_loader = DataLoader(train_ds, batch_size=BATCH, shuffle=True)

    model = VaxGuardCNN_GRU().to(DEVICE)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"[model] params: {n_params:,} ({n_params*4/1024:.1f} KB FP32)")

    counts = np.bincount(y_risk_train)
    class_w = counts.sum() / (3 * counts)
    class_w_t = torch.from_numpy(class_w).float().to(DEVICE)
    print(f"[model] class weights: {class_w.tolist()}")

    opt = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode="min", factor=0.5, patience=3)
    mtt_loss = nn.SmoothL1Loss()
    risk_loss = nn.CrossEntropyLoss(weight=class_w_t)

    best_mae = float("inf"); patience = 5; no_imp = 0; history = []
    for epoch in range(1, EPOCHS+1):
        t0 = time.time()
        tl, ml, rl = train_one_epoch(model, train_loader, opt, mtt_loss, risk_loss)
        vm = evaluate(model, X_val, y_mtt_val, y_risk_val)
        sched.step(vm["mtt_mae"])
        el = time.time() - t0
        history.append({"epoch": epoch, "train_loss": tl, **vm, "elapsed_s": el})
        print(f"  ep {epoch:3d} | loss {tl:6.3f} | mtt(val MAE) {vm['mtt_mae']:.2f} min | "
              f"near {vm['mtt_mae_near']:.2f} | F1 {vm['risk_f1_macro']:.3f} | {el:.1f}s")
        if vm["mtt_mae"] < best_mae - 0.01:
            best_mae = vm["mtt_mae"]; no_imp = 0
            torch.save(model.state_dict(), os.path.join(MODEL_DIR, "vaxguard_cnn_gru_real.pt"))
        else:
            no_imp += 1
            if no_imp >= patience: print(f"  early stop at epoch {epoch}"); break

    model.load_state_dict(torch.load(os.path.join(MODEL_DIR, "vaxguard_cnn_gru_real.pt")))
    test = evaluate(model, X_test, y_mtt_test, y_risk_test)
    print(f"\n[test] mtt MAE = {test['mtt_mae']:.2f} min | near MAE = {test['mtt_mae_near']:.2f}")
    print(f"[test] risk F1 macro = {test['risk_f1_macro']:.3f} | critical F1 = {test['risk_f1_critical']:.3f}")
    print(f"[test] confusion (rows=true, cols=pred, [safe,warn,crit]):")
    print(np.array(test["confusion_matrix"]))

    # TorchScript
    model.eval()
    example = torch.rand(1, WINDOW, N_FEATURES)
    ts = torch.jit.trace(model, example)
    ts_path = os.path.join(MODEL_DIR, "vaxguard_cnn_gru_real_ts.pt")
    ts.save(ts_path)
    ts_kb = os.path.getsize(ts_path) / 1024
    print(f"\n[export] TorchScript: {ts_path} ({ts_kb:.1f} KB)")

    # INT8 quant
    class Q(nn.Module):
        def __init__(self, o):
            super().__init__()
            self.conv1=o.conv1; self.conv2=o.conv2; self.gru=o.gru
            self.head_mtt=o.head_mtt; self.head_risk=o.head_risk; self.dropout=nn.Identity()
        def forward(self, x):
            x=x.transpose(1,2); x=F.relu(self.conv1(x)); x=F.max_pool1d(x,2); x=F.relu(self.conv2(x))
            x=x.transpose(1,2); out,_=self.gru(x); last=out[:,-1,:]
            return self.head_mtt(last).squeeze(-1), self.head_risk(last)

    qm = Q(model); qm.eval()
    q = torch.quantization.quantize_dynamic(qm, {nn.Linear, nn.GRU}, dtype=torch.qint8)
    q_path = os.path.join(MODEL_DIR, "vaxguard_cnn_gru_real_int8.pt")
    torch.save(q.state_dict(), q_path, _use_new_zipfile_serialization=True)
    q_kb = os.path.getsize(q_path) / 1024
    print(f"[export] INT8 quantized: {q_path} ({q_kb:.1f} KB)")
    qtest = evaluate(q, X_test, y_mtt_test, y_risk_test)
    print(f"[verify] INT8 MAE = {qtest['mtt_mae']:.2f} min | F1 = {qtest['risk_f1_macro']:.3f}")

    # Manifest
    manifest = {
        "model_name": "VaxGuard CNN-GRU (REAL-grounded)",
        "task": "Thermal peak prediction - REAL Open-Meteo Bénin weather + physics",
        "data_provenance": "Open-Meteo Archive API: Abomey, Bénin (lat 7.19, lng 2.04), Aug-Sep 2026, hourly observations",
        "input_shape": [WINDOW, N_FEATURES],
        "input_features": ["t_internal", "t_ambient", "humidity"],
        "n_params": int(n_params),
        "size_kb": {
            "fp32_state": round(os.path.getsize(os.path.join(MODEL_DIR, "vaxguard_cnn_gru_real.pt"))/1024, 1),
            "torchscript": round(ts_kb, 1),
            "int8_dynamic": round(q_kb, 1),
        },
        "esp32_feasibility": {
            "fits_int8": q_kb < 250,
            "esp32_s3_sram_kb": 512,
            "notes": "INT8 dynamic quant. Convert via ONNX->TFLite for ESP32 deployment.",
        },
        "test_metrics": test,
        "int8_metrics": qtest,
        "scaler_path": scaler_path,
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "files": {
            "fp32_state": os.path.join(MODEL_DIR, "vaxguard_cnn_gru_real.pt"),
            "torchscript": ts_path,
            "int8_state": q_path,
        },
    }
    with open(os.path.join(MODEL_DIR, "model_manifest_real.json"), "w") as f:
        json.dump(manifest, f, indent=2, default=str)
    print(f"\n[done] manifest: {os.path.join(MODEL_DIR, 'model_manifest_real.json')}")
    print(f"\n{'='*70}")
    print(f"  REAL-trained model. INT8 = {q_kb:.1f} KB ({'ESP32 OK' if q_kb<250 else 'TOO BIG'})")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
