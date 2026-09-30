/**
 * VaxGuard AI service client - wraps REST calls with the XTransformPort gateway
 */

const AI_PORT = 8001;

function withPort(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}XTransformPort=${AI_PORT}`;
}

export interface Reading {
  step: number;
  t_seconds: number;
  t_minutes: number;
  t_internal: number;
  t_ambient: number;
  humidity: number;
  extra_flux_w: number;
  scenario: string;
  vehicle_lat: number;
  vehicle_lng: number;
  nearest_dispensaire: Dispensary | null;
  timestamp: string;
}

export interface Dispensary {
  id: string;
  name: string;
  lat: number;
  lng: number;
  phone: string;
  distance_km?: number;
}

export interface Prediction {
  ready: boolean;
  reason?: string;
  have?: number;
  need?: number;
  minutes_to_threshold?: number;
  risk_class?: number;
  risk_label?: "safe" | "warning" | "critical";
  risk_probs?: number[];
  confidence?: number;
  threshold_c?: number;
  step?: number;
  t_internal_current?: number;
  timestamp?: string;
}

export interface SessionState {
  scenario: string;
  step: number;
  is_running: boolean;
  threshold_c: number;
  sms_delay_s: number;
  sensor_interval_s: number;
  history_buffer_size: number;
  sms_count: number;
  alert_state?: string;
  t_seconds?: number;
}

export interface StreamMessage {
  type: "tick" | "snapshot" | "gemma_analysis";
  reading?: Reading;
  prediction?: Prediction;
  alert_state?: string;
  events?: any[];
  session?: SessionState;
  history?: Reading[];
  predictions?: any[];
  gemma_log?: GemmaAnalysis[];
  dispensaires?: Dispensary[];
  route?: { lat: number; lng: number }[];
  vehicle?: { lat: number; lng: number; nearest: Dispensary | null };
  analysis?: GemmaAnalysis;
}

export interface GemmaAnalysis {
  ready?: boolean;
  analysis?: string;
  inference_time_s?: number;
  tokens_prompt?: number;
  tokens_completion?: number;
  model?: string;
  lang?: string;
  timestamp?: number;
  scenario?: string;
  step?: number;
  auto?: boolean;
  error?: string;
}

export interface ModelInfo {
  model_name: string;
  model_kind: string;
  n_params: number;
  input_shape: number[];
  input_features: string[];
  prediction_horizon_label: string;
  outputs: { mtt: string; risk: string };
  test_metrics: {
    mtt_mae: number;
    mtt_mae_near: number;
    risk_f1_macro: number;
    risk_f1_critical: number;
    confusion_matrix: number[][];
  };
  int8_metrics: {
    mtt_mae: number;
    risk_f1_macro: number;
  };
  sizes_kb: {
    fp32_pt: number;
    torchscript: number;
    int8_dynamic: number;
    onnx?: number;
  };
  esp32_feasibility: {
    fits_int8: boolean;
    esp32_s3_sram_kb: number;
    recommended_runtime: string;
    notes: string;
  };
  threshold_c: number;
  window_size: number;
}

export interface ScenarioInfo {
  label_fr: string;
  label_en: string;
  description: string;
}

export interface ExpeditionsResponse {
  expeditions: Expedition[];
}

export interface Expedition {
  id: string;
  vehicle: string;
  route: string;
  scenario: string;
  duration_min: number;
  alert_count: number;
  sms_count: number;
  min_mtt: number;
  ended_at: string;
}

/** Build the WebSocket URL respecting the XTransformPort gateway rule. */
export function buildWsUrl(): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/stream?XTransformPort=${AI_PORT}`;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(withPort(path), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return r.json() as Promise<T>;
}

async function postJson<T>(path: string, body: any): Promise<T> {
  const r = await fetch(withPort(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return r.json() as Promise<T>;
}

export const VaxGuardClient = {
  health: () => getJson<{ status: string; model_kind: string }>(`/health`),
  info:   () => getJson<ModelInfo>(`/api/info`),
  scenarios: () => getJson<{ scenarios: Record<string, ScenarioInfo>; current: string }>(`/api/scenarios`),
  setScenario: (scenario: string, reset: boolean = false) =>
    postJson<{ status: string; scenario: string; reset: boolean }>(`/api/scenario/set`, { scenario, reset }),
  control: (running: boolean) =>
    postJson<{ is_running: boolean }>(`/api/control`, { running }),
  configure: (cfg: { threshold_c?: number; sms_delay_s?: number; sensor_interval_s?: number }) =>
    postJson<{ threshold_c: number; sms_delay_s: number; sensor_interval_s: number }>(`/api/config`, cfg),
  dispensaires: () => getJson<{ dispensaires: Dispensary[]; route: { lat: number; lng: number }[] }>(`/api/dispensaires`),
  smsDispatch: (manual: boolean = true) =>
    postJson<{ status: string; sms: any; total_dispatched: number }>(`/api/sms/dispatch`, { manual }),
  smsLog: () => getJson<{ log: any[]; total: number }>(`/api/sms/log`),
  history: () => getJson<{ readings: Reading[]; predictions: any[]; session: any }>(`/api/history`),
  expeditions: () => getJson<ExpeditionsResponse>(`/api/expeditions`),
  // Gemma 2B
  gemmaInfo: () => getJson<{ available: boolean; model_name: string; quantization?: string; size_mb?: number; loaded?: boolean }>(`/api/gemma/info`),
  gemmaLog: () => getJson<{ log: any[]; total: number }>(`/api/gemma/log`),
  gemmaAnalyze: (lang: string, force: boolean = false) =>
    postJson<{ status: string; analysis: any }>(`/api/gemma/analyze`, { lang, force }),
  gemmaSetLang: (lang: string) =>
    postJson<{ gemma_lang: string }>(`/api/gemma/lang`, { lang }),
};
