"use client";

import { Cpu, Layers, HardDrive, CheckCircle2, AlertCircle, Download, Zap, Code2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { t, type Lang } from "@/lib/i18n";
import type { ModelInfo } from "@/lib/vaxguard-client";

interface Props {
  lang: Lang;
  info: ModelInfo | null;
}

export function AiInfo({ lang, info }: Props) {
  if (!info) {
    return (
      <Card className="border-teal-200/60 shadow-sm">
        <CardContent className="p-6 text-center text-slate-500 text-sm">
          {t(lang, "loading")}
        </CardContent>
      </Card>
    );
  }

  const fits = info.esp32_feasibility.fits_int8;
  const int8Size = info.sizes_kb.int8_dynamic;
  const sram = info.esp32_feasibility.esp32_s3_sram_kb;
  const usagePct = (int8Size / sram) * 100;

  return (
    <Card className="border-teal-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-teal-800 flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          {t(lang, "aiTitle")}
        </CardTitle>
        <CardDescription className="text-xs mt-0.5">
          {t(lang, "aiSubtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Architecture block */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            <Layers className="h-3 w-3" />
            {t(lang, "aiArchitecture")}
          </div>
          <div className="font-mono text-[11px] leading-relaxed text-slate-700">
            <div><span className="text-teal-700 font-bold">Input</span>: (batch, {info.input_shape[0]}, {info.input_shape[1]})  <span className="text-slate-400">[{info.input_features.join(", ")}]</span></div>
            <div><span className="text-teal-700 font-bold">Conv1d</span>: {info.input_shape[1]}→16, k=3, pad=1, ReLU</div>
            <div><span className="text-teal-700 font-bold">MaxPool1d</span>: k=2</div>
            <div><span className="text-teal-700 font-bold">Conv1d</span>: 16→8, k=3, pad=1, ReLU</div>
            <div><span className="text-teal-700 font-bold">GRU</span>: input 8, hidden 32, 1 layer</div>
            <div><span className="text-teal-700 font-bold">Head mtt</span>: Linear(32→16→1)  <span className="text-slate-400">→ minutes_to_threshold</span></div>
            <div><span className="text-teal-700 font-bold">Head risk</span>: Linear(32→16→3)  <span className="text-slate-400">→ [safe, warning, critical]</span></div>
          </div>
        </div>

        {/* Big metric tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label={t(lang, "aiParams")} value={info.n_params.toLocaleString()} icon={<Layers className="h-3.5 w-3.5" />} color="#0ea5e9" />
          <Metric label="FP32" value={`${info.sizes_kb.fp32_pt} KB`} icon={<HardDrive className="h-3.5 w-3.5" />} color="#6366f1" />
          <Metric label="TorchScript" value={`${info.sizes_kb.torchscript} KB`} icon={<Code2 className="h-3.5 w-3.5" />} color="#06b6d4" />
          <Metric label="INT8" value={`${info.sizes_kb.int8_dynamic} KB`} icon={<Zap className="h-3.5 w-3.5" />} color="#10b981" highlight />
        </div>

        {/* Test metrics */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t(lang, "aiTestMetrics")}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetricRow label={t(lang, "aiMttMae")} value={`${info.test_metrics.mtt_mae.toFixed(2)} min`} color="#0ea5e9" />
            <MetricRow label={t(lang, "aiRiskF1")} value={info.test_metrics.risk_f1_macro.toFixed(3)} color="#10b981" />
            <MetricRow label={t(lang, "aiCriticalF1")} value={info.test_metrics.risk_f1_critical.toFixed(3)} color="#dc2626" highlight={info.test_metrics.risk_f1_critical > 0.9} />
          </div>
          {info.int8_metrics && (
            <div className="mt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                {t(lang, "aiInt8Metrics")}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MetricRow label={t(lang, "aiMttMae")} value={`${info.int8_metrics.mtt_mae.toFixed(2)} min`} color="#0ea5e9" sub="INT8" />
                <MetricRow label={t(lang, "aiRiskF1")} value={info.int8_metrics.risk_f1_macro.toFixed(3)} color="#10b981" sub="INT8" />
                <MetricRow label={lang === "fr" ? "Perte vs FP32" : "Loss vs FP32"} value={`+${Math.abs(info.int8_metrics.mtt_mae - info.test_metrics.mtt_mae).toFixed(3)} min`} color="#f59e0b" sub="INT8" />
              </div>
            </div>
          )}
        </div>

        {/* ESP32 feasibility */}
        <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              <Cpu className="h-3 w-3" />
              {t(lang, "aiEsp32")}
            </div>
            {fits ? (
              <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-3 w-3 mr-1" /> {t(lang, "aiYes")}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-red-300 bg-red-100 text-red-700">
                <AlertCircle className="h-3 w-3 mr-1" /> {t(lang, "aiNo")}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{t(lang, "aiSize")} (INT8)</div>
              <div className="font-bold text-emerald-700">{int8Size?.toFixed(1)} KB</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{t(lang, "aiSram")}</div>
              <div className="font-bold text-slate-700">{sram} KB</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Utilisation" : "Usage"}</div>
              <div className="font-bold text-emerald-700">{usagePct.toFixed(1)}%</div>
            </div>
          </div>
          <Progress value={usagePct} className="mt-2 h-2" />
          <div className="mt-1 text-[10px] text-slate-500">
            {lang === "fr"
              ? `L'empreinte INT8 représente ${usagePct.toFixed(1)}% de la SRAM de l'ESP32-S3 (512 KB).`
              : `INT8 footprint uses ${usagePct.toFixed(1)}% of ESP32-S3 SRAM (512 KB).`}
          </div>
        </div>

        {/* Deployment pipeline */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t(lang, "aiDeployment")}
          </div>
          <div className="space-y-2 font-mono text-[11px]">
            <PipelineStep n={1} text="PyTorch (FP32)" sub={`${info.sizes_kb.fp32_pt} KB · entraînement`} active />
            <PipelineStep n={2} text="Dynamic INT8 quantization" sub={`${info.sizes_kb.int8_dynamic} KB · ${info.model_kind}`} active />
            <PipelineStep n={3} text="Export ONNX" sub={`${info.sizes_kb.onnx ?? "—"} KB · opset 13`} active={!!info.sizes_kb.onnx} />
            <PipelineStep n={4} text="onnx2tf → TFLite" sub={lang === "fr" ? "Conversion format TFLite Micro" : "TFLite Micro format conversion"} />
            <PipelineStep n={5} text="QAT (re-quantization)" sub={lang === "fr" ? "Quantization-aware training fine-tuning" : "Quantization-aware fine-tuning"} />
            <PipelineStep n={6} text="ESP32-S3 flash" sub={lang === "fr" ? "TFLite Micro runtime · 100% offline" : "TFLite Micro runtime · 100% offline"} />
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            {lang === "fr" ? "Notes Edge-AI" : "Edge-AI Notes"}
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {info.esp32_feasibility.notes}
          </p>
          <p className="text-[11px] text-slate-600 leading-relaxed mt-2">
            <span className="font-semibold">Runtime recommandé :</span> {info.esp32_feasibility.recommended_runtime}
          </p>
        </div>

        {/* Download buttons */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
          <a href="/api/download?XTransformPort=8001&type=int8" target="_blank">
            <Button variant="outline" size="sm" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              <Download className="h-3 w-3 mr-1.5" /> INT8 model ({info.sizes_kb.int8_dynamic} KB)
            </Button>
          </a>
          <a href="/api/download?XTransformPort=8001&type=onnx" target="_blank">
            <Button variant="outline" size="sm" className="border-teal-300 text-teal-700 hover:bg-teal-50">
              <Download className="h-3 w-3 mr-1.5" /> ONNX ({info.sizes_kb.onnx ?? "—"} KB)
            </Button>
          </a>
          <a href="/api/download?XTransformPort=8001&type=manifest" target="_blank">
            <Button variant="outline" size="sm" className="border-slate-300 text-slate-700 hover:bg-slate-50">
              <Download className="h-3 w-3 mr-1.5" /> Manifest JSON
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, icon, color, highlight = false }: { label: string; value: string; icon: React.ReactNode; color: string; highlight?: boolean }) {
  return (
    <div className={
      "rounded-xl border p-3 " +
      (highlight ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50/50")
    }>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-lg font-bold" style={{ color: highlight ? "#059669" : "#0f172a" }}>{value}</div>
    </div>
  );
}

function MetricRow({ label, value, color, sub, highlight = false }: { label: string; value: string; color: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="text-[9px] text-slate-500 uppercase tracking-wider">{label} {sub && <span className="text-slate-400">({sub})</span>}</div>
      <div className="font-bold text-sm" style={{ color: highlight ? color : "#0f172a" }}>{value}</div>
    </div>
  );
}

function PipelineStep({ n, text, sub, active = false }: { n: number; text: string; sub: string; active?: boolean }) {
  return (
    <div className={"flex items-start gap-2 p-1.5 rounded " + (active ? "" : "opacity-50")}>
      <div className={
        "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold flex-shrink-0 " +
        (active ? "bg-emerald-500 text-white" : "bg-slate-300 text-slate-600")
      }>
        {active ? "✓" : n}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-slate-800">{text}</div>
        <div className="text-[10px] text-slate-500">{sub}</div>
      </div>
    </div>
  );
}
