"use client";

import { useState } from "react";
import { Settings, Sliders, Clock, Thermometer, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { t, type Lang } from "@/lib/i18n";
import type { ScenarioInfo } from "@/lib/vaxguard-client";

interface Props {
  lang: Lang;
  thresholdC: number;
  smsDelayS: number;
  sensorIntervalS: number;
  currentScenario: string;
  scenarios: Record<string, ScenarioInfo> | null;
  onConfigure: (cfg: { threshold_c?: number; sms_delay_s?: number; sensor_interval_s?: number }) => Promise<void>;
  onSetScenario: (scenario: string, reset: boolean) => Promise<void>;
}

const SCENARIO_LIST = [
  { key: "normal", icon: "✓", color: "#10b981", desc_fr: "Transport nominal", desc_en: "Nominal transport" },
  { key: "solar_burst", icon: "☀", color: "#f59e0b", desc_fr: "Soleil direct 45 min", desc_en: "Direct sun 45 min" },
  { key: "lid_open", icon: "⚠", color: "#ef4444", desc_fr: "Glacière ouverte 8 min", desc_en: "Lid open 8 min" },
  { key: "ac_failure", icon: "❄", color: "#8b5cf6", desc_fr: "Panne clim. 8h", desc_en: "AC failure 8h" },
  { key: "recovery", icon: "↺", color: "#06b6d4", desc_fr: "Pic + re-glacement", desc_en: "Peak + ice refill" },
];

export function DeviceConfig({ lang, thresholdC, smsDelayS, sensorIntervalS, currentScenario, scenarios, onConfigure, onSetScenario }: Props) {
  const [localThreshold, setLocalThreshold] = useState(thresholdC);
  const [localSmsDelay, setLocalSmsDelay] = useState(smsDelayS);
  const [localInterval, setLocalInterval] = useState(sensorIntervalS);
  const [autoStart, setAutoStart] = useState(true);

  // Sync incoming props
  const lastSync = JSON.stringify({ thresholdC, smsDelayS, sensorIntervalS });
  const [syncedAt, setSyncedAt] = useState(lastSync);
  if (syncedAt !== lastSync) {
    setLocalThreshold(thresholdC);
    setLocalSmsDelay(smsDelayS);
    setLocalInterval(sensorIntervalS);
    setSyncedAt(lastSync);
  }

  const handleApply = async () => {
    await onConfigure({
      threshold_c: localThreshold,
      sms_delay_s: localSmsDelay,
      sensor_interval_s: localInterval,
    });
    toast.success(t(lang, "cfgApplied"));
  };

  return (
    <Card className="border-teal-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-teal-800 flex items-center gap-2">
          <Settings className="h-4 w-4" />
          {t(lang, "cfgTitle")}
        </CardTitle>
        <CardDescription className="text-xs mt-0.5">
          {t(lang, "cfgSubtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Scenario picker (visual) */}
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 block">
            <Activity className="h-3 w-3 inline mr-1" />
            {t(lang, "cfgScenario")}
          </Label>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {SCENARIO_LIST.map((s) => {
              const active = currentScenario === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => onSetScenario(s.key, false)}
                  className={
                    "flex flex-col items-center gap-1 rounded-lg border p-2.5 transition " +
                    (active
                      ? "border-teal-400 bg-teal-50 shadow-sm"
                      : "border-slate-200 bg-slate-50/50 hover:border-teal-200 hover:bg-teal-50/30")
                  }
                  style={active ? { borderColor: s.color } : undefined}
                >
                  <span className="text-lg" style={{ color: s.color }}>{s.icon}</span>
                  <span className="text-[10px] font-semibold" style={{ color: active ? s.color : "#475569" }}>
                    {lang === "fr" ? scenarios?.[s.key]?.label_fr ?? s.key : scenarios?.[s.key]?.label_en ?? s.key}
                  </span>
                  <span className="text-[9px] text-slate-500 text-center leading-tight">
                    {lang === "fr" ? s.desc_fr : s.desc_en}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Threshold slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Thermometer className="h-3 w-3 text-red-500" />
              {t(lang, "cfgThreshold")}
            </Label>
            <span className="text-sm font-bold text-red-600">{localThreshold.toFixed(1)} °C</span>
          </div>
          <Slider
            value={[localThreshold]}
            min={4}
            max={15}
            step={0.5}
            onValueChange={(v) => setLocalThreshold(v[0])}
            className="[&>span:first-child]:h-2 [&>span:first-child]:bg-red-200 [&_[data-orientation=horizontal]]:bg-red-500"
          />
          <div className="flex justify-between mt-1 text-[9px] text-slate-400">
            <span>4°C</span>
            <span>8°C ({lang === "fr" ? "WHO" : "WHO"})</span>
            <span>15°C</span>
          </div>
        </div>

        {/* SMS delay */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-amber-500" />
              {t(lang, "cfgSmsDelay")}
            </Label>
            <span className="text-sm font-bold text-amber-600">{localSmsDelay}s ({Math.floor(localSmsDelay / 60)}min)</span>
          </div>
          <Slider
            value={[localSmsDelay]}
            min={60}
            max={900}
            step={60}
            onValueChange={(v) => setLocalSmsDelay(v[0])}
            className="[&>span:first-child]:h-2 [&>span:first-child]:bg-amber-200 [&_[data-orientation=horizontal]]:bg-amber-500"
          />
          <div className="flex justify-between mt-1 text-[9px] text-slate-400">
            <span>1 min</span>
            <span>5 min ({lang === "fr" ? "défaut" : "default"})</span>
            <span>15 min</span>
          </div>
        </div>

        {/* Sensor interval */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Sliders className="h-3 w-3 text-teal-500" />
              {t(lang, "cfgInterval")}
            </Label>
            <span className="text-sm font-bold text-teal-600">{localInterval}s</span>
          </div>
          <Slider
            value={[localInterval]}
            min={5}
            max={120}
            step={5}
            onValueChange={(v) => setLocalInterval(v[0])}
            className="[&>span:first-child]:h-2 [&>span:first-child]:bg-teal-200 [&_[data-orientation=horizontal]]:bg-teal-500"
          />
          <div className="flex justify-between mt-1 text-[9px] text-slate-400">
            <span>5s</span>
            <span>30s ({lang === "fr" ? "SHT31" : "SHT31"})</span>
            <span>120s</span>
          </div>
        </div>

        {/* Auto-start toggle */}
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-3">
          <div>
            <Label className="text-xs font-semibold text-slate-700">
              {lang === "fr" ? "Simulation auto au démarrage" : "Auto-start simulation"}
            </Label>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {lang === "fr"
                ? "Démarre la simulation dès le chargement"
                : "Start simulation on load"}
            </p>
          </div>
          <Switch checked={autoStart} onCheckedChange={setAutoStart} />
        </div>

        {/* Apply button */}
        <div className="flex items-center justify-between pt-2">
          <Badge variant="outline" className="text-[10px] border-slate-200 bg-slate-50 text-slate-600">
            {lang === "fr" ? "Changements locaux" : "Local changes"}:
            {(localThreshold !== thresholdC || localSmsDelay !== smsDelayS || localInterval !== sensorIntervalS) ? " ●" : " ✓"}
          </Badge>
          <Button onClick={handleApply} size="sm" className="bg-teal-600 hover:bg-teal-700 text-white">
            {t(lang, "cfgApply")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
