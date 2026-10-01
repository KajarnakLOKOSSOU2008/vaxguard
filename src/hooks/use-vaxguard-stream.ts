"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  buildWsUrl,
  VaxGuardClient,
  type Reading,
  type Prediction,
  type SessionState,
  type StreamMessage,
  type Dispensary,
  type ModelInfo,
  type ScenarioInfo,
  type Expedition,
  type GemmaAnalysis,
} from "@/lib/vaxguard-client";

// Static demo mode: when running on GitHub Pages (no FastAPI backend available)
const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "true";

// Sample data for static demo (mirrors the live dashboard at its best)
const DEMO_READINGS: Reading[] = Array.from({ length: 30 }, (_, i) => {
  const step = i;
  const t_sec = step * 30;
  const t_int = 4.5 + step * 0.12;
  return {
    step,
    t_seconds: t_sec,
    t_minutes: t_sec / 60,
    t_internal: Math.round(t_int * 100) / 100,
    t_ambient: 28 + Math.sin(step / 5) * 2,
    humidity: 65 - step * 0.2,
    extra_flux_w: step > 20 ? 80 : 0,
    scenario: "solar_burst",
    vehicle_lat: 7.1886 + step * 0.001,
    vehicle_lng: 2.0419 + step * 0.002,
    nearest_dispensaire: {
      id: "abomey",
      name: "Hôpital de Zone d'Abomey",
      lat: 7.1886, lng: 2.0419,
      phone: "+22966000002",
      distance_km: 4.5,
    },
    timestamp: new Date(Date.now() - (30 - step) * 1000).toISOString(),
  };
});

const DEMO_PREDICTION: Prediction = {
  ready: true,
  minutes_to_threshold: 12.5,
  risk_class: 2,
  risk_label: "critical",
  risk_probs: [0.05, 0.08, 0.87],
  confidence: 0.87,
  threshold_c: 8.0,
  step: 30,
  t_internal_current: 7.5,
  timestamp: new Date().toISOString(),
};

const DEMO_SESSION: SessionState = {
  scenario: "solar_burst",
  step: 30,
  is_running: true,
  threshold_c: 8.0,
  sms_delay_s: 300,
  sensor_interval_s: 30,
  history_buffer_size: 30,
  sms_count: 1,
  alert_state: "critical",
};

const DEMO_DISPENSAIRES: Dispensary[] = [
  { id: "abomey", name: "Hôpital de Zone d'Abomey", lat: 7.1886, lng: 2.0419, phone: "+22966000002", distance_km: 4.5 },
  { id: "bohicon", name: "Centre Médical de Bohicon", lat: 7.1811, lng: 2.5547, phone: "+22966000004" },
  { id: "cove", name: "Dispensaire de Covè", lat: 7.2261, lng: 2.3222, phone: "+22966000003" },
  { id: "dasso", name: "Centre de Santé de Dasso", lat: 7.0767, lng: 2.2256, phone: "+22966000001" },
];

const DEMO_ROUTE = [
  { lat: 7.1886, lng: 2.0419 },
  { lat: 7.1811, lng: 2.3 },
  { lat: 7.1811, lng: 2.5547 },
  { lat: 7.2261, lng: 2.3222 },
  { lat: 7.0767, lng: 2.2256 },
];

const DEMO_EXPEDITIONS: Expedition[] = [
  { id: "exp_001", vehicle: "Benin-ColdTruck-01", route: "Abomey → Bohicon", scenario: "normal", duration_min: 240, alert_count: 0, sms_count: 0, min_mtt: 240.0, ended_at: "2026-09-28T16:00:00Z" },
  { id: "exp_002", vehicle: "Benin-ColdTruck-01", route: "Bohicon → Covè", scenario: "solar_burst", duration_min: 180, alert_count: 3, sms_count: 1, min_mtt: 12.5, ended_at: "2026-09-29T11:30:00Z" },
  { id: "exp_003", vehicle: "Moto-ColdBox-02", route: "Covè → Dasso", scenario: "lid_open", duration_min: 90, alert_count: 5, sms_count: 2, min_mtt: 4.2, ended_at: "2026-09-29T15:00:00Z" },
  { id: "exp_004", vehicle: "Moto-ColdBox-02", route: "Dasso → Za-Kpota", scenario: "recovery", duration_min: 300, alert_count: 2, sms_count: 0, min_mtt: 18.0, ended_at: "2026-09-30T09:15:00Z" },
];

