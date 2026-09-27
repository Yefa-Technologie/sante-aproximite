"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { formatEmergencyStatus } from "@/lib/format";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Siren, Navigation2 } from "lucide-react";

type EmergencyAlert = {
  id: string;
  emergencyType: string;
  status: string;
  targetService: string;
  reporterName: string | null;
  phoneNumber: string;
  latitude: number;
  longitude: number;
  description: string;
  teamLatitude?: number | null;
  teamLongitude?: number | null;
  teamNote?: string | null;
};

const CATEGORY_MENU = [
  { key: "UNHANDLED", label: "Non traite" },
  { key: "IN_PROGRESS", label: "En cours" },
  { key: "REJECTED", label: "Rejete" },
  { key: "COMPLETED", label: "Traite" },
  { key: "ALL", label: "Tous" },
];

function cardTone(status: string) {
  if (status === "NEW") return "border-red-300 bg-red-50";
  if (["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(status)) return "border-amber-300 bg-amber-50";
  if (status === "COMPLETED") return "border-emerald-300 bg-emerald-50";
  if (status === "CLOSED") return "border-slate-300 bg-slate-50";
  return "border-slate-200 bg-white";
}

export default function EmergencyAlertsPage() {
  const { token } = useAuthStore();
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [category, setCategory] = useState("IN_PROGRESS");
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("dateFrom", from);
      if (to) params.set("dateTo", to);
      const data = await apiFetch<EmergencyAlert[]>(`/emergency-reports?${params.toString()}`, { token });
      setAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = useMemo(() => {
    if (category === "ALL") return alerts;
    if (category === "UNHANDLED") return alerts.filter((a) => a.status === "NEW");
    if (category === "IN_PROGRESS") return alerts.filter((a) => ["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(a.status));
    if (category === "REJECTED") return alerts.filter((a) => a.status === "CLOSED");
    if (category === "COMPLETED") return alerts.filter((a) => a.status === "COMPLETED");
    return alerts;
  }, [alerts, category]);

  async function takeInCharge(item: EmergencyAlert) {
    setError("");
    setSuccess("");
    try {
      let position: { lat: number; lon: number } | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
        position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      } catch {
        position = null;
      }
      await apiFetch(`/emergency-reports/${item.id}/acknowledge`, {
        token, method: "POST", body: position ? { teamLatitude: position.lat, teamLongitude: position.lon } : {},
      });
      setSuccess("Alerte prise en compte");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function setProgress(item: EmergencyAlert, status: string) {
    setError("");
    setSuccess("");
    try {
      const note = (notes[item.id] || "").trim();
      let position: { lat: number; lon: number } | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
        position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      } catch {
        position = null;
      }
      await apiFetch(`/emergency-reports/${item.id}/progress`, {
        token, method: "PATCH",
        body: { status, ...(note ? { teamNote: note } : {}), ...(position ? { teamLatitude: position.lat, teamLongitude: position.lon } : {}) },
      });
      setNotes((p) => ({ ...p, [item.id]: "" }));
      setSuccess("Statut mis a jour");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  function navigateTo(item: EmergencyAlert) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`, "_blank");
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={Siren} title="Alertes urgence" />

      <div className="flex flex-wrap items-center gap-2">
        {CATEGORY_MENU.map((item) => (
          <button
            key={item.key}
            onClick={() => setCategory(item.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
              category === item.key ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
            }`}
          >
            {item.label}
          </button>
        ))}
        <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-slate-400">au</span>
        <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="outline" size="sm" onClick={load}>Actualiser</Button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filtered.length === 0 ? <p className="text-sm text-slate-400">Aucune alerte pour ce filtre/periode.</p> : null}
        {filtered.map((item) => (
          <div key={item.id} className={`rounded-2xl border p-4 shadow-sm ${cardTone(item.status)}`}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">{item.emergencyType}</h4>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-slate-600 shadow-sm">
                {formatEmergencyStatus(item.status)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
              <span><strong className="text-slate-400">Service:</strong> {item.targetService}</span>
              <span><strong className="text-slate-400">Demandeur:</strong> {item.reporterName || "-"}</span>
              <span><strong className="text-slate-400">Telephone:</strong> {item.phoneNumber}</span>
              <span><strong className="text-slate-400">Position:</strong> {item.latitude}, {item.longitude}</span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{item.description}</p>
            {item.teamNote ? <p className="mt-1 text-xs text-slate-500"><strong>Avancement:</strong> {item.teamNote}</p> : null}
            <Textarea
              className="mt-2"
              rows={2}
              placeholder="Note d'avancement pour le demandeur"
              value={notes[item.id] || ""}
              onChange={(e) => setNotes((p) => ({ ...p, [item.id]: e.target.value }))}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {item.status === "NEW" ? <Button size="sm" onClick={() => takeInCharge(item)}>Prendre en compte</Button> : null}
              {["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(item.status) ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setProgress(item, "EN_ROUTE")}>En route</Button>
                  <Button size="sm" variant="secondary" onClick={() => setProgress(item, "ON_SITE")}>Sur site</Button>
                  <Button size="sm" onClick={() => setProgress(item, "COMPLETED")}>Terminer</Button>
                </>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => navigateTo(item)}>
                <Navigation2 className="h-3.5 w-3.5" /> Naviguer
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
