# VaxGuard — Edge-AI Cold-Chain Monitoring

**Predictive CNN-GRU model + dashboard for last-mile vaccine transport in tropical climates.**

> 50% of vaccines are wasted due to cold-chain failures (WHO).
> VaxGuard transforms the passive cooler into a predictive, autonomous, internet-disconnected system that anticipates thermal peaks 15-20 minutes before they destroy the active principle.

## What this MVP delivers

| Component | Status | Tech | Path |
|-----------|--------|------|------|
| **Synthetic dataset** | 156k rows, 47k windows | Python (numpy, pandas) | `scripts/ai/generate_dataset.py` → `download/data/` |
| **CNN-GRU model** | 5,708 params, MAE 6.18 min, F1 0.771 | PyTorch | `scripts/ai/train_model.py` → `download/models/` |
| **INT8 quantization** | 16.9 KB (3.3% of ESP32-S3 SRAM) | PyTorch dynamic quant | `download/models/vaxguard_cnn_gru_int8.pt` |
| **ONNX export** | 32.9 KB (opset 13) | torch.onnx | `download/models/vaxguard_cnn_gru.onnx` |
| **AI service (REST + WS)** | port 8001 | FastAPI + uvicorn | `mini-services/ai-service/main.py` |
| **Dashboard (bilingue FR/EN)** | med-tech pro style, 6 sections | Next.js 16 + shadcn/ui + recharts | `src/app/page.tsx` + `src/components/vaxguard/` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ESP32-S3 (target deployment)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐  │
│  │  SHT31   │→ │  ESP32   │→ │  CNN-GRU INT8 (TFLite)  │  │
│  │  sensor  │  │  MCU     │  │  - input: (30, 3)        │  │
│  └──────────┘  └──────────┘  └──────────────────────────┘  │
│                       ↓                                     │
│                OLED + GSM alert                              │
└─────────────────────────────────────────────────────────────┘

        ⤓ same model, desktop dev ⤓

┌─────────────────────────────────────────────────────────────┐
│  Desktop dev (this MVP)                                      │
│  FastAPI service :8001  ←→  Next.js dashboard :3000         │
│  - Python thermal simulator (physics-based)                 │
│  - Real-time WebSocket stream                                │
│  - Predict + alert state machine                             │
│  - SMS auto-dispatch to nearest dispensary                   │
└─────────────────────────────────────────────────────────────┘
```

## Run locally

### 1) Start the AI service

```bash
bash scripts/start-ai-service.sh
# Verifies it's up
curl http://localhost:8001/health
```

### 2) Start the Next.js dashboard (auto-run)

The dev server (`bun run dev`) is already running on port 3000 and accessible via the preview link.

### 3) Play with the dashboard

Open the preview link → you'll see the live dashboard with:
- Live SHT31 sensor stream (T° interne, T° ambiante, RH)
- AI prediction (minutes to 8°C threshold + risk class + confidence)
- GPS map of Bénin (Abomey → Bohicon → Covè → Dasso loop)
- SMS alert log (auto-dispatched after 5 min simulated critical state)
- History of past expeditions
- Device config (thresholds, SMS delay, scenario picker)
- Model & ESP32 info panel with download buttons

**Try it:** Pick scenario "Soleil direct" in the header dropdown → wait ~60s → watch the temperature rise, AI transition to Vigilance then Critique, then SMS auto-dispatched to nearest dispensary.

## ESP32 deployment path (post-MVP)

The model is already INT8-quantized and ONNX-exported. To flash on ESP32-S3:

1. Convert ONNX → TensorFlow Lite: `onnx2tf -i vaxguard_cnn_gru.onnx -o tflite_model/`
2. Quantization-Aware Training (QAT) fine-tune for accuracy recovery
3. Convert TFLite → C header: `xxd -i model.tflite > model_data.h`
4. Flash firmware using TFLite-Micro-ESP32 + ESP-IDF
5. Wire SHT31 sensor + OLED + GSM module

Recommended runtime: **TensorFlow Lite Micro** (after `onnx2tf` conversion) or MicroTorch (custom).

## Model metrics (test set)

| Metric | FP32 | INT8 (delta) |
|--------|------|--------------|
| Minutes-to-threshold MAE | 6.18 min | 6.46 min (+0.28) |
| Near-threshold MAE (<60min) | 4.27 min | — |
| Risk F1 (macro) | 0.771 | 0.770 |
| Critical-class F1 | 0.978 | — |
| Model size | 45.2 KB (TS) | 16.9 KB |
| ESP32-S3 SRAM usage | — | 3.3% of 512 KB ✓ |

## Project structure

```
my-project/
├── scripts/
│   ├── ai/
│   │   ├── generate_dataset.py     # Synthetic thermal data (SHT31 + 5 scenarios)
│   │   ├── train_model.py          # CNN-GRU training + INT8 quant + ONNX
│   │   └── export_onnx.py          # ONNX export re-run
│   └── start-ai-service.sh         # Robust detached launcher
├── mini-services/
│   └── ai-service/
│       └── main.py                  # FastAPI + PyTorch + thermal simulator + WS
├── src/
│   ├── app/page.tsx                # Main dashboard (6 tabs)
│   ├── lib/{i18n,vaxguard-client}.ts
│   ├── hooks/use-vaxguard-stream.ts
│   └── components/vaxguard/        # 7 feature components
├── download/
│   ├── data/                       # Dataset (CSV, NPZ, summary)
│   ├── models/                     # PT, TorchScript, INT8, ONNX, manifest
│   └── dashboard_*.png             # Verification screenshots
└── worklog.md
```

## Dataset physics

The synthetic data is grounded on real thermal physics:
- Newton's law of cooling: `dT/dt = (T_amb - T_int) / (R*C)` with R=2.5 K/W, C=12000 J/K
- Effective conductance `HA = 0.18 W/K` → thermal time constant ~4h (matches real 25L passive cooler)
- Tropical day cycle: 28°C at 5am → 38°C at 2pm (sinusoidal + noise)
- Event fluxes:
  - Solar burst: +80 W for 45 min (sun beating on cooler)
  - Lid open: +220 W for 8 min (massive convective exchange)
  - AC failure: +25 W continuous (slow drift)
  - Recovery: +120 W burst then -120 W (ice pack refill)
- Humidity coupled to temperature via ideal gas approx
- 50 runs per scenario × 5 scenarios = 250 runs, 156k sensor readings
- Sliding window 30 steps × 5 stride = 47,520 training samples

## License

Open source. Built with PyTorch, FastAPI, Next.js, shadcn/ui, recharts.
