"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { isRegulator } from "@/lib/roles";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Star } from "lucide-react";

type Center = {
  _id: string;
  name: string;
  establishmentCode: string | null;
  address: string;
  ratingAverage: number | null;
  ratingCount: number;
  satisfactionRate: number | null;
};
type Summary = {
  scope: string;
  centerCount: number;
  ratingAverage: number | null;
  satisfactionRate: number | null;
  centersWithoutEvaluation?: number;
};

const PAGE_SIZE = 5;

export default function EvaluationsPage() {
  const { user, token } = useAuthStore();
  const regulator = isRegulator(user);
  const [centers, setCenters] = useState<Center[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const endpoint = regulator ? "/centers?includeInactive=1" : "/centers";
      setCenters(await apiFetch<Center[]>(endpoint, { token }));
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
  }, [token, regulator]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...centers].sort((a, b) => (b.ratingAverage ?? -1) - (a.ratingAverage ?? -1));
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.establishmentCode?.toLowerCase().includes(q) ||
        c.address?.toLowerCase().includes(q)
    );
  }, [centers, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);
  const topRated = useMemo(() => filtered.filter((c) => c.ratingAverage != null).slice(0, 5), [filtered]);

  const coverage = useMemo(() => {
    const total = Number(summary?.centerCount || filtered.length || 0);
    const without = Number(summary?.centersWithoutEvaluation || 0);
    const withEval = Math.max(total - without, 0);
    const percent = total > 0 ? Math.round((withEval * 100) / total) : 0;
    return { total, withEval, without, percent };
  }, [summary, filtered]);

  const satisfaction = useMemo(() => {
    const rate = summary?.satisfactionRate == null ? 0 : Math.max(0, Math.min(100, Number(summary.satisfactionRate)));
    return { satisfied: Math.round(rate), unsatisfied: Math.round(100 - rate) };
  }, [summary]);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={Star} title="Evaluations des centres" />

      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Rechercher un centre (nom, code, ville)" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="outline" onClick={load}>Actualiser</Button>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            [summary.scope, "Portee"],
            [summary.centerCount, "Centres du perimetre"],
            [summary.ratingAverage ?? "-", "Note moyenne globale"],
            [summary.satisfactionRate == null ? "-" : `${summary.satisfactionRate}%`, "Satisfaction globale"],
            [summary.centersWithoutEvaluation ?? 0, "Centres sans evaluation"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
              <p className="text-lg font-black text-slate-900">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      ) : null}

      {summary ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Couverture des evaluations</h3>
            <div className="flex items-center gap-4">
              <div
                className="h-24 w-24 shrink-0 rounded-full"
                style={{
                  background: `conic-gradient(#1a56db ${coverage.percent}%, #f1f5f9 0)`,
                }}
              />
              <div>
                <p className="text-lg font-black text-slate-900">{coverage.percent}% de centres evalues</p>
                <p className="text-xs text-slate-500">{coverage.withEval} / {coverage.total} centres</p>
                <p className="text-xs text-slate-500">{coverage.without} centres sans evaluation</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Satisfaction globale</h3>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-emerald-500" style={{ width: `${satisfaction.satisfied}%` }} />
              <div className="bg-red-400" style={{ width: `${satisfaction.unsatisfied}%` }} />
            </div>
            <div className="mt-3 flex gap-3 text-xs">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">Satisfaits: {satisfaction.satisfied}%</span>
              <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-600">Insatisfaits: {satisfaction.unsatisfied}%</span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Top 5 centres (notation)</h3>
            <div className="flex flex-col gap-2">
              {topRated.length === 0 ? <p className="text-xs text-slate-400">Pas assez de donnees.</p> : null}
              {topRated.map((c) => (
                <div key={c._id} className="flex items-center gap-2 text-xs">
                  <span className="w-20 truncate text-slate-600">{c.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, (c.ratingAverage || 0) * 20))}%` }} />
                  </div>
                  <span className="w-6 text-right font-bold text-slate-900">{c.ratingAverage ?? "-"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered.length === 0 ? <p className="text-sm text-slate-400">Aucune evaluation a afficher.</p> : null}
        {paginated.map((c) => (
          <div key={c._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900">{c.name}</h4>
            <p className="text-xs text-slate-500"><strong>Code:</strong> {c.establishmentCode || "-"}</p>
            <p className="text-xs text-slate-500"><strong>Adresse:</strong> {c.address || "-"}</p>
            <p className="text-xs text-slate-500"><strong>Note moyenne:</strong> {c.ratingAverage ?? "-"}</p>
            <p className="text-xs text-slate-500"><strong>Satisfaction:</strong> {c.satisfactionRate == null ? "-" : `${c.satisfactionRate}%`}</p>
            <p className="text-xs text-slate-500"><strong>Evaluations:</strong> {c.ratingCount || 0}</p>
          </div>
        ))}
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Precedent</Button>
          <span className="text-xs text-slate-400">Page {page} / {pageCount}</span>
          <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Suivant</Button>
        </div>
      ) : null}
    </div>
  );
}
