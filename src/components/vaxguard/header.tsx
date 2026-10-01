"use client";

import { useState, useEffect, type ReactNode } from "react";
import { Activity, Globe, Play, Pause, RotateCcw, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t, type Lang } from "@/lib/i18n";
import type { SessionState, ScenarioInfo, Prediction } from "@/lib/vaxguard-client";

interface HeaderProps {
  lang: Lang;
  setLang: (l: Lang) => void;
  session: SessionState | null;
  prediction: Prediction | null;
  connected: boolean;
  scenarios: Record<string, ScenarioInfo> | null;
  currentScenario: string;
  onSetScenario: (s: string, reset: boolean) => void;
  onToggleRun: () => void;
}

const SCENARIO_KEYS = ["normal", "solar_burst", "lid_open", "ac_failure", "recovery"] as const;

export function Header({
  lang, setLang, session, prediction, connected,
  scenarios, currentScenario, onSetScenario, onToggleRun,
}: HeaderProps) {
  const running = session?.is_running ?? true;
  const alertState = session?.alert_state ?? "normal";
  const riskLabel = prediction?.risk_label ?? "safe";
  const step = session?.step ?? 0;

  // Pulse animation for critical alerts
  const isCritical = alertState === "critical" || riskLabel === "critical";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-teal-200/40 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
        {/* Logo + name */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-md">
            <Activity className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tracking-tight text-teal-800">VaxGuard</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-teal-600/70">
                Edge-AI
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              {t(lang, "tagline")}
            </span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Status badges */}
        <div className="flex items-center gap-2">
          {/* Connection */}
          {connected ? (
            <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700 gap-1.5">
              <Wifi className="h-3 w-3" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                {t(lang, "live")}
              </span>
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 gap-1.5">
              <WifiOff className="h-3 w-3" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                {t(lang, "paused")}
              </span>
            </Badge>
          )}

          {/* AI status */}
          {prediction?.ready ? (
            <Badge
              variant="outline"
              className={
                "gap-1.5 " +
                (riskLabel === "critical"
                  ? "border-red-300 bg-red-50 text-red-700"
                  : riskLabel === "warning"
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-emerald-300 bg-emerald-50 text-emerald-700")
                + (isCritical ? " animate-pulse" : "")
              }
            >
              <span className={
                "h-2 w-2 rounded-full " +
                (riskLabel === "critical" ? "bg-red-500" : riskLabel === "warning" ? "bg-amber-500" : "bg-emerald-500")
              } />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                {riskLabel === "critical" ? t(lang, "statusCritical") :
                 riskLabel === "warning" ? t(lang, "statusWarning") :
                 t(lang, "statusNormal")}
              </span>
            </Badge>
          ) : (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500 gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                {t(lang, "statusWarmup")}
              </span>
            </Badge>
          )}

          {/* Step */}
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600 gap-1.5">
            <span className="text-[10px] font-medium">
              {t(lang, "stepN")} {step}
            </span>
          </Badge>
        </div>

        {/* Scenario picker */}
        {scenarios && (
          <Select
            value={currentScenario}
            onValueChange={(v) => onSetScenario(v, false)}
          >
            <SelectTrigger className="h-9 w-[180px] border-teal-200 bg-white text-sm">
              <SelectValue placeholder={t(lang, "scenario")} />
            </SelectTrigger>
            <SelectContent>
              {SCENARIO_KEYS.map((k) => (
                <SelectItem key={k} value={k} className="text-sm">
                  {lang === "fr"
                    ? scenarios[k]?.label_fr ?? k
                    : scenarios[k]?.label_en ?? k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Play / Pause / Reset */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="border-teal-200 hover:bg-teal-50"
            onClick={onToggleRun}
          >
            {running
              ? <><Pause className="h-3.5 w-3.5" /> {t(lang, "pause")}</>
              : <><Play className="h-3.5 w-3.5" /> {t(lang, "play")}</>
            }
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-slate-500 hover:bg-slate-100"
            onClick={() => onSetScenario(currentScenario, true)}
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t(lang, "reset")}
          </Button>
        </div>

        {/* Language toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <button
            className={"rounded-md px-2.5 py-1 text-xs font-semibold transition " +
              (lang === "fr" ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}
            onClick={() => setLang("fr")}
          >
            FR
          </button>
          <button
            className={"rounded-md px-2.5 py-1 text-xs font-semibold transition " +
              (lang === "en" ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}
            onClick={() => setLang("en")}
          >
            EN
          </button>
          <Globe className="h-3 w-3 text-slate-400 mr-1.5" />
        </div>
      </div>
    </header>
  );
}
