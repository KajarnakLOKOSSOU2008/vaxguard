"use client";

import { Sparkles, Brain, Clock, Cpu, Zap, Loader2, Play, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { t, type Lang } from "@/lib/i18n";
import type { GemmaAnalysis } from "@/lib/vaxguard-client";

interface Props {
  lang: Lang;
  gemmaLog: GemmaAnalysis[];
  gemmaInfo: any;
  gemmaAnalyzing: boolean;
  onTrigger: (lang: string) => void;
  currentScenario: string;
  alertState: string;
}

function fmtTime(ts?: number): string {
  if (!ts) return "";
  try {
    return new Date(ts * 1000).toLocaleTimeString(
      undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    );
  } catch { return ""; }
}

export function GemmaPanel({ lang: uiLang, gemmaLog, gemmaInfo, gemmaAnalyzing, onTrigger, currentScenario, alertState }: Props) {
  const reversed = [...gemmaLog].reverse();
  const available = gemmaInfo?.available === true;
  const loaded = gemmaInfo?.loaded === true;
  const sizeMb = gemmaInfo?.size_mb;
  const quant = gemmaInfo?.quantization;
  const modelName = gemmaInfo?.model_name ?? "Gemma 2B";

  return (
    <Card className="border-violet-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base text-violet-800 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {uiLang === "fr"
                ? "Analyse LLM Gemma 2B (Small IA)"
                : "Gemma 2B LLM Analysis (Small IA)"}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {uiLang === "fr"
                ? "Couche d'interprétation en langage naturel au-dessus du CNN-GRU"
                : "Natural-language interpretation layer over the CNN-GRU"}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            {available ? (
              <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-700 gap-1.5">
                <Cpu className="h-3 w-3" />
                {loaded ? (uiLang === "fr" ? "chargé" : "loaded") : (uiLang === "fr" ? "disponible" : "ready")}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-500 gap-1.5">
                {uiLang === "fr" ? "non disponible" : "unavailable"}
              </Badge>
            )}
            {sizeMb && (
              <span className="text-[10px] text-slate-500 font-mono">
                {sizeMb.toFixed(0)} MB · {quant}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Model status */}
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-violet-700 mb-2">
            <Brain className="h-3 w-3" />
            {uiLang === "fr" ? "Architecture LLM" : "LLM architecture"}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{uiLang === "fr" ? "Modèle" : "Model"}</div>
              <div className="font-bold text-slate-800">{modelName}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{uiLang === "fr" ? "Params" : "Params"}</div>
              <div className="font-bold text-slate-800">2.0 B</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{uiLang === "fr" ? "Quant." : "Quant."}</div>
              <div className="font-bold text-slate-800">{quant ?? "IQ3_M"}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{uiLang === "fr" ? "Runtime" : "Runtime"}</div>
              <div className="font-bold text-slate-800">llama.cpp CPU</div>
            </div>
          </div>
          <Separator className="my-2" />
          <div className="text-[11px] text-slate-600 leading-relaxed">
            {uiLang === "fr"
              ? "Gemma 2B = LLM \"Small IA\" de Google (2 milliards de params). Tourne côté serveur (tablette dispensaire) — l'ESP32 garde le CNN-GRU INT8 16.9 KB en Edge-AI. Gemma analyse les prédictions CNN-GRU + génère recommandations actionnables en français."
              : "Gemma 2B = Google's Small-IA LLM (2 billion params). Runs server-side (dispensary tablet) — the ESP32 keeps the CNN-GRU INT8 16.9 KB as Edge-AI. Gemma interprets the CNN-GRU predictions + generates actionable recommendations in natural language."}
          </div>
        </div>

        {/* Trigger button */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] text-slate-500">
            {uiLang === "fr"
              ? "Cliquez pour générer une nouvelle analyse à partir de l'état actuel"
              : "Click to generate a fresh analysis from current state"}
          </div>
          <Button
            onClick={() => onTrigger(uiLang)}
            disabled={gemmaAnalyzing || !available}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {gemmaAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {uiLang === "fr" ? "Analyse en cours (90s)…" : "Analyzing (90s)…"}
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {uiLang === "fr" ? "Lancer l'analyse Gemma" : "Run Gemma analysis"}
              </>
            )}
          </Button>
        </div>

        {/* Analysis log */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/50">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <Sparkles className="h-3 w-3" />
              {uiLang === "fr" ? "Journal des analyses" : "Analyses log"}
            </div>
            <Badge variant="outline" className="text-[10px] border-slate-200 bg-slate-50 text-slate-600">
              {gemmaLog.length} {uiLang === "fr" ? "analyse(s)" : "analysis(es)"}
            </Badge>
          </div>
          <ScrollArea className="h-[480px] w-full">
            <div className="p-3 space-y-3">
              {reversed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[400px] text-slate-400">
                  <Sparkles className="h-10 w-10 mb-2 opacity-30" />
                  <span className="text-sm">
                    {uiLang === "fr"
                      ? "Aucune analyse Gemma encore. Lancez-en une !"
                      : "No Gemma analysis yet. Trigger one!"}
                  </span>
                  <span className="text-[10px] mt-1 text-slate-400">
                    {uiLang === "fr"
                      ? "Auto-trigger sur alerte critique (toutes les 10 min sim.)"
                      : "Auto-trigger on critical alert (every 10 min sim.)"}
                  </span>
                </div>
              ) : (
                reversed.map((analysis, i) => (
                  <AnalysisCard key={i} analysis={analysis} uiLang={uiLang} />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Footer info */}
        <div className="text-[10px] text-slate-500 leading-relaxed">
          {uiLang === "fr"
            ? "Architecture en 2 couches : (1) Edge-AI CNN-GRU INT8 16.9 KB sur ESP32-S3 → prédiction temps réel 100% offline ; (2) LLM Gemma 2B sur serveur dispensaire → interprétation + recommandations en français. Hackathon Small IA Banque Mondiale."
            : "Two-layer architecture: (1) Edge-AI CNN-GRU INT8 16.9 KB on ESP32-S3 → real-time 100% offline prediction; (2) Gemma 2B LLM on dispensary server → French interpretation + recommendations. World Bank Small IA hackathon."}
        </div>
      </CardContent>
    </Card>
  );
}

function AnalysisCard({ analysis, uiLang }: { analysis: GemmaAnalysis; uiLang: Lang }) {
  if (analysis.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
        <div className="flex items-center gap-1.5 mb-1">
          <Badge variant="outline" className="border-red-300 bg-red-100 text-red-700 text-[9px]">
            {uiLang === "fr" ? "ERREUR" : "ERROR"}
          </Badge>
          <span className="text-[10px] text-slate-500">{fmtTime(analysis.timestamp)}</span>
        </div>
        <div>{analysis.error}</div>
      </div>
    );
  }
  const isAuto = analysis.auto === true;
  return (
    <div className={
      "rounded-lg border p-3 text-xs " +
      (isAuto ? "border-violet-200 bg-violet-50/50" : "border-amber-200 bg-amber-50/50")
    }>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={
            "text-[9px] font-semibold uppercase tracking-wider " +
            (isAuto ? "border-violet-300 bg-violet-100 text-violet-700"
                    : "border-amber-300 bg-amber-100 text-amber-700")
          }>
            {isAuto ? (uiLang === "fr" ? "AUTO" : "AUTO") : (uiLang === "fr" ? "MANUEL" : "MANUAL")}
          </Badge>
          {analysis.scenario && (
            <span className="text-[10px] text-slate-500">scénario: <span className="font-mono">{analysis.scenario}</span></span>
          )}
          {analysis.step !== undefined && (
            <span className="text-[10px] text-slate-500">step {analysis.step}</span>
          )}
          {analysis.lang && (
            <Badge variant="outline" className="text-[9px] border-slate-200 bg-slate-50 text-slate-500">
              {analysis.lang === "fr" ? <Globe className="h-2 w-2 inline mr-0.5" /> : null}
              {analysis.lang.toUpperCase()}
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-slate-500 flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {fmtTime(analysis.timestamp)}
        </span>
      </div>

      <div className="rounded bg-white/80 p-2.5 border border-slate-200 text-slate-700 leading-relaxed whitespace-pre-wrap">
        {analysis.analysis}
      </div>

      <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
        {analysis.inference_time_s !== undefined && (
          <span className="flex items-center gap-0.5">
            <Zap className="h-2.5 w-2.5 text-violet-500" />
            {analysis.inference_time_s.toFixed(1)}s
          </span>
        )}
        {analysis.tokens_prompt !== undefined && (
          <span className="flex items-center gap-0.5">
            <Brain className="h-2.5 w-2.5 text-violet-500" />
            {analysis.tokens_prompt + (analysis.tokens_completion ?? 0)} tokens
          </span>
        )}
        {analysis.model && (
          <span className="font-mono text-slate-400">{analysis.model}</span>
        )}
      </div>
    </div>
  );
}
