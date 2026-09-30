# VaxGuard — Predictive Edge-AI Cold-Chain Monitoring

> **Hackathon Small IA — Banque Mondiale**
>
> VaxGuard transforms passive vaccine coolers into predictive, autonomous, internet-disconnected systems. A CNN-GRU model (17.2 KB INT8) runs on the ESP32-S3 in Edge-AI mode, while a Gemma 2B LLM provides natural-language interpretation server-side.
>
> **Problem**: 50% of vaccines are wasted annually due to cold-chain failures (WHO). In tropical Bénin, the "last mile" is critical — passive coolers fail silently when the heat breaks down vaccine molecular structure.
>
> **Solution**: AI predicts thermal peaks 15-20 min before they breach the 8°C destruction threshold, triggering driver alerts + automatic SMS to the nearest dispensary.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  EDGE LAYER (ESP32-S3, target deployment)                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────────────┐    │
│  │  SHT31   │→ │  ESP32   │→ │  CNN-GRU INT8 (17.2 KB)          │    │
│  │  sensor  │  │  -S3     │  │  TFLite Micro runtime            │    │
│  └──────────┘  └──────────┘  └──────────────────────────────────┘    │
│                       ↓ OLED display + GSM alert                      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
        ⤓ sync via GSM (no Internet required on vehicle) ⤓
┌──────────────────────────────────────────────────────────────────────┐
│  SERVER LAYER (dispensary tablet, this MVP)                          │
│  ┌───────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  FastAPI service :8001    │  │  Gemma 2B LLM (1.4 GB IQ3_M)     │  │
│  │  - thermal simulator      │→ │  - interprets CNN-GRU preds      │  │
│  │  - WS real-time stream    │  │  - generates FR recommendations  │  │
│  │  - CNN-GRU inference      │  │  - 2B params (Small IA)          │  │
│  └───────────────────────────┘  └─────────────────────────────────┘  │
│                                                                       │
│  Next.js dashboard :3000 (or static GitHub Pages demo)               │
│  - 7 tabs: Live / Prédiction / Carte / SMS / Gemma / Config / Modèle │
│  - Bilingue FR/EN, med-tech pro style                                 │
└──────────────────────────────────────────────────────────────────────┘
```

## Two-layer AI

| Layer | Model | Size | Where | Purpose |
|-------|-------|------|-------|---------|
| **Edge AI** | CNN-GRU (1D Conv + GRU + dual heads) | 17.2 KB (INT8) | ESP32-S3 | Real-time thermal peak prediction, 100% offline |
| **Small IA LLM** | Gemma 2B Instruct | 1.4 GB (IQ3_M GGUF) | Dispensary server | Natural-language analysis + actionable recommendations in French |

The CNN-GRU predicts minutes-to-threshold + risk class (safe/warning/critical). Gemma 2B interprets these predictions and generates a 3-part analysis (diagnosis + driver action + dispensary action) in natural French.

## Real data provenance

The training dataset is **grounded in REAL weather observations** from Open-Meteo:

- **Source**: Open-Meteo Archive API (free, no auth)
- **Location**: Abomey, Bénin (lat 7.19, lng 2.04) — the actual VaxGuard pilot region
- **Period**: August 1 → September 30, 2026 (61 days, 1,464 hourly observations)
- **Variables**: temperature_2m, relative_humidity_2m, surface_pressure, wind_speed_10m, shortwave_radiation
- **Physics**: Internal cooler temperature computed via Newton's cooling law + thermal capacitance + solar absorption applied to REAL ambient inputs

This is a **digital-twin** approach: the dataset represents what a real passive cooler would do if placed in Abomey during the pilot period, exposed to the real weather conditions.

> Files: `download/data/benin_abomey_real_weather.json` (real raw), `vaxguard_real_dataset.csv` (physics-applied)

## CNN-GRU metrics (REAL-trained)

| Metric | FP32 | INT8 | Delta |
|--------|------|------|-------|
| Minutes-to-threshold MAE | 7.39 min | 7.40 min | +0.01 |
| Near-threshold MAE (<60 min) | 1.97 min | — | — |
| Risk F1 (macro) | 0.742 | 0.740 | -0.002 |
| Critical-class F1 | 0.984 | — | — |
| Size | 28 KB (state dict) | 17.2 KB | -38% |
| ESP32-S3 SRAM usage | — | 3.3% of 512 KB ✓ | — |

## Project structure

```
vaxguard/
├── .github/workflows/deploy-pages.yml   # GitHub Actions for Pages deploy
├── scripts/
│   ├── ai/
│   │   ├── generate_real_dataset.py     # Real Open-Meteo data → physics-grounded dataset
│   │   ├── train_real_model.py          # CNN-GRU training + INT8 quant + ONNX export
│   │   ├── generate_dataset.py          # (legacy) synthetic dataset
│   │   └── train_model.py               # (legacy) training on synthetic
│   ├── dev/download-gemma.sh           # Fetch Gemma 2B GGUF (1.4 GB)
│   └── start-ai-service.sh             # Robust detached launcher
├── mini-services/
│   └── ai-service/
│       ├── main.py                     # FastAPI + WS + thermal simulator + Gemma integration
│       └── gemma_analyzer.py           # Gemma 2B LLM analyzer (llama-cpp-python)
├── src/
│   ├── app/page.tsx                    # 7-tab dashboard
│   ├── lib/{i18n,vaxguard-client}.ts   # FR/EN i18n + typed API client
│   ├── hooks/use-vaxguard-stream.ts    # WS hook with static demo fallback
│   └── components/vaxguard/
│       ├── header.tsx                  # Logo + scenario picker + lang toggle
│       ├── live-monitoring.tsx         # SHT31 sensor charts (recharts)
│       ├── ai-prediction.tsx           # MTT + risk + probability distribution + trajectory
│       ├── gps-map.tsx                 # Custom SVG Bénin map with vehicle + dispensaries
│       ├── sms-alerts.tsx              # SMS log with auto + manual dispatch
│       ├── gemma-panel.tsx             # Gemma 2B analysis panel (NEW for Small IA hackathon)
│       ├── history.tsx                 # Expeditions + analytics
│       ├── device-config.tsx           # Thresholds + scenario picker
│       └── ai-info.tsx                 # Model metrics + ESP32 deploy pipeline
├── download/
│   ├── data/                           # Real weather + physics-grounded dataset
│   ├── models/                         # CNN-GRU FP32 / TorchScript / INT8 / ONNX
│   └── dashboard_*.png                 # Verification screenshots
└── README.md (this file)
```

## Run locally

### Prerequisites
- Python 3.10+ (for AI service + training)
- Bun (for Next.js dev server)
- ~5 GB free disk (for Gemma 2B model)

### 1. Train the model on real data (already done, artifacts committed)

```bash
# Fetch real Bénin weather (optional - already cached in download/data/)
python3 scripts/ai/generate_real_dataset.py
# Train CNN-GRU
python3 scripts/ai/train_real_model.py
```

### 2. Download Gemma 2B (1.4 GB, one-time)

```bash
bash scripts/dev/download-gemma.sh
```

### 3. Start the AI service (FastAPI + PyTorch + Gemma 2B)

```bash
bash scripts/start-ai-service.sh
# Health check
curl http://localhost:8001/health
```

### 4. Start the Next.js dashboard (auto-run via dev.sh)

```bash
bun install
bun run dev   # → http://localhost:3000
```

### 5. Play with the dashboard

Open the preview link → 7 tabs:
- **Live**: SHT31 sensor charts + 8°C threshold + AI status badge
- **Prédiction**: MTT number + risk class + probability distribution + 30-min horizon + trajectory (real + projected)
- **Carte**: SVG map of Bénin with vehicle + dispensaries + nearest dispensary
- **SMS**: Log of dispatched SMS (auto + manual) with GPS coords
- **Gemma 2B**: LLM analysis panel — click "Lancer l'analyse Gemma" for a fresh analysis (~90s CPU)
- **Config**: Threshold sliders (4-15°C), SMS delay, sensor interval, scenario picker
- **Modèle**: CNN-GRU architecture, FP32/INT8/ONNX sizes, test metrics, ESP32-S3 compatibility, deployment pipeline

**Try it**: Pick scenario "Soleil direct" → wait ~60s → temperature rises → AI transitions Sûr → Vigilance → Critique → SMS auto-dispatched → click "Lancer l'analyse Gemma" → see natural-language analysis.

## GitHub Pages deployment

The dashboard auto-deploys to GitHub Pages via `.github/workflows/deploy-pages.yml`:

1. On push to `main`, the workflow runs:
   - Builds the dashboard with `NEXT_PUBLIC_STATIC_DEMO=true`
   - Uses sample data (since the FastAPI AI service can't run on Pages)
   - Uploads the `out/` directory as a Pages artifact
2. Deploys to `https://<username>.github.io/<repo-name>/`

