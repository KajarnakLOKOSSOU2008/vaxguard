"use client";

import { useState, useEffect } from "react";
import {
  Activity, Brain, MapPin, MessageSquare, History as HistoryIcon,
  Settings, Cpu,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/vaxguard/header";
import { LiveMonitoring } from "@/components/vaxguard/live-monitoring";
import { AiPrediction } from "@/components/vaxguard/ai-prediction";
import { GpsMap } from "@/components/vaxguard/gps-map";
import { SmsAlerts } from "@/components/vaxguard/sms-alerts";
import { HistoryPanel } from "@/components/vaxguard/history";
import { DeviceConfig } from "@/components/vaxguard/device-config";
import { AiInfo } from "@/components/vaxguard/ai-info";
import { useVaxGuardStream } from "@/hooks/use-vaxguard-stream";
import { type Lang } from "@/lib/i18n";

export default function Home() {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === "undefined") return "fr";
    const saved = localStorage.getItem("vaxguard-lang");
    return saved === "fr" || saved === "en" ? saved : "fr";
  });
  const { state, setScenario, toggleRunning, dispatchSms, configure } = useVaxGuardStream();

  useEffect(() => {
    localStorage.setItem("vaxguard-lang", lang);
  }, [lang]);

  const threshold = state.session?.threshold_c ?? 8.0;
  const smsDelay = state.session?.sms_delay_s ?? 300;
  const sensorInterval = state.session?.sensor_interval_s ?? 30;
  const vehicle = state.vehicle ?? { lat: 7.1886, lng: 2.0419, nearest: null };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/20 to-cyan-50/30">
      <Header
        lang={lang}
        setLang={setLang}
        session={state.session}
        prediction={state.prediction}
        connected={state.connected}
        scenarios={state.scenarios}
        currentScenario={state.currentScenario}
        onSetScenario={setScenario}
        onToggleRun={toggleRunning}
      />

      <main className="mx-auto max-w-[1600px] px-4 py-5">
        {state.wsError && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            ⚠ {state.wsError} — {lang === "fr" ? "le service IA tourne sur le port 8001" : "AI service runs on port 8001"}
          </div>
        )}

        <Tabs defaultValue="live" className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-2 md:grid-cols-4 lg:grid-cols-6 h-auto">
            <TabsTrigger value="live" className="flex items-center gap-1.5 py-2">
              <Activity className="h-3.5 w-3.5" />
              {lang === "fr" ? "Monitoring live" : "Live"}
            </TabsTrigger>
            <TabsTrigger value="prediction" className="flex items-center gap-1.5 py-2">
              <Brain className="h-3.5 w-3.5" />
              {lang === "fr" ? "Prédiction IA" : "Prediction"}
            </TabsTrigger>
            <TabsTrigger value="map" className="flex items-center gap-1.5 py-2">
              <MapPin className="h-3.5 w-3.5" />
              {lang === "fr" ? "Carte GPS" : "GPS map"}
            </TabsTrigger>
            <TabsTrigger value="sms" className="flex items-center gap-1.5 py-2">
              <MessageSquare className="h-3.5 w-3.5" />
              {lang === "fr" ? "Alertes SMS" : "SMS alerts"}
            </TabsTrigger>
            <TabsTrigger value="config" className="flex items-center gap-1.5 py-2">
              <Settings className="h-3.5 w-3.5" />
              {lang === "fr" ? "Configuration" : "Config"}
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-1.5 py-2">
              <Cpu className="h-3.5 w-3.5" />
              {lang === "fr" ? "Modèle & ESP32" : "Model & ESP32"}
            </TabsTrigger>
          </TabsList>

          {/* LIVE TAB */}
          <TabsContent value="live" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <LiveMonitoring
                  lang={lang}
                  history={state.history}
                  prediction={state.prediction}
                  thresholdC={threshold}
                />
              </div>
              <div className="lg:col-span-1">
                <AiPrediction
                  lang={lang}
                  prediction={state.prediction}
                  history={state.history}
                  thresholdC={threshold}
                  windowSize={state.modelInfo?.window_size ?? 30}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <GpsMap
                  lang={lang}
                  vehicleLat={vehicle.lat}
                  vehicleLng={vehicle.lng}
                  nearest={vehicle.nearest}
                  dispensaries={state.dispensaires}
                  route={state.route}
                  alertState={state.session?.alert_state ?? "normal"}
                />
              </div>
              <div className="lg:col-span-1">
                <SmsAlerts
                  lang={lang}
                  smsLog={state.smsLog}
                  smsCount={state.session?.sms_count ?? 0}
                  onDispatch={dispatchSms}
                />
              </div>
            </div>

            <HistoryPanel lang={lang} expeditions={state.expeditions} />
          </TabsContent>

          {/* PREDICTION TAB */}
          <TabsContent value="prediction" className="space-y-4">
            <AiPrediction
              lang={lang}
              prediction={state.prediction}
              history={state.history}
              thresholdC={threshold}
              windowSize={state.modelInfo?.window_size ?? 30}
            />
            <LiveMonitoring
              lang={lang}
              history={state.history}
              prediction={state.prediction}
              thresholdC={threshold}
            />
          </TabsContent>

          {/* MAP TAB */}
          <TabsContent value="map" className="space-y-4">
            <GpsMap
              lang={lang}
              vehicleLat={vehicle.lat}
              vehicleLng={vehicle.lng}
              nearest={vehicle.nearest}
              dispensaries={state.dispensaires}
              route={state.route}
              alertState={state.session?.alert_state ?? "normal"}
            />
          </TabsContent>

          {/* SMS TAB */}
          <TabsContent value="sms" className="space-y-4">
            <SmsAlerts
              lang={lang}
              smsLog={state.smsLog}
              smsCount={state.session?.sms_count ?? 0}
              onDispatch={dispatchSms}
            />
          </TabsContent>

          {/* CONFIG TAB */}
          <TabsContent value="config" className="space-y-4">
            <DeviceConfig
              lang={lang}
              thresholdC={threshold}
              smsDelayS={smsDelay}
              sensorIntervalS={sensorInterval}
              currentScenario={state.currentScenario}
              scenarios={state.scenarios}
              onConfigure={configure}
              onSetScenario={setScenario}
            />
          </TabsContent>

          {/* AI INFO TAB */}
          <TabsContent value="ai" className="space-y-4">
            <AiInfo lang={lang} info={state.modelInfo} />
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <footer className="mt-8 pt-6 border-t border-teal-200/30 text-center text-xs text-slate-500">
          <div className="flex flex-col md:flex-row items-center justify-center gap-2">
            <span className="font-semibold text-teal-700">VaxGuard</span>
            <span className="text-slate-400">·</span>
            <span>{lang === "fr" ? "Cold-chain prédictive Edge-AI" : "Predictive Edge-AI cold-chain"}</span>
            <span className="text-slate-400">·</span>
            <span>CNN-GRU PyTorch · INT8 16.9 KB · ESP32-S3 ready</span>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            {lang === "fr"
              ? "Données synthétiques basées sur physique thermodynamique de glacière passive · capteurs SHT31 simulés"
              : "Synthetic data based on passive cooler thermodynamics · simulated SHT31 sensors"}
          </div>
        </footer>
      </main>
    </div>
  );
}
