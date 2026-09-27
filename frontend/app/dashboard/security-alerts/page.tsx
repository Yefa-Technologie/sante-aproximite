"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { hasAnyRole } from "@/lib/roles";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ShieldAlert, Navigation2 } from "lucide-react";

type SecurityAlertItem = {
  id: string;
  alertType: string;
  locationName: string;
  description: string;
  phoneNumber: string;
  reporterName?: string;
  handlerName?: string;
  handledAt?: string | null;
  photos: string[];
  latitude: number;
  longitude: number;
  status: "NEW" | "ACKNOWLEDGED" | "RESOLVED" | "CLOSED";
  createdAt: string;
};

const CATEGORY_MENU = [
  { key: "ALL", label: "Toutes" },
  { key: "UNHANDLED", label: "Non traite" },
  { key: "IN_PROGRESS", label: "En cours" },
  { key: "RESOLVED", label: "Resolues" },
  { key: "CLOSED", label: "Cloturees" },
];

const TYPE_ICON: Record<string, string> = { AGRESSION: "⚠️", ACCIDENT: "🚗", INCENDIE: "🔥", INTRUSION: "🚪", AUTRE: "📋" };
const TYPE_LABEL: Record<string, string> = { AGRESSION: "Agression", ACCIDENT: "Accident", INCENDIE: "Incendie", INTRUSION: "Intrusion", AUTRE: "Autre" };
const STATUS_LABEL: Record<string, string> = { NEW: "Nouveau", ACKNOWLEDGED: "Pris en charge", RESOLVED: "Resolu", CLOSED: "Cloture" };

function formatDate(raw: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(raw));
}

function cardTone(status: string) {
  if (status === "NEW") return "border-red-300 bg-red-50";
  if (status === "ACKNOWLEDGED") return "border-amber-300 bg-amber-50";
  if (status === "RESOLVED") return "border-emerald-300 bg-emerald-50";
  return "border-slate-300 bg-slate-50 opacity-90";
}

export default function SecurityAlertsPage() {
  const { user, token } = useAuthStore();
  const [alerts, setAlerts] = useState<SecurityAlertItem[]>([]);
  const [category, setCategory] = useState("ALL");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const serviceLabel = hasAnyRole(user, ["POLICE"])
    ? "Police Nationale"
    : hasAnyRole(user, ["GENDARMERIE"])
      ? "Gendarmerie Nationale"
      : hasAnyRole(user, ["PROTECTION_CIVILE"])
        ? "Protection Civile"
        : "Toutes les alertes de securite";

  async function load() {
    setError("");
    try {
      setAlerts(await apiFetch<SecurityAlertItem[]>("/security-alerts", { token }));
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
    if (category === "IN_PROGRESS") return alerts.filter((a) => a.status === "ACKNOWLEDGED");
    if (category === "RESOLVED") return alerts.filter((a) => a.status === "RESOLVED");
    if (category === "CLOSED") return alerts.filter((a) => a.status === "CLOSED");
    return alerts;
  }, [alerts, category]);

  async function setStatus(item: SecurityAlertItem, status: string) {
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/security-alerts/${item.id}`, { token, method: "PATCH", body: { status } });
      setSuccess(status === "ACKNOWLEDGED" ? "Alerte prise en compte" : status === "RESOLVED" ? "Alerte resolue" : "Alerte cloturee");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  function navigateTo(item: SecurityAlertItem) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`, "_blank");
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={ShieldAlert} title="Alertes de securite" subtitle={serviceLabel} />

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
        <Button variant="outline" size="sm" onClick={load}>Actualiser</Button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filtered.length === 0 ? <p className="text-sm text-slate-400">Aucune alerte pour ce filtre.</p> : null}
        {filtered.map((item) => (
          <div key={item.id} className={`rounded-2xl border p-4 shadow-sm ${cardTone(item.status)}`}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <span>{TYPE_ICON[item.alertType] || "📋"}</span> {TYPE_LABEL[item.alertType] || item.alertType}
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-slate-600 shadow-sm">
                {STATUS_LABEL[item.status] || item.status}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
              <span><strong className="text-slate-400">Lieu:</strong> {item.locationName || "-"}</span>
              <span><strong className="text-slate-400">Signalant:</strong> {item.reporterName || "-"}</span>
              <span><strong className="text-slate-400">Telephone:</strong> {item.phoneNumber || "-"}</span>
              <span><strong className="text-slate-400">Signale le:</strong> {formatDate(item.createdAt)}</span>
              {item.handlerName ? <span><strong className="text-slate-400">Pris en charge par:</strong> {item.handlerName}</span> : null}
              {item.handledAt ? <span><strong className="text-slate-400">Le:</strong> {formatDate(item.handledAt)}</span> : null}
            </div>
            {item.description ? <p className="mt-2 rounded-lg bg-white/70 p-2 text-sm text-slate-700">{item.description}</p> : null}
            {item.photos?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {item.photos.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt="Photo alerte" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {item.status === "NEW" ? <Button size="sm" onClick={() => setStatus(item, "ACKNOWLEDGED")}>Prendre en compte</Button> : null}
              {item.status === "ACKNOWLEDGED" ? <Button size="sm" variant="secondary" onClick={() => setStatus(item, "RESOLVED")}>Marquer resolu</Button> : null}
              {["ACKNOWLEDGED", "RESOLVED"].includes(item.status) ? <Button size="sm" variant="outline" onClick={() => setStatus(item, "CLOSED")}>Cloturer</Button> : null}
              <Button size="sm" variant="secondary" onClick={() => navigateTo(item)}>
                <Navigation2 className="h-3.5 w-3.5" /> Naviguer
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