The static demo shows the same UI as the live version, with sample data so judges can navigate the interface without running the backend.

## ESP32-S3 deployment path (post-hackathon)

The CNN-GRU model is already INT8-quantized (17.2 KB = 3.3% of ESP32-S3's 512 KB SRAM).

```bash
# 1. Convert ONNX → TFLite
pip install onnx2tf tensorflow
onnx2tf -i download/models/vaxguard_cnn_gru_real.onnx -o tflite_model/

# 2. Quantization-Aware Training (optional, for accuracy recovery)
# 3. Convert TFLite → C header
xxd -i tflite_model/model.tflite > model_data.h

# 4. Flash firmware
# Use TFLite-Micro-ESP32 + ESP-IDF
# Wire SHT31 sensor + OLED + SIM800L GSM module
```

## Hackathon pitch

**Problem** (15s): 50% of vaccines wasted annually. In Bénin's "last mile", tropical heat silently destroys vaccine molecular structure during transport.

**Solution** (30s): VaxGuard = Edge-AI CNN-GRU model (17.2 KB) on ESP32-S3 that predicts thermal peaks 15-20 min before they breach the 8°C threshold. 100% offline. Auto-SMS to nearest dispensary if driver doesn't react in 5 min.

**Innovation** (45s): Two-layer Small-IA architecture:
1. **Edge AI**: CNN-GRU INT8 quantized, 17.2 KB, runs on ESP32-S3, 7.4 min MAE, F1 critique 0.984
2. **Server LLM**: Gemma 2B (2B params) interprets predictions, generates French recommendations for driver + dispensary

**Real data**: Trained on REAL Bénin weather (Open-Meteo, 1464 hours of observations) + physics-based cooler simulation = digital twin grounded in real conditions.

**Impact**: Each alert saved = dozens of vaccine doses preserved. Last-mile vaccine waste eliminated.

## License

Open source (MIT). Built with PyTorch, FastAPI, Next.js, shadcn/ui, recharts, llama-cpp-python, HuggingFace.

Gemma 2B model © Google, used under Gemma Terms of Use.
