"use client";

import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Area, ComposedChart, AreaChart, Bar,
} from "recharts";
import { Thermometer, Droplets, Sun, Clock, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { t, type Lang } from "@/lib/i18n";
import type { Reading, Prediction } from "@/lib/vaxguard-client";

interface Props {
  lang: Lang;
  history: Reading[];
  prediction: Prediction | null;
  thresholdC: number;
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}`;
  return `${m}min`;
}

export function LiveMonitoring({ lang, history, prediction, thresholdC }: Props) {
  const last = history[history.length - 1];
  const chartData = useMemo(() => history.map((r) => ({
    step: r.step,
    tInternal: r.t_internal,
    tAmbient: r.t_ambient,
    humidity: r.humidity,
    flux: r.extra_flux_w,
  })), [history]);

  const tIntColor = "#0ea5e9";    // teal-500
  const tAmbColor = "#f97316";    // orange-500
  const humColor = "#22c55e";    // green-500

  return (
    <Card className="border-teal-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base text-teal-800 flex items-center gap-2">
              <Thermometer className="h-4 w-4" />
              {t(lang, "liveTitle")}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {t(lang, "liveSubtitle")}
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono border-teal-200 bg-teal-50 text-teal-700">
            {t(lang, "simSpeed")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Big metric tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTile
            label={t(lang, "tInternal")}
            value={last ? `${last.t_internal.toFixed(2)} °C` : "--"}
            sub={last && last.t_internal >= thresholdC
              ? `⚠ ${lang === "fr" ? "Seuil dépassé" : "Threshold exceeded"}`
              : `${(thresholdC - (last?.t_internal ?? 0)).toFixed(1)} °C ${lang === "fr" ? "sous seuil" : "below threshold"}`}
            color="#0ea5e9"
            icon={<Thermometer className="h-3.5 w-3.5" />}
            alert={last ? last.t_internal >= thresholdC : false}
          />
          <MetricTile
            label={t(lang, "tAmbient")}
            value={last ? `${last.t_ambient.toFixed(1)} °C` : "--"}
            sub={lang === "fr" ? "Climat tropical" : "Tropical climate"}
            color="#f97316"
            icon={<Sun className="h-3.5 w-3.5" />}
          />
          <MetricTile
            label={t(lang, "humidity")}
            value={last ? `${last.humidity.toFixed(1)} %` : "--"}
            sub="SHT31"
            color="#22c55e"
            icon={<Droplets className="h-3.5 w-3.5" />}
          />
          <MetricTile
            label={t(lang, "missionTime")}
            value={last ? fmtTime(last.t_minutes) : "--"}
            sub={lang === "fr" ? `Step ${last?.step ?? 0}` : `Step ${last?.step ?? 0}`}
            color="#6366f1"
            icon={<Clock className="h-3.5 w-3.5" />}
          />
        </div>

        {/* Temperature chart with 8°C threshold */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {lang === "fr" ? "Température (°C) vs seuil destruction" : "Temperature (°C) vs destruction threshold"}
            </h4>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: tIntColor }} />
                <span className="text-slate-600">{t(lang, "tInternal")}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: tAmbColor }} />
                <span className="text-slate-600">{t(lang, "tAmbient")}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-0.5" style={{ background: "#dc2626" }} />
                <span className="text-slate-600">8°C</span>
              </span>
            </div>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="step" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
                <YAxis domain={[-5, 40]} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  labelStyle={{ color: "#475569" }}
                />
                <ReferenceLine y={thresholdC} stroke="#dc2626" strokeDasharray="4 4" strokeWidth={2}
                  label={{ value: `${t(lang, "thresholdC")} ${thresholdC}°C`, fill: "#dc2626", fontSize: 10, position: "right" }}
                />
                <Line type="monotone" dataKey="tAmbient" stroke={tAmbColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="tInternal" stroke={tIntColor} strokeWidth={2} dot={false} isAnimationActive={false} />
                {prediction?.ready && (
                  <ReferenceLine x={last?.step} stroke="#0f766e" strokeDasharray="2 2" strokeWidth={1.5}
                    label={{ value: lang === "fr" ? "Maintenant" : "Now", fill: "#0f766e", fontSize: 9, position: "top" }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Humidity + Extra flux combined */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                {t(lang, "humidity")}
              </h4>
            </div>
            <div className="h-[120px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="humGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={humColor} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={humColor} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="step" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <YAxis domain={[40, 90]} tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 10, borderRadius: 6 }} />
                  <Area type="monotone" dataKey="humidity" stroke={humColor} strokeWidth={1.5} fill="url(#humGrad)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                <Zap className="h-3 w-3 text-amber-500" />
                {lang === "fr" ? "Flux événement (W)" : "Event flux (W)"}
              </h4>
            </div>
            <div className="h-[120px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="step" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 10, borderRadius: 6 }} />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
                  <Bar dataKey="flux" fill="#f59e0b" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricTile({
  label, value, sub, color, icon, alert = false,
}: {
  label: string; value: string; sub: string;
  color: string; icon: React.ReactNode; alert?: boolean;
}) {
  return (
    <div className={
      "rounded-xl border p-3 transition " +
      (alert
        ? "border-red-300 bg-red-50 animate-pulse"
        : "border-slate-200 bg-slate-50/50")
    }>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xl font-bold" style={{ color: alert ? "#dc2626" : "#0f172a" }}>
        {value}
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}
