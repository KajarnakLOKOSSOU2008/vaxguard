"use client";

import { useMemo } from "react";
import { History, TrendingDown, AlertTriangle, MessageSquare, CheckCircle2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { t, type Lang } from "@/lib/i18n";
import type { Expedition } from "@/lib/vaxguard-client";

interface Props {
  lang: Lang;
  expeditions: Expedition[];
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export function HistoryPanel({ lang, expeditions }: Props) {
  const stats = useMemo(() => {
    if (expeditions.length === 0) return { avg: 0, succ: 0, totalAlerts: 0, totalSms: 0 };
    const avg = expeditions.reduce((s, e) => s + e.alert_count, 0) / expeditions.length;
    const succ = expeditions.filter((e) => e.min_mtt > 15).length / expeditions.length * 100;
    const totalAlerts = expeditions.reduce((s, e) => s + e.alert_count, 0);
    const totalSms = expeditions.reduce((s, e) => s + e.sms_count, 0);
    return { avg, succ, totalAlerts, totalSms };
  }, [expeditions]);

  const scenarioData = useMemo(() => {
    const map: Record<string, number> = {};
    expeditions.forEach((e) => { map[e.scenario] = (map[e.scenario] ?? 0) + 1; });
    return Object.entries(map).map(([k, v]) => ({ scenario: k, count: v }));
  }, [expeditions]);

  const alertData = expeditions.map((e) => ({
    name: e.id.replace("exp_", "#"),
    alerts: e.alert_count,
    sms: e.sms_count,
  }));

  const scenarioColors: Record<string, string> = {
    normal: "#10b981",
    solar_burst: "#f59e0b",
    lid_open: "#ef4444",
    ac_failure: "#8b5cf6",
    recovery: "#06b6d4",
  };

  return (
    <Card className="border-teal-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-teal-800 flex items-center gap-2">
          <History className="h-4 w-4" />
          {t(lang, "histTitle")}
        </CardTitle>
        <CardDescription className="text-xs mt-0.5">
          {t(lang, "histSubtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            label={t(lang, "avgAlerts")}
            value={stats.avg.toFixed(1)}
            icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
            color="#f59e0b"
          />
          <KpiTile
            label={t(lang, "successRate")}
            value={`${stats.succ.toFixed(0)}%`}
            sub={t(lang, "successThresh")}
            icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
            color="#10b981"
          />
          <KpiTile
            label={lang === "fr" ? "Alertes (total)" : "Alerts (total)"}
            value={stats.totalAlerts.toString()}
            icon={<TrendingDown className="h-3.5 w-3.5 text-red-500" />}
            color="#ef4444"
          />
          <KpiTile
            label={lang === "fr" ? "SMS (total)" : "SMS (total)"}
            value={stats.totalSms.toString()}
            icon={<MessageSquare className="h-3.5 w-3.5 text-teal-500" />}
            color="#0ea5e9"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {lang === "fr" ? "Alertes par expédition" : "Alerts per expedition"}
            </div>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={alertData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 10, borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="alerts" fill="#f59e0b" name={t(lang, "alerts")} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="sms" fill="#0ea5e9" name={t(lang, "smsCountCol")} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {lang === "fr" ? "Répartition scénarios" : "Scenario distribution"}
            </div>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={scenarioData}
                    dataKey="count"
                    nameKey="scenario"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    innerRadius={30}
                  >
                    {scenarioData.map((entry) => (
                      <Cell key={entry.scenario} fill={scenarioColors[entry.scenario] ?? "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 10, borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Expedition table */}
        <div className="rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wider">{t(lang, "expedition")}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">{t(lang, "vehicle")}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">{t(lang, "routeLabel")}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">{t(lang, "duration")}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">{t(lang, "alerts")}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">{t(lang, "smsCountCol")}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">{t(lang, "minMtt")}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">{t(lang, "endedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expeditions.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs font-mono font-semibold">{e.id.replace("exp_", "#")}</TableCell>
                  <TableCell className="text-xs">{e.vehicle}</TableCell>
                  <TableCell className="text-xs text-slate-600">{e.route}</TableCell>
                  <TableCell className="text-xs font-mono">{e.duration_min}</TableCell>
                  <TableCell className="text-xs text-right">
                    <Badge variant="outline" className={
                      e.alert_count > 3
                        ? "border-red-300 bg-red-50 text-red-700"
                        : e.alert_count > 0
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }>
                      {e.alert_count}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">{e.sms_count}</TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    <span className={e.min_mtt < 15 ? "text-red-600 font-bold" : "text-emerald-600 font-semibold"}>
                      {e.min_mtt.toFixed(1)}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{fmtDate(e.ended_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiTile({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
