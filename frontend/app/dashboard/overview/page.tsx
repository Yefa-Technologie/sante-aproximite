"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { hasRole, isRegulator, isEmergencyResponder, isChef } from "@/lib/roles";
import { EmergencyResponderOverview } from "@/components/dashboard/EmergencyResponderOverview";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BarChart } from "@/components/dashboard/charts/BarChart";
import { DonutChart } from "@/components/dashboard/charts/DonutChart";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Clock3, Hourglass, CheckCircle2, Siren, ClipboardList, Landmark } from "lucide-react";

type Center = { _id: string; approvalStatus: string; createdAt: string };
type Complaint = { id: string; status: string };

const MONTHS = ["Jan", "Fev", "Mar", "Avr", "Mai", "Juin", "Juil", "Aou", "Sep", "Oct", "Nov", "Dec"];

export default function OverviewPage() {
  const { user } = useAuthStore();

  if (hasRole(user, "SAMU")) {
    return (
      <EmergencyResponderOverview
        badge="🚑 SAMU"
        title="Centre de Regulation Medicale"
        subtitle="Service d'Aide Medicale Urgente - Tableau de bord operationnel"
        bannerText={(count) => `${count} alerte(s) medicale(s) en attente de prise en charge !`}
        bannerCta="Traiter maintenant →"
        nonTraiteTag="NON TRAITEES"
      />
    );
  }
  if (hasRole(user, "SAPEUR_POMPIER")) {
    return (
      <EmergencyResponderOverview
        badge="🚒 SAPEURS-POMPIERS"
        title="Centre Operationnel de Secours"
        subtitle="Service Departemental d'Incendie et de Secours - Tableau de bord operationnel"
        bannerText={(count) => `${count} intervention(s) en attente de declenchement !`}
        bannerCta="Declencher →"
        nonTraiteTag="NON DECLENCHEES"
      />
    );
  }

  return <GenericOverview />;
}

function GenericOverview() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const regulator = isRegulator(user);
  const emergencyResponder = isEmergencyResponder(user);
  const chef = isChef(user);

  const [centers, setCenters] = useState<Center[]>([]);
  const [pendingCenters, setPendingCenters] = useState<Center[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [usersCount, setUsersCount] = useState(0);
  const [regionsCount, setRegionsCount] = useState(0);
  const [districtsCount, setDistrictsCount] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setError("");
      try {
        const centersEndpoint = regulator ? "/centers?includeInactive=1" : "/centers";
        const results = await Promise.allSettled([
          apiFetch<Center[]>(centersEndpoint, { token }),
          regulator ? apiFetch<Center[]>("/centers/pending", { token }) : Promise.resolve([]),
          !chef ? apiFetch<Complaint[]>("/complaints", { token }) : Promise.resolve([]),
          regulator ? apiFetch<{ length: number }[]>("/users", { token }) : Promise.resolve([]),
          apiFetch<{ code: string }[]>("/geo/regions", { token }),
          apiFetch<{ code: string }[]>("/geo/districts", { token }),
        ]);
        if (results[0].status === "fulfilled") setCenters(results[0].value);
        if (results[1].status === "fulfilled") setPendingCenters(results[1].value as Center[]);
        if (results[2].status === "fulfilled") setComplaints(results[2].value as Complaint[]);
        if (results[3].status === "fulfilled") setUsersCount((results[3].value as unknown[]).length);
        if (results[4].status === "fulfilled") setRegionsCount((results[4].value as unknown[]).length);
        if (results[5].status === "fulfilled") setDistrictsCount((results[5].value as unknown[]).length);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur");
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, regulator, chef]);

  const approvedCount = useMemo(
    () => centers.filter((c) => String(c.approvalStatus).toUpperCase() === "APPROVED").length,
    [centers]
  );
  const approvalRate = centers.length > 0 ? Math.round((approvedCount * 100) / centers.length) : 0;
  const newComplaintsCount = complaints.filter((c) => c.status === "NEW").length;

  const centersByMonth = useMemo(() => {
    const year = new Date().getFullYear();
    const counts = Array(12).fill(0);
    centers.forEach((c) => {
      if (!c.createdAt) return;
      const d = new Date(c.createdAt);
      if (d.getFullYear() === year) counts[d.getMonth()]++;
    });
    return counts.map((count, i) => ({ label: MONTHS[i], count }));
  }, [centers]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Tableau de bord</h1>
          <p className="text-sm text-slate-500">
            {new Date().getFullYear()} - Vue globale - Donnees en temps reel
          </p>
        </div>
        {centers.length > 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-center">
            <p className="text-lg font-black text-emerald-600">{approvalRate}%</p>
            <p className="text-[10px] text-slate-500">Taux validation</p>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Hourglass}
          tag="EN ATTENTE"
          value={pendingCenters.length}
          sub={pendingCenters.length === 0 ? "Aucun centre en attente" : "Centre(s) a valider"}
          accent="blue"
        />
        <KpiCard
          icon={CheckCircle2}
          tag="APPROUVES"
          value={approvedCount}
          sub="Centres actifs valides"
          detail={`Taux de validation ${approvalRate}%`}
          accent="green"
        />
        {emergencyResponder ? (
          <KpiCard
            icon={Siren}
            tag="ALERTES"
            value="—"
            sub="Voir l'onglet urgences"
            accent="red"
            onClick={() => router.push("/dashboard/emergency-alerts")}
          />
        ) : (
          <KpiCard
            icon={Landmark}
            tag="REFERENTIEL"
            value={regionsCount}
            sub="Regions actives"
            detail={`Districts : ${districtsCount || "-"}`}
            accent="slate"
          />
        )}
        <KpiCard
          icon={ClipboardList}
          tag="PLAINTES"
          value={newComplaintsCount}
          sub="Nouvelles plaintes recues"
          detail={regulator ? `${usersCount} utilisateurs` : `Total : ${complaints.length}`}
          accent="amber"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-blue-950 px-6 py-4 text-white">
        <p className="text-sm font-semibold text-blue-200">
          <Clock3 className="mr-1.5 inline h-4 w-4" />
          {new Date().getFullYear()} - Vue globale
        </p>
        <div className="flex flex-wrap gap-8">
          {[
            { label: "Total centres", value: centers.length },
            { label: "Approuves", value: approvedCount },
            { label: "En attente", value: pendingCenters.length },
            { label: "Taux validation", value: `${approvalRate}%`, accent: "text-emerald-400" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center">
              <span className={`text-lg font-black ${s.accent || "text-white"}`}>{s.value}</span>
              <span className="text-[11px] text-blue-200">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              Centres enregistres par mois - {new Date().getFullYear()}
            </p>
            <span className="rounded-full bg-blue-50 px-3 py-0.5 text-xs font-bold text-blue-600">
              Total : {centers.length}
            </span>
          </div>
          <BarChart data={centersByMonth} color="#3b82f6" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Repartition par statut</p>
          <DonutChart
            centerLabel="centres"
            centerValue={centers.length}
            segments={[
              { label: "Approuves", count: approvedCount, color: "#10b981" },
              { label: "En attente", count: pendingCenters.length, color: "#f59e0b" },
              {
                label: "Autres",
                count: Math.max(centers.length - approvedCount - pendingCenters.length, 0),
                color: "#94a3b8",
              },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => router.push("/dashboard/nearby")}>Centres proches</Button>
        {emergencyResponder ? (
          <Button variant="outline" onClick={() => router.push("/dashboard/emergency-alerts")}>
            Alertes d&apos;urgence
          </Button>
        ) : null}
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
    </div>
  );
}
