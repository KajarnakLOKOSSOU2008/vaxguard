"use client";

import { useMemo } from "react";
import { Brain, AlertTriangle, ShieldCheck, AlertCircle, Clock, Gauge } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Area, ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { t, type Lang } from "@/lib/i18n";
import type { Reading, Prediction } from "@/lib/vaxguard-client";

interface Props {
  lang: Lang;
  prediction: Prediction | null;
  history: Reading[];
  thresholdC: number;
  windowSize: number;
}

/**
 * Visualize the AI prediction:
 * - Big MTT number (minutes to threshold)
 * - Risk class badge with confidence
 * - Reconstructed timeline showing historical T_internal + projected trajectory to 8°C
 */
export function AiPrediction({ lang, prediction, history, thresholdC, windowSize }: Props) {
  const ready = prediction?.ready === true;

  // Build projected trajectory: history (real) + projection (dashed) to threshold
  const timeline = useMemo(() => {
    if (!ready || !prediction?.minutes_to_threshold) return [];
    const mtt = prediction.minutes_to_threshold;
    const realHist = history.slice(-windowSize);
    const startT = realHist[realHist.length - 1]?.t_internal ?? 4.5;
    const nProj = Math.min(30, Math.max(5, Math.ceil(mtt)));
    const rows: any[] = [];

    // Real history rows
    realHist.forEach((r, i) => {
      rows.push({ idx: i, t_real: r.t_internal, t_proj: null });
    });
    // Bridge: at the boundary, the projected starts from the last real value
    rows[rows.length - 1].t_proj = startT;

    // Projected rows
    for (let i = 1; i <= nProj; i++) {
      const ratio = i / Math.max(1, mtt);
      const tProj = startT + (thresholdC - startT) * Math.min(1, ratio);
      rows.push({
        idx: realHist.length + i - 1,
        t_real: null,
        t_proj: tProj,
      });
    }
    return rows;
  }, [ready, prediction, history, thresholdC, windowSize]);

  if (!ready) {
    const have = prediction?.have ?? 0;
    const need = prediction?.need ?? windowSize;
    const pct = Math.min(100, (have / need) * 100);
    return (
      <Card className="border-teal-200/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-teal-800 flex items-center gap-2">
            <Brain className="h-4 w-4" />
            {t(lang, "predTitle")}
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">
            {t(lang, "predSubtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
            <AlertCircle className="h-6 w-6 text-slate-400 mx-auto" />
            <p className="text-sm text-slate-600 mt-2">{t(lang, "warmup")}</p>
            <p className="text-xs text-slate-400 mt-1">{have} / {need}</p>
            <Progress value={pct} className="mt-3 h-1.5" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const mtt = prediction.minutes_to_threshold ?? 0;
  const riskLabel = prediction.risk_label ?? "safe";
  const riskClass = prediction.risk_class ?? 0;
  const confidence = (prediction.confidence ?? 0) * 100;
  const probs = prediction.risk_probs ?? [0, 0, 0];

  const riskColor = riskLabel === "critical" ? "#dc2626" : riskLabel === "warning" ? "#f59e0b" : "#10b981";
  const riskBg = riskLabel === "critical" ? "bg-red-50 border-red-300" : riskLabel === "warning" ? "bg-amber-50 border-amber-300" : "bg-emerald-50 border-emerald-300";

  // 30-minute horizon bar (showing where MTT falls)
  const horizonPct = Math.min(100, (mtt / 30) * 100);

  return (
    <Card className={
      "border-2 shadow-sm transition " +
      (riskLabel === "critical" ? "border-red-300" : "border-teal-200/60")
    }>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base text-teal-800 flex items-center gap-2">
              <Brain className="h-4 w-4" />
              {t(lang, "predTitle")}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {t(lang, "predSubtitle")}
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono border-teal-200 bg-teal-50 text-teal-700">
            INT8
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Big MTT number + risk badge */}
        <div className="grid grid-cols-2 gap-3">
          <div className={"rounded-xl border p-4 " + riskBg}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              <Clock className="h-3 w-3" />
              {t(lang, "mtt")}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-3xl font-bold" style={{ color: riskColor }}>
                {mtt.toFixed(1)}
              </span>
              <span className="text-sm text-slate-500">min</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {lang === "fr" ? "avant franchissement 8°C" : "before crossing 8°C"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              <Gauge className="h-3 w-3" />
              {t(lang, "riskLabel")}
            </div>
            <div className="mt-1 flex items-center gap-2">
              {riskLabel === "critical" ? <AlertTriangle className="h-6 w-6 text-red-500" /> :
               riskLabel === "warning" ? <AlertCircle className="h-6 w-6 text-amber-500" /> :
               <ShieldCheck className="h-6 w-6 text-emerald-500" />}
              <span className="text-lg font-bold capitalize" style={{ color: riskColor }}>
                {riskLabel === "critical" ? t(lang, "riskCritical") :
                 riskLabel === "warning" ? t(lang, "riskWarning") :
                 t(lang, "riskSafe")}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              {t(lang, "confidence")}: {(confidence).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Probability distribution bar */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            {lang === "fr" ? "Distribution de probabilité" : "Probability distribution"}
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="bg-emerald-500" style={{ width: `${(probs[0] ?? 0) * 100}%` }} title="Safe" />
            <div className="bg-amber-500" style={{ width: `${(probs[1] ?? 0) * 100}%` }} title="Warning" />
            <div className="bg-red-500" style={{ width: `${(probs[2] ?? 0) * 100}%` }} title="Critical" />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-slate-500">
            <span><span className="text-emerald-600 font-semibold">{((probs[0] ?? 0) * 100).toFixed(0)}%</span> {t(lang, "riskSafe")}</span>
            <span><span className="text-amber-600 font-semibold">{((probs[1] ?? 0) * 100).toFixed(0)}%</span> {t(lang, "riskWarning")}</span>
            <span><span className="text-red-600 font-semibold">{((probs[2] ?? 0) * 100).toFixed(0)}%</span> {t(lang, "riskCritical")}</span>
          </div>
        </div>

        {/* 30-minute horizon bar */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            {t(lang, "horizonLabel")} — {t(lang, "nextSteps")}
          </div>
          <div className="relative h-6 w-full rounded bg-gradient-to-r from-red-500 via-amber-400 to-emerald-500 opacity-90">
            <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-800" style={{ left: `${horizonPct}%` }}>
              <div className="absolute -top-5 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {mtt.toFixed(0)} min
              </div>
            </div>
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-slate-500">
            <span>0 min</span>
            <span>15 min</span>
            <span>30 min+</span>
          </div>
        </div>

        {/* Timeline chart: history + projection */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            {lang === "fr" ? "Trajectoire thermique (réelle + projetée)" : "Thermal trajectory (real + projected)"}
          </div>
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeline} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="idx" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
                <YAxis domain={[-2, 12]} tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
                <Tooltip
                  contentStyle={{ fontSize: 10, borderRadius: 6 }}
                  labelFormatter={(v) => `Step ${v}`}
                />
                <ReferenceLine y={thresholdC} stroke="#dc2626" strokeDasharray="4 4" strokeWidth={2}
                  label={{ value: `${thresholdC}°C`, fill: "#dc2626", fontSize: 9, position: "right" }} />
                <Line type="monotone" dataKey="t_real" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="t_proj" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
