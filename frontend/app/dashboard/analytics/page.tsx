"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BarChart } from "@/components/dashboard/charts/BarChart";
import { DonutChart } from "@/components/dashboard/charts/DonutChart";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Alert } from "@/components/ui/alert";
import { LineChart, Building2, Users, FileText, CheckCircle2 } from "lucide-react";

type Center = { _id: string; approvalStatus: string; level: string; regionCode: string | null };
type Complaint = { status: string };
type UserLite = { role: string };

export default function AnalyticsPage() {
  const { token } = useAuthStore();
  const [centers, setCenters] = useState<Center[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [regions, setRegions] = useState<{ code: string; name: string }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setError("");
      try {
        const [c, comp, u, r] = await Promise.all([
          apiFetch<Center[]>("/centers?includeInactive=1", { token }),
          apiFetch<Complaint[]>("/complaints", { token }).catch(() => []),
          apiFetch<UserLite[]>("/users", { token }).catch(() => []),
          apiFetch<{ code: string; name: string }[]>("/geo/regions", { token }),
        ]);
        setCenters(c); setComplaints(comp); setUsers(u); setRegions(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur");
      }
    }
    load();
  }, [token]);

  const approved = centers.filter((c) => c.approvalStatus === "APPROVED").length;
  const pending = centers.filter((c) => c.approvalStatus === "PENDING").length;
  const rejected = centers.filter((c) => c.approvalStatus === "REJECTED").length;

  const byRegion = useMemo(() => {
    return regions
      .map((r) => ({ label: r.code, count: centers.filter((c) => c.regionCode === r.code).length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [regions, centers]);

  const byLevel = useMemo(() => {
    const counts: Record<string, number> = {};
    centers.forEach((c) => { counts[c.level] = (counts[c.level] || 0) + 1; });
    const palette = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#0ea5e9", "#f472b6", "#94a3b8"];
    return Object.entries(counts).map(([label, count], i) => ({ label, count, color: palette[i % palette.length] }));
  }, [centers]);

  const complaintsByStatus = useMemo(() => {
    const map = { NEW: 0, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 0 } as Record<string, number>;
    complaints.forEach((c) => { map[c.status] = (map[c.status] || 0) + 1; });
    return [
      { label: "Nouvelles", count: map.NEW, color: "#ef4444" },
      { label: "En cours", count: map.IN_PROGRESS, color: "#f59e0b" },
      { label: "Resolues", count: map.RESOLVED, color: "#10b981" },
      { label: "Rejetees", count: map.REJECTED, color: "#94a3b8" },
    ];
  }, [complaints]);

  const usersByRole = useMemo(() => {
    const counts: Record<string, number> = {};
    users.forEach((u) => { counts[u.role] = (counts[u.role] || 0) + 1; });
    return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [users]);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={LineChart} title="Statistiques" subtitle="Vue analytique de la plateforme" />
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Building2} tag="CENTRES" value={centers.length} sub="Total enregistres" accent="blue" />
        <KpiCard icon={CheckCircle2} tag="APPROUVES" value={approved} sub={`${pending} en attente, ${rejected} rejetes`} accent="green" />
        <KpiCard icon={FileText} tag="PLAINTES" value={complaints.length} sub="Toutes periodes" accent="amber" />
        <KpiCard icon={Users} tag="UTILISATEURS" value={users.length} sub="Comptes crees" accent="slate" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Centres par region (top 12)</p>
          <BarChart data={byRegion} color="#3b82f6" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Repartition des plaintes</p>
          <DonutChart centerLabel="plaintes" centerValue={complaints.length} segments={complaintsByStatus} />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Centres par niveau</p>
          <DonutChart centerLabel="centres" centerValue={centers.length} segments={byLevel} />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Utilisateurs par role (top 10)</p>
          <BarChart data={usersByRole} color="#ef4444" />
        </div>
      </div>
    </div>
  );
}
