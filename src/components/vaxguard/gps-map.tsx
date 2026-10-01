"use client";

import { useMemo } from "react";
import { MapPin, Navigation, Building2, Phone, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t, type Lang } from "@/lib/i18n";
import type { Dispensary } from "@/lib/vaxguard-client";

interface Props {
  lang: Lang;
  vehicleLat: number;
  vehicleLng: number;
  nearest: Dispensary | null;
  dispensaries: Dispensary[];
  route: { lat: number; lng: number }[];
  alertState: string;
}

// Bounding box for the map (Benin central, Abomey-Covè-Dasso region)
// lat: 6.95 to 7.55, lng: 1.95 to 2.65
const BBOX = {
  minLat: 6.9,
  maxLat: 7.6,
  minLng: 1.95,
  maxLng: 2.7,
};

const MAP_W = 540;
const MAP_H = 380;

function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng - BBOX.minLng) / (BBOX.maxLng - BBOX.minLng)) * MAP_W;
  const y = MAP_H - ((lat - BBOX.minLat) / (BBOX.maxLat - BBOX.minLat)) * MAP_H;
  return { x, y };
}

export function GpsMap({ lang, vehicleLat, vehicleLng, nearest, dispensaries, route, alertState }: Props) {
  const routePts = useMemo(() => route.map((p) => project(p.lat, p.lng)), [route]);
  const routePath = routePts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ") + " Z";
  const veh = project(vehicleLat, vehicleLng);

  const isCritical = alertState === "critical";

  return (
    <Card className="border-teal-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base text-teal-800 flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {t(lang, "mapTitle")}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {t(lang, "mapSubtitle")}
            </CardDescription>
          </div>
          {nearest && (
            <Badge variant="outline" className="text-[10px] font-mono border-teal-200 bg-teal-50 text-teal-700">
              {nearest.distance_km?.toFixed(1)} km
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* SVG Map */}
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-teal-50/50 to-cyan-50">
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full h-auto" style={{ display: "block" }}>
            {/* Background grid */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#cbd5e1" strokeWidth="0.5" opacity="0.5" />
              </pattern>
              <radialGradient id="vehGlow">
                <stop offset="0%" stopColor={isCritical ? "#dc2626" : "#0ea5e9"} stopOpacity={0.6} />
                <stop offset="100%" stopColor={isCritical ? "#dc2626" : "#0ea5e9"} stopOpacity={0} />
              </radialGradient>
            </defs>
            <rect width={MAP_W} height={MAP_H} fill="url(#grid)" />

            {/* Compass rose */}
            <g transform={`translate(${MAP_W - 50}, 30)`}>
              <circle r="14" fill="white" opacity="0.8" stroke="#cbd5e1" />
              <path d="M0,-10 L3,4 L0,1 L-3,4 Z" fill="#0ea5e9" />
              <text x="0" y="-14" textAnchor="middle" fontSize="8" fill="#475569" fontWeight="600">N</text>
            </g>

            {/* Country label */}
            <text x={20} y={30} fontSize="14" fontWeight="700" fill="#0f766e" opacity="0.5">BÉNIN</text>
            <text x={20} y={45} fontSize="9" fill="#475569" opacity="0.6">Région Zou / Atlantique</text>

            {/* Route (dashed) */}
            <path d={routePath} fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeDasharray="6 4" opacity="0.7" />

            {/* Dispensaries */}
            {dispensaries.map((d) => {
              const p = project(d.lat, d.lng);
              const isNearest = nearest?.id === d.id;
              return (
                <g key={d.id} transform={`translate(${p.x}, ${p.y})`}>
                  <circle r={isNearest ? 8 : 6} fill={isNearest ? "#10b981" : "#64748b"} opacity={isNearest ? 0.3 : 0.15} />
                  <rect x={-5} y={-5} width="10" height="10" rx="2"
                    fill={isNearest ? "#10b981" : "#475569"} stroke="white" strokeWidth="1.5" />
                  <text x="10" y="3" fontSize="9" fill="#475569" fontWeight={isNearest ? 700 : 500}>
                    {d.name}
                  </text>
                  {isNearest && (
                    <text x="10" y="13" fontSize="8" fill="#059669" fontWeight="600">
                      {d.distance_km?.toFixed(1)} km
                    </text>
                  )}
                </g>
              );
            })}

            {/* Vehicle position */}
            <g transform={`translate(${veh.x}, ${veh.y})`}>
              <circle r="18" fill="url(#vehGlow)" className={isCritical ? "animate-ping" : ""} />
              <circle r="9" fill="white" />
              <circle r="7" fill={isCritical ? "#dc2626" : "#0ea5e9"} className={isCritical ? "animate-pulse" : ""} />
              <text x="0" y="2" textAnchor="middle" fontSize="10" fill="white">🚚</text>
              <text x="14" y="-8" fontSize="9" fill="#0f172a" fontWeight="700">
                {t(lang, "vehicle")}
              </text>
            </g>

            {/* Alert overlay if critical */}
            {isCritical && (
              <g>
                <rect x="10" y={MAP_H - 36} width="220" height="26" rx="6" fill="#dc2626" opacity="0.92" />
                <text x="20" y={MAP_H - 18} fontSize="11" fontWeight="700" fill="white">
                  {lang === "fr" ? "⚠ ALERTE : envoi SMS auto" : "⚠ ALERT: auto SMS dispatch"}
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* Nearest dispensary card */}
        {nearest && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Building2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    {t(lang, "nearest")}
                  </div>
                  <div className="text-sm font-semibold text-slate-800 mt-0.5">{nearest.name}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {t(lang, "distance")}: <span className="font-mono font-bold text-emerald-700">{nearest.distance_km?.toFixed(1)} km</span>
                    {" · "}
                    <span className="text-slate-500">{nearest.phone}</span>
                  </div>
                </div>
              </div>
              <Button size="sm" variant="outline" className="border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100">
                <Phone className="h-3 w-3 mr-1" /> {t(lang, "callDisp")}
              </Button>
            </div>
          </div>
        )}

        {/* Route info */}
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <Navigation className="h-3 w-3" />
            <span>{t(lang, "route")}</span>
          </div>
          <span className="font-mono">
            {vehicleLat.toFixed(4)}, {vehicleLng.toFixed(4)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
