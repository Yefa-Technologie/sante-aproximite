"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { formatDate } from "@/lib/format";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Ambulance, RefreshCcw } from "lucide-react";

type Referral = {
  id: string;
  originUserName: string | null;
  patientPhone: string;
  patientName: string | null;
  serviceName: string | null;
  reason: string | null;
  status: "PENDING" | "RECEIVED" | "REJECTED" | "CANCELLED";
  receivedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

export default function ReferralsPage() {
  const { token } = useAuthStore();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [rejectingId, setRejectingId] = useState("");
  const [rejectDrafts, setRejectDrafts] = useState<Record<string, string>>({});

  async function load() {
    setError("");
    try {
      const data = await apiFetch<Referral[]>("/referrals/incoming", { token });
      setReferrals(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const pending = useMemo(() => referrals.filter((r) => r.status === "PENDING"), [referrals]);
  const received = useMemo(() => referrals.filter((r) => r.status === "RECEIVED"), [referrals]);
  const rejected = useMemo(() => referrals.filter((r) => r.status === "REJECTED"), [referrals]);

  async function confirm(item: Referral) {
    setError("");
    setSuccess("");
    setActionLoadingId(item.id);
    try {
      await apiFetch(`/referrals/${item.id}/confirm`, { token, method: "POST" });
      setSuccess("Reception du patient confirmee");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setActionLoadingId("");
    }
  }

  async function reject(item: Referral) {
    const reason = (rejectDrafts[item.id] || "").trim();
    if (!reason) {
      setError("Indiquez un motif de rejet");
      return;
    }
    setError("");
    setSuccess("");
    setActionLoadingId(item.id);
    try {
      await apiFetch(`/referrals/${item.id}/reject`, { token, method: "POST", body: { reason } });
      setSuccess("Orientation rejetee");
      setRejectingId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setActionLoadingId("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Ambulance}
        title="Orientations de patients"
        subtitle="Patients orientes vers votre centre par un autre professionnel"
        action={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCcw className="h-3.5 w-3.5" /> Actualiser
          </Button>
        }
      />

      <div className="flex gap-3">
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-center">
          <p className="text-lg font-black text-blue-600">{pending.length}</p>
          <p className="text-[10px] text-slate-500">En attente</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-center">
          <p className="text-lg font-black text-emerald-600">{received.length}</p>
          <p className="text-[10px] text-slate-500">Recus</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-center">
          <p className="text-lg font-black text-slate-500">{rejected.length}</p>
          <p className="text-[10px] text-slate-500">Rejetes</p>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="flex flex-col gap-3">
        {[...pending, ...received, ...rejected].length === 0 ? (
          <p className="text-sm text-slate-400">Aucune orientation pour votre centre.</p>
        ) : null}
        {[...pending, ...received, ...rejected].map((item) => (
          <div
            key={item.id}
            className={`rounded-2xl border p-4 shadow-sm ${
              item.status === "PENDING" ? "border-blue-200 bg-white" : "border-slate-200 bg-white opacity-90"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-900">{item.patientName || item.patientPhone}</span>
              <Badge variant={item.status === "PENDING" ? "red" : item.status === "REJECTED" ? "slate" : "green"}>
                {item.status === "PENDING" ? "En attente" : item.status === "REJECTED" ? "Rejete" : "Recu"}
              </Badge>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
              <span><strong className="text-slate-400">Telephone :</strong> {item.patientPhone}</span>
              <span><strong className="text-slate-400">Oriente par :</strong> {item.originUserName || "-"}</span>
              {item.serviceName ? <span><strong className="text-slate-400">Service :</strong> {item.serviceName}</span> : null}
              {item.reason ? <span><strong className="text-slate-400">Motif :</strong> {item.reason}</span> : null}
              <span><strong className="text-slate-400">Oriente le :</strong> {formatDate(item.createdAt)}</span>
              {item.status === "RECEIVED" && item.receivedAt ? <span><strong className="text-slate-400">Recu le :</strong> {formatDate(item.receivedAt)}</span> : null}
              {item.status === "REJECTED" && item.receivedAt ? <span><strong className="text-slate-400">Rejete le :</strong> {formatDate(item.receivedAt)}</span> : null}
              {item.rejectionReason ? <span><strong className="text-slate-400">Motif du rejet :</strong> {item.rejectionReason}</span> : null}
            </div>
            {item.status === "PENDING" ? (
              rejectingId === item.id ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    className="flex-1"
                    placeholder="Motif du rejet"
                    value={rejectDrafts[item.id] || ""}
                    onChange={(e) => setRejectDrafts((p) => ({ ...p, [item.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setRejectingId("")}>Annuler</Button>
                    <Button size="sm" variant="danger" disabled={actionLoadingId === item.id} onClick={() => reject(item)}>
                      {actionLoadingId === item.id ? "..." : "Confirmer le rejet"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={actionLoadingId === item.id} onClick={() => confirm(item)}>
                    {actionLoadingId === item.id ? "..." : "Confirmer la reception"}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setRejectingId(item.id)}>Rejeter</Button>
                </div>
              )
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
