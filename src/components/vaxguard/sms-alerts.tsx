"use client";

import { MessageSquare, Send, MapPin, Clock, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { t, type Lang } from "@/lib/i18n";

interface Props {
  lang: Lang;
  smsLog: any[];
  smsCount: number;
  onDispatch: () => void;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

export function SmsAlerts({ lang, smsLog, smsCount, onDispatch }: Props) {
  const reversed = [...smsLog].reverse(); // most recent first

  return (
    <Card className="border-teal-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base text-teal-800 flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              {t(lang, "smsTitle")}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {t(lang, "smsSubtitle")}
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
            {t(lang, "smsCount")}: <span className="font-bold ml-1">{smsCount}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Dispatch button */}
        <Button
          onClick={onDispatch}
          variant="outline"
          className="w-full border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
        >
          <Send className="h-3.5 w-3.5 mr-1.5" />
          {t(lang, "dispatchSms")}
        </Button>

        {/* Log */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/50">
          <ScrollArea className="h-[280px] w-full">
            <div className="p-3 space-y-2">
              {reversed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[220px] text-slate-400">
                  <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
                  <span className="text-xs">{t(lang, "noSms")}</span>
                </div>
              ) : (
                reversed.map((sms, i) => (
                  <div key={sms.id ?? i}
                    className={
                      "rounded-lg border p-2.5 text-xs " +
                      (sms.auto
                        ? "border-red-200 bg-red-50/50"
                        : "border-amber-200 bg-amber-50/50")
                    }
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className={
                        "text-[9px] font-semibold uppercase tracking-wider " +
                        (sms.auto
                          ? "border-red-300 bg-red-100 text-red-700"
                          : "border-amber-300 bg-amber-100 text-amber-700")
                      }>
                        {sms.auto ? t(lang, "smsAuto") : t(lang, "smsManual")}
                      </Badge>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {fmtTime(sms.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-600 mb-1">
                      <Phone className="h-2.5 w-2.5" />
                      <span className="font-mono">{sms.phone}</span>
                      <span className="text-slate-400">→</span>
                      <span className="font-medium truncate">{sms.recipient}</span>
                    </div>
                    {sms.lat && sms.lng && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1 font-mono">
                        <MapPin className="h-2.5 w-2.5" />
                        {sms.lat.toFixed(4)}, {sms.lng.toFixed(4)}
                      </div>
                    )}
                    <div className="rounded bg-white/80 p-1.5 font-mono text-[10px] text-slate-700 border border-slate-200">
                      {sms.message}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
