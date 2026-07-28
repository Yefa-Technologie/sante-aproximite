"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { isRegulator, isChef } from "@/lib/roles";
import { formatComplaintStatus, formatDate } from "@/lib/format";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { FileText } from "lucide-react";

type ComplaintUpdate = { id: string; status: string; message: string; createdAt: string };
type Complaint = {
  id: string;
  subject: string;
  message: string;
  status: string;
  centerName?: string;
  centerCode?: string;
  createdAt: string;
  updates?: ComplaintUpdate[];
};
type Summary = { scope: string; centerCount: number; ratingAverage: number | null; satisfactionRate: number | null };

const PAGE_SIZE = 5;

export default function ComplaintsPage() {
  const { user, token } = useAuthStore();
  const regulator = isRegulator(user);
  const chef = isChef(user);
  const canHandle = regulator || chef;

  const [statusFilter, setStatusFilter] = useState("");
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [page, setPage] = useState(1);

  async function load() {
    setError("");
    try {
      const q = statusFilter ? `?status=${statusFilter}` : "";
      const data = await apiFetch<Complaint[]>(`/complaints${q}`, { token });
      setComplaints(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function loadSummary() {
    try {
      setSummary(await apiFetch<Summary>("/complaints/summary", { token }));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(complaints.length / PAGE_SIZE));
  const paginated = useMemo(() => complaints.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [complaints, page]);

  async function setStatus(item: Complaint, status: string) {
    setError("");
    setSuccess("");
    try {
      const note = (notes[item.id] || "").trim();
      await apiFetch(`/complaints/${item.id}/status`, {
        token, method: "PATCH", body: { status, ...(note ? { message: note } : {}) },
      });
      setNotes((p) => ({ ...p, [item.id]: "" }));
      setSuccess(status === "IN_PROGRESS" ? "Plainte prise en compte" : status === "RESOLVED" ? "Plainte marquee resolue" : "Plainte rejetee");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function addExplanation(item: Complaint) {
    setError("");
    setSuccess("");
    const note = (notes[item.id] || "").trim();
    if (!note) {
      setError("Saisis une explication avant de valider.");
      return;
    }
    try {
      await apiFetch(`/complaints/${item.id}/explanation`, { token, method: "POST", body: { message: note } });
      setNotes((p) => ({ ...p, [item.id]: "" }));
      setSuccess("Explication enregistree");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={FileText} title="Gestion des plaintes" />

      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [summary.scope, "Portee"],
            [summary.centerCount, "Centres du perimetre"],
            [summary.ratingAverage ?? "-", "Note moyenne"],
            [summary.satisfactionRate == null ? "-" : `${summary.satisfactionRate}%`, "Taux de satisfaction"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
              <p className="text-xl font-black text-slate-900">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Toutes</option>
          <option value="NEW">Nouvelles</option>
          <option value="IN_PROGRESS">En cours</option>
          <option value="RESOLVED">Resolues</option>
          <option value="REJECTED">Rejetees</option>
        </Select>
        <Button variant="outline" onClick={load}>Actualiser</Button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="flex flex-col gap-3">
        {complaints.length === 0 ? <p className="text-sm text-slate-400">Aucune plainte.</p> : null}
        {paginated.map((item) => (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className={`text-sm font-bold ${item.status === "REJECTED" ? "text-slate-400 line-through" : "text-slate-900"}`}>
              {item.subject}
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              <strong>Centre:</strong> {item.centerName || "Non specifie"} ({item.centerCode || "-"})
            </p>
            <p className="text-xs text-slate-500"><strong>Statut:</strong> {formatComplaintStatus(item.status)}</p>
            <p className="mt-1 text-sm text-slate-700">{item.message}</p>
            <p className="mt-1 text-[11px] text-slate-400">{formatDate(item.createdAt)}</p>

            {canHandle ? (
              <Textarea
                className="mt-2"
                rows={2}
                placeholder={item.status === "NEW" ? "Commentaire pour la prise en charge" : "Commentaire pour la resolution"}
                value={notes[item.id] || ""}
                onChange={(e) => setNotes((p) => ({ ...p, [item.id]: e.target.value }))}
              />
            ) : null}

            {regulator && item.updates && item.updates.length > 0 ? (
              <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                <strong>Justifications :</strong>
                {item.updates.map((u) => (
                  <p key={u.id}>• {formatComplaintStatus(u.status)}: {u.message} ({formatDate(u.createdAt)})</p>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {canHandle ? (
                <Button size="sm" variant="outline" onClick={() => addExplanation(item)}>Ajouter explication</Button>
              ) : null}
              {regulator && item.status === "NEW" ? (
                <Button size="sm" onClick={() => setStatus(item, "IN_PROGRESS")}>Prendre en compte</Button>
              ) : null}
              {regulator && ["NEW", "IN_PROGRESS"].includes(item.status) ? (
                <Button size="sm" variant="danger" onClick={() => setStatus(item, "REJECTED")}>Rejeter</Button>
              ) : null}
              {regulator && item.status === "IN_PROGRESS" ? (
                <Button size="sm" variant="secondary" onClick={() => setStatus(item, "RESOLVED")}>Marquer resolue</Button>
              ) : null}
            </div>
          </div>
        ))}

        {pageCount > 1 ? (
          <div className="flex items-center justify-center gap-3">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Precedent</Button>
            <span className="text-xs text-slate-400">Page {page} / {pageCount}</span>
            <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Suivant</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