const DEMO_GEMMA_LOG: GemmaAnalysis[] = [
  {
    ready: true,
    analysis: "## Analyse de la situation:\n\n**1. Diagnostic:** La prédiction d'un franchissement du seuil de 8°C dans les prochaines 12 minutes signale un risque critique de dégradation des vaccins. La température interne a déjà atteint 7.5°C, soit 0.5°C sous le seuil de destruction.\n\n**2. Action recommandée pour le chauffeur:** Arrêter immédiatement le véhicule et déplacer la glacière à l'ombre, vérifier l'étanchéité du couvercle.\n\n**3. Action recommandée pour le dispensaire:** Préparer des blocs de glace de substitution et dispatcher une équipe mobile pour intercepter le véhicule si le chauffeur ne réagit pas dans les 5 minutes.",
    inference_time_s: 95.2,
    tokens_prompt: 259,
    tokens_completion: 138,
    model: "gemma-2-2b-it (Q3_IQ3_M)",
    lang: "fr",
    timestamp: Date.now() / 1000,
    scenario: "solar_burst",
    step: 30,
    auto: true,
  },
];

const DEMO_MODEL_INFO: ModelInfo = {
  model_name: "VaxGuard CNN-GRU (REAL-grounded)",
  model_kind: "int8",
  n_params: 5708,
  input_shape: [30, 3],
  input_features: ["t_internal", "t_ambient", "humidity"],
  prediction_horizon_label: "minutes_to_threshold (T_internal crossing 8°C)",
  outputs: { mtt: "float (minutes to 8°C threshold)", risk: "int (0=safe, 1=warning, 2=critical)" },
  test_metrics: { mtt_mae: 7.39, mtt_mae_near: 1.97, risk_f1_macro: 0.742, risk_f1_critical: 0.984, confusion_matrix: [[545, 100, 0], [4, 60, 1], [40, 80, 3580]] },
  int8_metrics: { mtt_mae: 7.40, risk_f1_macro: 0.740 },
  sizes_kb: { fp32_pt: 28.2, torchscript: 45.6, int8_dynamic: 17.2, onnx: 32.9 },
  esp32_feasibility: { fits_int8: true, esp32_s3_sram_kb: 512, recommended_runtime: "TFLite Micro (after ONNX->TFLite via onnx2tf)", notes: "INT8 dynamic quant reduces Linear+GRU weights to 1 byte each." },
  data_provenance: "Open-Meteo Archive API: Abomey, Bénin (lat 7.19, lng 2.04), Aug-Sep 2026, hourly observations",
  threshold_c: 8.0,
  window_size: 30,
};

const DEMO_GEMMA_INFO = {
  available: true,
  loaded: true,
  model_name: "Gemma 2B (google/gemma-2-2b-it)",
  quantization: "IQ3_M GGUF (~1.4 GB)",
  framework: "llama-cpp-python (CPU)",
  params_billions: 2.0,
  size_mb: 1329.0,
};

const DEMO_SMS_LOG = [
  {
    id: "sms_auto_1",
    auto: true,
    phone: "+22966000002",
    recipient: "Hôpital de Zone d'Abomey",
    message: "VAXGUARD ALERT: Expedition 30 | T_interne=8.0C | MTT=12min | GPS=7.1886,2.0419 | Dispensaire le plus proche: Hôpital de Zone d'Abomey",
    timestamp: new Date(Date.now() - 60000).toISOString(),
    lat: 7.1886,
    lng: 2.0419,
  },
];

export interface VaxGuardState {
  connected: boolean;
  reading: Reading | null;
  history: Reading[];
  prediction: Prediction | null;
  predictionHistory: any[];
  session: SessionState | null;
  events: any[];
  dispensaires: Dispensary[];
  route: { lat: number; lng: number }[];
  vehicle: { lat: number; lng: number; nearest: Dispensary | null } | null;
  smsLog: any[];
  modelInfo: ModelInfo | null;
  scenarios: Record<string, ScenarioInfo> | null;
  currentScenario: string;
  expeditions: Expedition[];
  wsError: string | null;
  gemmaLog: GemmaAnalysis[];
  gemmaInfo: any;
  gemmaAnalyzing: boolean;
}

