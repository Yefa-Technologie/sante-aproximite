"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Navigation2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BarChart } from "@/components/dashboard/charts/BarChart";
import { DonutChart } from "@/components/dashboard/charts/DonutChart";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Siren, Ambulance, CheckCircle2, Archive } from "lucide-react";

type EmergencyAlert = {
  id: string;
  status: "NEW" | "ACKNOWLEDGED" | "EN_ROUTE" | "ON_SITE" | "COMPLETED" | "CLOSED";
  emergencyType?: string;
  reporterName?: string;
  phoneNumber?: string;
  handlerBaseName?: string;
  description?: string;
  createdAt: string;
  latitude: number;
  longitude: number;
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "NOUVELLE",
  ACKNOWLEDGED: "PRISE EN CHARGE",
  EN_ROUTE: "EN ROUTE",
  ON_SITE: "SUR SITE",
  COMPLETED: "TERMINEE",
  CLOSED: "CLOTUREE",
};

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso)
  );
}

export function EmergencyResponderOverview({
  badge,
  title,
  subtitle,
  bannerText,
  bannerCta,
  nonTraiteTag,
}: {
  badge: string;
  title: string;
  subtitle: string;
  bannerText: (count: number) => string;
  bannerCta: string;
  nonTraiteTag: string;
}) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function load() {
    setError("");
    try {
      const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const data = await apiFetch<EmergencyAlert[]>(`/emergency-reports?dateFrom=${from}&dateTo=${to}`, { token });
      setAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const stats = useMemo(() => {
    const nonTraite = alerts.filter((a) => a.status === "NEW").length;
    const enCours = alerts.filter((a) => ["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(a.status)).length;
    const traite = alerts.filter((a) => a.status === "COMPLETED").length;
    const rejete = alerts.filter((a) => a.status === "CLOSED").length;
    return { nonTraite, enCours, traite, rejete };
  }, [alerts]);

  const totalAlerts = alerts.length;
  const traitementRate = totalAlerts > 0 ? Math.round((stats.traite * 100) / totalAlerts) : 0;

  const alertsByHour = useMemo(() => {
    const counts = Array(24).fill(0);
    alerts.forEach((a) => {
      const h = new Date(a.createdAt).getHours();
      counts[h]++;
    });
    return counts.map((count, i) => ({ label: i % 3 === 0 ? `${String(i).padStart(2, "0")}h` : "", count }));
  }, [alerts]);

  const activeAlerts = useMemo(
    () => alerts.filter((a) => ["NEW", "ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(a.status)).slice(0, 5),
    [alerts]
  );

  async function takeInCharge(item: EmergencyAlert) {
    try {
      let position: { lat: number; lon: number } | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject)
        );
        position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      } catch {
        position = null;
      }
      await apiFetch(`/emergency-reports/${item.id}/acknowledge`, {
        token,
        method: "POST",
        body: position ? { teamLatitude: position.lat, teamLongitude: position.lon } : {},
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  function navigateTo(item: EmergencyAlert) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`, "_blank");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-black text-white">{badge}</span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{title}</h1>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {totalAlerts > 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-center">
              <p className="text-lg font-black text-emerald-600">{traitementRate}%</p>
              <p className="text-[10px] text-slate-500">Taux de traitement</p>
            </div>
          ) : null}
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-semibold text-red-600">
            {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium" }).format(now)}
          </div>
        </div>
      </div>

      {stats.nonTraite > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-red-300 bg-red-50 px-5 py-3">
          <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
          <strong className="flex-1 text-sm text-red-900">{bannerText(stats.nonTraite)}</strong>
          <Button size="sm" onClick={() => router.push("/dashboard/emergency-alerts")}>
            {bannerCta}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Siren}
          tag={nonTraiteTag}
          value={stats.nonTraite}
          sub="Alertes en attente"
          accent="red"
          onClick={() => router.push("/dashboard/emergency-alerts")}
          detail={stats.nonTraite === 0 ? "Aucune alerte en attente ✓" : undefined}
        />
        <KpiCard icon={Ambulance} tag="EN COURS" value={stats.enCours} sub="Interventions actives" accent="amber" />
        <KpiCard
          icon={CheckCircle2}
          tag="TERMINEES"
          value={stats.traite}
          sub="Interventions completees"
          accent="green"
          detail={`Taux de resolution ${traitementRate}%`}
        />
        <KpiCard icon={Archive} tag="CLOTUREES" value={stats.rejete} sub="Dossiers clos" accent="slate" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Alertes par heure - periode en cours</p>
            <span className="rounded-full bg-red-50 px-3 py-0.5 text-xs font-bold text-red-600">
              Total : {totalAlerts}
            </span>
          </div>
          <BarChart data={alertsByHour} color="#ef4444" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Repartition par statut</p>
          <DonutChart
            centerLabel="alertes"
            centerValue={totalAlerts}
            segments={[
              { label: "Non traitees", count: stats.nonTraite, color: "#ef4444" },
              { label: "En cours", count: stats.enCours, color: "#f59e0b" },
              { label: "Terminees", count: stats.traite, color: "#10b981" },
              { label: "Cloturees", count: stats.rejete, color: "#94a3b8" },
            ]}
          />
        </div>
      </div>

      {activeAlerts.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">Alertes actives - intervention requise</p>
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/emergency-alerts")}>
              Tout voir →
            </Button>
          </div>
          <div className="flex flex-col gap-3">
            {activeAlerts.map((item) => (
              <div
                key={item.id}
                className={`rounded-xl border p-4 ${
                  item.status === "NEW" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">{item.emergencyType || "Urgence medicale"}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      item.status === "NEW" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-slate-500">
                  {item.reporterName ? <span>👤 {item.reporterName}</span> : null}
                  {item.phoneNumber ? <span>📞 {item.phoneNumber}</span> : null}
                  {item.createdAt ? <span>🕐 {formatTime(item.createdAt)}</span> : null}
                </div>
                {item.description ? <p className="mt-2 text-sm text-slate-600">{item.description}</p> : null}
                <div className="mt-3 flex gap-2">
                  {item.status === "NEW" ? (
                    <Button size="sm" onClick={() => takeInCharge(item)}>
                      <AlertTriangle className="h-3.5 w-3.5" /> Prendre en charge
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => navigateTo(item)}>
                    <Navigation2 className="h-3.5 w-3.5" /> Naviguer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={load}>Actualiser</Button>
        <Button variant="outline" onClick={() => router.push("/dashboard/emergency-alerts")}>
          Toutes les alertes
        </Button>
        <Button variant="outline" onClick={() => router.push("/dashboard/nearby")}>
          Centres de sante proches
        </Button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
    </div>
  );
}
