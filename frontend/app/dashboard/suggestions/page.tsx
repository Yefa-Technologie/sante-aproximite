"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { formatDate } from "@/lib/format";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Lightbulb } from "lucide-react";

type Suggestion = {
  id: string;
  userFullName: string | null;
  centerName?: string;
  centerCode?: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};
type Summary = { total: number; unreadCount: number };

export default function SuggestionsPage() {
  const { token } = useAuthStore();
  const [list, setList] = useState<Suggestion[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState("");

  async function load() {
    setError("");
    try {
      setList(await apiFetch<Suggestion[]>("/suggestions", { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }
  async function loadSummary() {
    try {
      setSummary(await apiFetch<Summary>("/suggestions/summary", { token }));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function markRead(item: Suggestion) {
    setError("");
    setSuccess("");
    setActionLoadingId(item.id);
    try {
      await apiFetch(`/suggestions/${item.id}/read`, { token, method: "PATCH" });
      setSuccess("Observation marquee comme lue");
      await Promise.all([load(), loadSummary()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setActionLoadingId("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Lightbulb}
        title="Observations & suggestions"
        action={<Button variant="outline" size="sm" onClick={load}>Actualiser</Button>}
      />

      {summary ? (
        <div className="flex gap-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-center shadow-sm">
            <p className="text-lg font-black text-slate-900">{summary.total}</p>
            <p className="text-[10px] text-slate-500">Total</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-center">
            <p className="text-lg font-black text-amber-600">{summary.unreadCount}</p>
            <p className="text-[10px] text-slate-500">Non lues</p>
          </div>
        </div>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="flex flex-col gap-3">
        {list.length === 0 ? <p className="text-sm text-slate-400">Aucune observation.</p> : null}
        {list.map((item) => (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">{item.userFullName || "Usager"}</h4>
              <Badge variant={item.isRead ? "green" : "amber"}>{item.isRead ? "Lue" : "Non lue"}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              <strong>Centre:</strong> {item.centerName || "Non specifie"} ({item.centerCode || "-"})
            </p>
            <p className="mt-1 text-sm text-slate-700">{item.message}</p>
            <p className="mt-1 text-[11px] text-slate-400">{formatDate(item.createdAt)}</p>
            {!item.isRead ? (
              <Button size="sm" className="mt-2" disabled={actionLoadingId === item.id} onClick={() => markRead(item)}>
                {actionLoadingId === item.id ? "..." : "Marquer comme lue"}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
