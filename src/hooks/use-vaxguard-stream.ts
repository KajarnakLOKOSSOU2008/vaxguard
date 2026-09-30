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
} from "@/lib/vaxguard-client";

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
}

export function useVaxGuardStream() {
  const [state, setState] = useState<VaxGuardState>({
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
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number>(0);

  // Initial fetch of static info (model, scenarios, expeditions)
  useEffect(() => {
    (async () => {
      try {
        const [info, sc, ex, sms] = await Promise.all([
          VaxGuardClient.info(),
          VaxGuardClient.scenarios(),
          VaxGuardClient.expeditions(),
          VaxGuardClient.smsLog(),
        ]);
        setState((s) => ({
          ...s,
          modelInfo: info,
          scenarios: sc.scenarios,
          currentScenario: sc.current,
          expeditions: info ? s.expeditions : ex.expeditions,
          expeditions: ex.expeditions,
          smsLog: sms.log,
        }));
      } catch (e: any) {
        setState((s) => ({ ...s, wsError: e?.message ?? "fetch failed" }));
      }
    })();
  }, []);

  // WebSocket connect
  useEffect(() => {
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
              };
            });
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
        // Auto-reconnect with backoff
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
  const setScenario = useCallback(async (scenario: string, reset: boolean) => {
    try {
      await VaxGuardClient.setScenario(scenario, reset);
      setState((s) => ({ ...s, currentScenario: scenario }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const toggleRunning = useCallback(async () => {
    const next = !state.session?.is_running;
    try {
      await VaxGuardClient.control(next);
    } catch (e) {
      console.error(e);
    }
  }, [state.session?.is_running]);

  const dispatchSms = useCallback(async () => {
    try {
      const r = await VaxGuardClient.smsDispatch(true);
      setState((s) => ({ ...s, smsLog: [...s.smsLog, r.sms] }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const configure = useCallback(async (cfg: { threshold_c?: number; sms_delay_s?: number; sensor_interval_s?: number }) => {
    try {
      await VaxGuardClient.configure(cfg);
      setState((s) => ({ ...s, session: s.session ? { ...s.session, ...cfg } : s.session }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  return {
    state,
    setScenario,
    toggleRunning,
    dispatchSms,
    configure,
  };
}