export function useVaxGuardStream() {
  const [state, setState] = useState<VaxGuardState>(() => {
    if (STATIC_DEMO) {
      return {
        connected: false,
        reading: DEMO_READINGS[DEMO_READINGS.length - 1],
        history: DEMO_READINGS,
        prediction: DEMO_PREDICTION,
        predictionHistory: [DEMO_PREDICTION],
        session: DEMO_SESSION,
        events: [],
        dispensaires: DEMO_DISPENSAIRES,
        route: DEMO_ROUTE,
        vehicle: {
          lat: DEMO_READINGS[DEMO_READINGS.length - 1].vehicle_lat,
          lng: DEMO_READINGS[DEMO_READINGS.length - 1].vehicle_lng,
          nearest: DEMO_READINGS[DEMO_READINGS.length - 1].nearest_dispensaire,
        },
        smsLog: DEMO_SMS_LOG,
        modelInfo: DEMO_MODEL_INFO,
        scenarios: {
          normal: { label_fr: "Normal", label_en: "Normal", description: "Transport nominal" },
          solar_burst: { label_fr: "Soleil direct", label_en: "Direct sunlight", description: "Sun exposure" },
          lid_open: { label_fr: "Glacière ouverte", label_en: "Lid open", description: "Lid open" },
          ac_failure: { label_fr: "Panne clim.", label_en: "AC failure", description: "AC failure" },
          recovery: { label_fr: "Récupération", label_en: "Recovery", description: "Recovery" },
        },
        currentScenario: "solar_burst",
        expeditions: DEMO_EXPEDITIONS,
        wsError: null,
        gemmaLog: DEMO_GEMMA_LOG,
        gemmaInfo: DEMO_GEMMA_INFO,
        gemmaAnalyzing: false,
      };
    }
    return {
      connected: false,
      reading: null,
      history: [],
      prediction: null,
      predictionHistory: [],
      session: null,
      events: [],
      dispensaires: [],
      route: [],
      vehicle: null,
      smsLog: [],
      modelInfo: null,
      scenarios: null,
      currentScenario: "normal",
      expeditions: [],
      wsError: null,
      gemmaLog: [],
      gemmaInfo: null,
      gemmaAnalyzing: false,
    };
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number>(0);

  // Initial fetch of static info (model, scenarios, expeditions, gemma)
  useEffect(() => {
    if (STATIC_DEMO) return;
    (async () => {
      try {
        const [info, sc, ex, sms, gemmaInfo, gemmaLog] = await Promise.all([
          VaxGuardClient.info(),
          VaxGuardClient.scenarios(),
          VaxGuardClient.expeditions(),
          VaxGuardClient.smsLog(),
          VaxGuardClient.gemmaInfo(),
          VaxGuardClient.gemmaLog(),
        ]);
        setState((s) => ({
          ...s,
          modelInfo: info,
          scenarios: sc.scenarios,
          currentScenario: sc.current,
          expeditions: ex.expeditions,
          smsLog: sms.log,
          gemmaInfo: gemmaInfo,
          gemmaLog: gemmaLog.log ?? [],
        }));
      } catch (e: any) {
        setState((s) => ({ ...s, wsError: e?.message ?? "fetch failed" }));
      }
    })();
  }, []);

  // WebSocket connect (skip in static demo mode)
  useEffect(() => {
    if (STATIC_DEMO) return;
    const connect = () => {
      const url = buildWsUrl();
      if (!url) return;
      console.log("[vaxguard] connecting WS:", url);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectRef.current = 0;
        setState((s) => ({ ...s, connected: true, wsError: null }));
      };

      ws.onmessage = (ev) => {
        try {
          const msg: StreamMessage = JSON.parse(ev.data);
          if (msg.type === "snapshot") {
            setState((s) => ({
              ...s,
              history: msg.history ?? [],
              predictionHistory: msg.predictions ?? [],
              gemmaLog: msg.gemma_log ?? [],
              session: msg.session ?? null,
              dispensaires: msg.dispensaires ?? [],
              route: msg.route ?? [],
              vehicle: msg.vehicle ?? null,
              reading: msg.reading ?? s.reading,
            }));
          } else if (msg.type === "tick") {
            setState((s) => {
              const newHistory = msg.reading
                ? [...s.history.slice(-239), msg.reading]
                : s.history;
              const newPredHistory = msg.prediction?.ready
                ? [...s.predictionHistory.slice(-239), msg.prediction]
                : s.predictionHistory;
              const newSms = [...s.smsLog];
              if (msg.events && msg.events.length > 0) {
                for (const ev of msg.events) {
                  if (ev.type === "sms_dispatched" && ev.sms) {
                    newSms.push(ev.sms);
                  }
                }
              }
              const newGemmaLog = msg.gemma_log && msg.gemma_log.length > 0
                ? msg.gemma_log
                : s.gemmaLog;
              return {
                ...s,
                reading: msg.reading ?? s.reading,
                history: newHistory,
                prediction: msg.prediction ?? s.prediction,
                predictionHistory: newPredHistory,
                session: msg.session ?? s.session,
                events: msg.events ?? [],
                vehicle: msg.reading
                  ? {
                      lat: msg.reading.vehicle_lat,
                      lng: msg.reading.vehicle_lng,
                      nearest: msg.reading.nearest_dispensaire,
                    }
                  : s.vehicle,
                smsLog: newSms,
                gemmaLog: newGemmaLog,
              };
            });
          } else if (msg.type === "gemma_analysis") {
            setState((s) => ({
              ...s,
              gemmaAnalyzing: false,
              gemmaLog: msg.analysis
                ? [...s.gemmaLog.filter(a => (a as any).timestamp !== (msg.analysis as any).timestamp), msg.analysis as GemmaAnalysis].slice(-20)
                : s.gemmaLog,
            }));
          }
        } catch (e) {
          console.error("[vaxguard] WS parse error", e);
        }
      };

      ws.onerror = () => {
        setState((s) => ({ ...s, wsError: "WebSocket error" }));
      };

      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        reconnectRef.current += 1;
        const delay = Math.min(1000 * 2 ** reconnectRef.current, 15000);
        setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  // Actions
  const setScenario = useCallback(async (scenario: string, _reset: boolean) => {
    if (STATIC_DEMO) {
      setState((s) => ({ ...s, currentScenario: scenario }));
      return;
    }
    try {
      await VaxGuardClient.setScenario(scenario, _reset);
      setState((s) => ({ ...s, currentScenario: scenario }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const toggleRunning = useCallback(async () => {
    if (STATIC_DEMO) {
      setState((s) => ({ ...s, session: s.session ? { ...s.session, is_running: !s.session.is_running } : s.session }));
      return;
    }
    const next = !state.session?.is_running;
    try {
      await VaxGuardClient.control(next);
    } catch (e) {
      console.error(e);
    }
  }, [state.session?.is_running]);

  const dispatchSms = useCallback(async () => {
    if (STATIC_DEMO) {
      setState((s) => ({ ...s, smsLog: [...s.smsLog, {
        id: `sms_demo_${Date.now()}`,
        auto: false,
        phone: s.reading?.nearest_dispensaire?.phone ?? "+22966000000",
        recipient: s.reading?.nearest_dispensaire?.name ?? "Dispensaire",
        message: `VAXGUARD DEMO SMS | T=${s.reading?.t_internal ?? 0}°C | GPS=${s.reading?.vehicle_lat ?? 0},${s.reading?.vehicle_lng ?? 0}`,
        timestamp: new Date().toISOString(),
        lat: s.reading?.vehicle_lat ?? 0,
        lng: s.reading?.vehicle_lng ?? 0,
      }] }));
      return;
    }
    try {
      const r = await VaxGuardClient.smsDispatch(true);
      setState((s) => ({ ...s, smsLog: [...s.smsLog, r.sms] }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const configure = useCallback(async (cfg: { threshold_c?: number; sms_delay_s?: number; sensor_interval_s?: number }) => {
    if (STATIC_DEMO) {
      setState((s) => ({ ...s, session: s.session ? { ...s.session, ...cfg } : s.session }));
      return;
    }
    try {
      await VaxGuardClient.configure(cfg);
      setState((s) => ({ ...s, session: s.session ? { ...s.session, ...cfg } : s.session }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const triggerGemma = useCallback(async (_lang: string, _force: boolean = true) => {
    if (STATIC_DEMO) {
      // Simulate analysis delay then show cached
      setState((s) => ({ ...s, gemmaAnalyzing: true }));
      setTimeout(() => {
        setState((s) => ({ ...s, gemmaAnalyzing: false }));
      }, 3000);
      return DEMO_GEMMA_LOG[0];
    }
    setState((s) => ({ ...s, gemmaAnalyzing: true }));
    try {
      const r = await VaxGuardClient.gemmaAnalyze(_lang, _force);
      if (r.status === "cached" && r.analysis) {
        setState((s) => ({
          ...s,
          gemmaAnalyzing: false,
          gemmaLog: [r.analysis as GemmaAnalysis, ...s.gemmaLog.filter(a => (a as any).timestamp !== (r.analysis as any).timestamp)].slice(-20),
        }));
        return r.analysis;
      }
      return r.analysis;
    } catch (e) {
      setState((s) => ({ ...s, gemmaAnalyzing: false }));
      console.error(e);
      throw e;
    }
  }, []);

  return {
    state,
    setScenario,
    toggleRunning,
    dispatchSms,
    configure,
    triggerGemma,
    isStaticDemo: STATIC_DEMO,
  };
}
