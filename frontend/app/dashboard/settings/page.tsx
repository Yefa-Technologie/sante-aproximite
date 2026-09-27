"use client";

import { Fragment, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { isRegulator } from "@/lib/roles";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Settings, Search, Trash2, Power, CheckCircle2, XCircle, Pencil, BedDouble, PlusCircle, MinusCircle } from "lucide-react";

type User = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  roles?: string[];
  approvalStatus?: string;
  isActive?: boolean;
  establishmentCode?: string | null;
};
type PendingCenter = { _id: string; name: string; establishmentCode: string | null; address: string };
type ServiceItem = { name: string; description: string | null; bedsAvailable: number; bedsOccupied: number; bedsOutOfService: number };
type CenterAdmin = {
  _id: string;
  name: string;
  address: string;
  establishmentCode: string | null;
  level: string;
  establishmentType: string;
  technicalPlatform: string;
  regionCode: string | null;
  districtCode: string | null;
  location: { coordinates: [number, number] };
  approvalStatus: string;
  isActive?: boolean;
  services: ServiceItem[];
};
type GeoItem = { code: string; name: string; regionCode?: string };

const CENTER_LEVEL_OPTIONS = [
  ["CHU", "CHU"], ["CHR", "CHR"], ["CH", "CH"], ["CHS", "CHS"],
  ["CLINIQUE", "Clinique"], ["POLYCLINIQUE", "Polyclinique"], ["INFIRMERIE", "Infirmerie"],
  ["CLCC", "CLCC"], ["ESPC", "ESPC"],
  ["CENTRE_SANTE", "Centre de sante"], ["SSR", "SSR"], ["EHPAD_USLD", "EHPAD / USLD"],
  ["CENTRE_RADIOTHERAPIE", "Centre de radiotherapie"], ["CENTRE_CARDIOLOGIE", "Centre de cardiologie"],
];
const CENTER_TYPE_OPTIONS = [["CONFESSIONNEL", "Confessionnel"], ["PRIVE", "Prive"], ["PUBLIQUE", "Publique"]];
const CENTERS_PAGE_SIZE = 10;
type ModuleDef = { key: string; label: string };
type RoleDef = { key: string; label: string };
type AppDef = { key: string; label: string };

const ROLE_OPTIONS = ["USER", "NATIONAL", "REGION", "DISTRICT", "ETABLISSEMENT", "SAPEUR_POMPIER", "SAMU", "POLICE", "GENDARMERIE", "PROTECTION_CIVILE", "REGULATOR"];

const SCOPED_ROLES = new Set([
  "NATIONAL", "REGION", "DISTRICT", "REGULATOR",
  "ETABLISSEMENT", "CHEF_ETABLISSEMENT",
  "SAMU", "SAPEUR_POMPIER", "SAPPEUR_POMPIER",
  "POLICE", "GENDARMERIE", "PROTECTION_CIVILE",
]);

const USER_CATEGORY_MENU: { key: string; label: string }[] = [
  { key: "ALL", label: "Tous" },
  { key: "PUBLIC", label: "Comptes publics" },
  { key: "PRO", label: "Comptes professionnels" },
];

function getUserRoles(u: User): string[] {
  return [...new Set([...(u.roles || []), u.role].filter(Boolean).map((r) => r.toUpperCase()))];
}

function isPublicAccount(u: User): boolean {
  const roles = getUserRoles(u);
  return roles.includes("USER") && !roles.some((r) => SCOPED_ROLES.has(r));
}

function matchesUserCategory(u: User, category: string): boolean {
  if (category === "PUBLIC") return isPublicAccount(u);
  if (category === "PRO") return !isPublicAccount(u);
  return true;
}

export default function SettingsPage() {
  const { user, token } = useAuthStore();
  const regulator = isRegulator(user);
  const [tab, setTab] = useState<"users" | "centers" | "pending-centers" | "app">("users");

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={Settings} title="Parametres" />
      <div className="flex flex-wrap gap-2">
        {[
          ["users", "Utilisateurs"],
          ...(regulator ? [["centers", "Centres de sante"]] : []),
          ...(regulator ? [["pending-centers", "Centres en attente"]] : []),
          ["app", "Application & modules"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
              tab === key ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "users" ? <UsersTab token={token} /> : null}
      {tab === "centers" && regulator ? <AllCentersTab token={token} /> : null}
      {tab === "pending-centers" && regulator ? <PendingCentersTab token={token} /> : null}
      {tab === "app" ? <AppTab token={token} /> : null}
    </div>
  );
}

function UsersTab({ token }: { token: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "USER", establishmentCode: "" });
  const [editingId, setEditingId] = useState("");

  async function load() {
    setError("");
    try {
      setUsers(await apiFetch<User[]>("/users", { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = users.filter((u) => {
    if (!matchesUserCategory(u, category)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.fullName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q);
  });

  const categoryCounts = USER_CATEGORY_MENU.reduce<Record<string, number>>((acc, item) => {
    acc[item.key] = users.filter((u) => matchesUserCategory(u, item.key)).length;
    return acc;
  }, {});

  function resetForm() {
    setEditingId("");
    setForm({ fullName: "", email: "", password: "", role: "USER", establishmentCode: "" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    try {
      const payload: Record<string, unknown> = {
        fullName: form.fullName, email: form.email, role: form.role, roles: [form.role],
        establishmentCode: form.establishmentCode || null,
      };
      if (form.password.trim()) payload.password = form.password;
      if (editingId) {
        await apiFetch(`/users/${editingId}`, { token, method: "PATCH", body: payload });
        setSuccess("Utilisateur mis a jour");
      } else {
        await apiFetch("/users", { token, method: "POST", body: payload });
        setSuccess("Utilisateur cree");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  function edit(u: User) {
    setEditingId(u.id);
    setForm({ fullName: u.fullName, email: u.email, password: "", role: u.role, establishmentCode: u.establishmentCode || "" });
  }

  async function reviewChef(id: string, action: "APPROVE" | "REJECT") {
    setError(""); setSuccess("");
    try {
      await apiFetch(`/users/${id}/review`, { token, method: "POST", body: { action } });
      setSuccess(action === "APPROVE" ? "Chef approuve" : "Chef rejete");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur"); }
  }
  async function toggleActive(u: User) {
    setError(""); setSuccess("");
    try {
      await apiFetch(`/users/${u.id}/active`, { token, method: "PATCH", body: { isActive: u.isActive === false } });
      setSuccess(u.isActive === false ? "Utilisateur active" : "Utilisateur desactive");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur"); }
  }
  async function remove(id: string) {
    setError(""); setSuccess("");
    try {
      await apiFetch(`/users/${id}`, { token, method: "DELETE" });
      setSuccess("Utilisateur supprime");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur"); }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <Input required placeholder="Nom complet" value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} />
        <Input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
        <Input type="password" placeholder={editingId ? "Nouveau mot de passe (optionnel)" : "Mot de passe"} required={!editingId} value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
        <Select value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <div className="flex gap-2">
          <Input placeholder="Code etablissement" value={form.establishmentCode} onChange={(e) => setForm((p) => ({ ...p, establishmentCode: e.target.value }))} />
        </div>
        <div className="col-span-full flex gap-2">
          {editingId ? <Button type="button" variant="outline" onClick={resetForm}>Annuler</Button> : null}
          <Button type="submit">{editingId ? "Mettre a jour" : "Creer l'utilisateur"}</Button>
        </div>
      </form>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {USER_CATEGORY_MENU.map((item) => (
          <button
            key={item.key}
            onClick={() => setCategory(item.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
              category === item.key ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
            }`}
          >
            {item.label} ({categoryCounts[item.key] ?? 0})
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-slate-400" />
        <Input className="max-w-xs" placeholder="Rechercher (nom, email, role)" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-bold uppercase text-slate-400">
              <th className="p-3">Nom</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Type</th><th className="p-3">Statut</th><th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-b border-slate-50">
                <td className="p-3 font-semibold text-slate-800">{u.fullName}</td>
                <td className="p-3 text-slate-500">{u.email}</td>
                <td className="p-3"><Badge>{u.role}</Badge></td>
                <td className="p-3">
                  {isPublicAccount(u) ? <Badge variant="slate">Public</Badge> : <Badge variant="blue">Professionnel</Badge>}
                </td>
                <td className="p-3">
                  {u.approvalStatus === "PENDING" ? <Badge variant="amber">En attente</Badge> : u.isActive === false ? <Badge variant="red">Desactive</Badge> : <Badge variant="green">Actif</Badge>}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {u.approvalStatus === "PENDING" ? (
                      <>
                        <Button size="sm" onClick={() => reviewChef(u.id, "APPROVE")}><CheckCircle2 className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="danger" onClick={() => reviewChef(u.id, "REJECT")}><XCircle className="h-3.5 w-3.5" /></Button>
                      </>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => edit(u)}>Modifier</Button>
                    <Button size="sm" variant="outline" onClick={() => toggleActive(u)}><Power className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="danger" onClick={() => remove(u.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const emptyCenterForm = {
  name: "", address: "", establishmentCode: "", level: "CENTRE_SANTE", establishmentType: "PUBLIQUE",
  regionCode: "", districtCode: "", technicalPlatform: "", latitude: "", longitude: "",
};

function AllCentersTab({ token }: { token: string }) {
  const [centers, setCenters] = useState<CenterAdmin[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [regions, setRegions] = useState<GeoItem[]>([]);
  const [districts, setDistricts] = useState<GeoItem[]>([]);
  const [expandedId, setExpandedId] = useState("");
  const [expandedMode, setExpandedMode] = useState<"edit" | "beds">("edit");
  const [form, setForm] = useState(emptyCenterForm);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingServiceName, setEditingServiceName] = useState("");
  const [serviceDraft, setServiceDraft] = useState({ name: "", description: "", bedsAvailable: "0" });
  const [serviceActionName, setServiceActionName] = useState("");

  async function load() {
    setError("");
    try {
      setCenters(await apiFetch<CenterAdmin[]>("/centers?includeInactive=1", { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }
  useEffect(() => {
    load();
    apiFetch<GeoItem[]>("/geo/regions", { token }).then(setRegions).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!form.regionCode) {
      setDistricts([]);
      return;
    }
    apiFetch<GeoItem[]>(`/geo/districts?regionCode=${encodeURIComponent(form.regionCode)}`, { token })
      .then(setDistricts)
      .catch(() => {});
  }, [form.regionCode, token]);

  const filtered = centers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name?.toLowerCase().includes(q) ||
      c.establishmentCode?.toLowerCase().includes(q) ||
      c.address?.toLowerCase().includes(q) ||
      c.regionCode?.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    setPage(1);
  }, [search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / CENTERS_PAGE_SIZE));
  const paged = filtered.slice((page - 1) * CENTERS_PAGE_SIZE, page * CENTERS_PAGE_SIZE);

  async function toggleActive(c: CenterAdmin) {
    setError(""); setSuccess("");
    setActionLoadingId(c._id);
    try {
      await apiFetch(`/centers/${c._id}/active`, { token, method: "PATCH", body: { isActive: c.isActive === false } });
      setSuccess(c.isActive === false ? "Centre active" : "Centre desactive");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setActionLoadingId("");
    }
  }

  async function remove(c: CenterAdmin) {
    if (!window.confirm(`Supprimer le centre "${c.name}" ?`)) return;
    setError(""); setSuccess("");
    setActionLoadingId(c._id);
    try {
      await apiFetch(`/centers/${c._id}`, { token, method: "DELETE" });
      setSuccess("Centre supprime");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setActionLoadingId("");
    }
  }

  function openEdit(c: CenterAdmin) {
    setExpandedId(c._id === expandedId && expandedMode === "edit" ? "" : c._id);
    setExpandedMode("edit");
    setForm({
      name: c.name || "",
      address: c.address || "",
      establishmentCode: c.establishmentCode || "",
      level: c.level || "CENTRE_SANTE",
      establishmentType: c.establishmentType || "PUBLIQUE",
      regionCode: c.regionCode || "",
      districtCode: c.districtCode || "",
      technicalPlatform: c.technicalPlatform || "",
      latitude: String(c.location?.coordinates?.[1] ?? ""),
      longitude: String(c.location?.coordinates?.[0] ?? ""),
    });
    setServices(c.services || []);
  }

  function openBeds(c: CenterAdmin) {
    setExpandedId(c._id === expandedId && expandedMode === "beds" ? "" : c._id);
    setExpandedMode("beds");
    setServices(c.services || []);
    setEditingServiceName("");
  }

  function setField<K extends keyof typeof form>(key: K, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function addServiceRow() {
    setServices((p) => [...p, { name: "", description: "", bedsAvailable: 0, bedsOccupied: 0, bedsOutOfService: 0 }]);
  }
  function removeServiceRow(index: number) {
    setServices((p) => p.filter((_, i) => i !== index));
  }
  function updateServiceRow(index: number, patch: Partial<ServiceItem>) {
    setServices((p) => p.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function submitEdit(e: React.FormEvent, centerId: string) {
    e.preventDefault();
    setError(""); setSuccess("");
    setSaving(true);
    try {
      const body = {
        name: form.name,
        address: form.address,
        establishmentCode: form.establishmentCode || null,
        level: form.level,
        establishmentType: form.establishmentType,
        regionCode: form.regionCode.toUpperCase(),
        districtCode: form.districtCode.toUpperCase() || null,
        technicalPlatform: form.technicalPlatform,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        services: services.map((s) => ({
          name: s.name, description: s.description, bedsAvailable: s.bedsAvailable,
          bedsOccupied: s.bedsOccupied, bedsOutOfService: s.bedsOutOfService,
        })),
      };
      await apiFetch(`/centers/${centerId}/admin`, { token, method: "PUT", body });
      setSuccess("Centre mis a jour");
      setExpandedId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function adjustBeds(centerId: string, serviceName: string, adjust: "occupy" | "free") {
    setError("");
    setServiceActionName(serviceName);
    try {
      await apiFetch(`/centers/${centerId}/services/${encodeURIComponent(serviceName)}`, {
        token, method: "PATCH", body: { adjust },
      });
      await load();
      const refreshed = (await apiFetch<CenterAdmin[]>("/centers?includeInactive=1", { token })).find((c) => c._id === centerId);
      if (refreshed) setServices(refreshed.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setServiceActionName("");
    }
  }

  function startEditService(service: ServiceItem) {
    setEditingServiceName(service.name);
    setServiceDraft({ name: service.name, description: service.description || "", bedsAvailable: String(service.bedsAvailable) });
  }

  async function saveServiceEdit(centerId: string) {
    setError("");
    setServiceActionName(editingServiceName);
    try {
      await apiFetch(`/centers/${centerId}/services/${encodeURIComponent(editingServiceName)}`, {
        token, method: "PATCH",
        body: { name: serviceDraft.name.trim(), description: serviceDraft.description.trim(), bedsAvailable: Number(serviceDraft.bedsAvailable) || 0 },
      });
      setEditingServiceName("");
      await load();
      const refreshed = (await apiFetch<CenterAdmin[]>("/centers?includeInactive=1", { token })).find((c) => c._id === centerId);
      if (refreshed) setServices(refreshed.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setServiceActionName("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-slate-400" />
        <Input className="max-w-xs" placeholder="Rechercher (nom, code, adresse, region)" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-slate-400">{filtered.length} centre(s)</span>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-bold uppercase text-slate-400">
              <th className="p-3">Nom</th><th className="p-3">Code</th><th className="p-3">Region</th><th className="p-3">Statut</th><th className="p-3">Actif</th><th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((c) => (
              <Fragment key={c._id}>
                <tr className="border-b border-slate-50">
                  <td className="p-3">
                    <p className="font-semibold text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.address}</p>
                  </td>
                  <td className="p-3 text-slate-500">{c.establishmentCode || "-"}</td>
                  <td className="p-3 text-slate-500">{c.regionCode || "-"}</td>
                  <td className="p-3">
                    {c.approvalStatus === "APPROVED" ? <Badge variant="green">Approuve</Badge> : c.approvalStatus === "PENDING" ? <Badge variant="amber">En attente</Badge> : <Badge variant="red">Rejete</Badge>}
                  </td>
                  <td className="p-3">{c.isActive === false ? <Badge variant="red">Inactif</Badge> : <Badge variant="green">Actif</Badge>}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" /> Modifier
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openBeds(c)}>
                        <BedDouble className="h-3.5 w-3.5" /> Lits
                      </Button>
                      <Button size="sm" variant="outline" disabled={actionLoadingId === c._id} onClick={() => toggleActive(c)}>
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="danger" disabled={actionLoadingId === c._id} onClick={() => remove(c)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
                {expandedId === c._id && expandedMode === "edit" ? (
                  <tr key={`${c._id}-edit`} className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={6} className="p-4">
                      <form onSubmit={(e) => submitEdit(e, c._id)} className="flex flex-col gap-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <div className="flex flex-col gap-1.5">
                            <Label>Nom</Label>
                            <Input required value={form.name} onChange={(e) => setField("name", e.target.value)} />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Adresse</Label>
                            <Input required value={form.address} onChange={(e) => setField("address", e.target.value)} />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Code etablissement</Label>
                            <Input value={form.establishmentCode} onChange={(e) => setField("establishmentCode", e.target.value)} />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Region</Label>
                            <Select required value={form.regionCode} onChange={(e) => { setField("regionCode", e.target.value); setField("districtCode", ""); }}>
                              <option value="">- Selectionner -</option>
                              {regions.map((r) => <option key={r.code} value={r.code}>{r.code} - {r.name}</option>)}
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>District</Label>
                            <Select value={form.districtCode} onChange={(e) => setField("districtCode", e.target.value)}>
                              <option value="">- Optionnel -</option>
                              {districts.map((d) => <option key={d.code} value={d.code}>{d.code} - {d.name}</option>)}
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Niveau</Label>
                            <Select required value={form.level} onChange={(e) => setField("level", e.target.value)}>
                              {CENTER_LEVEL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Type</Label>
                            <Select required value={form.establishmentType} onChange={(e) => setField("establishmentType", e.target.value)}>
                              {CENTER_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Latitude</Label>
                            <Input required type="number" step="any" value={form.latitude} onChange={(e) => setField("latitude", e.target.value)} />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Longitude</Label>
                            <Input required type="number" step="any" value={form.longitude} onChange={(e) => setField("longitude", e.target.value)} />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Plateau technique</Label>
                          <Textarea required value={form.technicalPlatform} onChange={(e) => setField("technicalPlatform", e.target.value)} />
                        </div>

                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-600">Services</span>
                            <Button type="button" size="sm" variant="outline" onClick={addServiceRow}>Ajouter un service</Button>
                          </div>
                          {services.map((service, index) => (
                            <div key={index} className="grid grid-cols-1 gap-2 rounded-xl bg-white p-3 sm:grid-cols-2">
                              <Input placeholder="Nom du service" value={service.name} onChange={(e) => updateServiceRow(index, { name: e.target.value })} />
                              <Input placeholder="Description" value={service.description || ""} onChange={(e) => updateServiceRow(index, { description: e.target.value })} />
                              <div className="flex items-center gap-2 text-xs">
                                <Label className="w-28">Lits dispo.</Label>
                                <Input type="number" min={0} value={service.bedsAvailable} onChange={(e) => updateServiceRow(index, { bedsAvailable: Number(e.target.value) })} />
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <Label className="w-28">Lits occupes</Label>
                                <Input type="number" min={0} value={service.bedsOccupied} onChange={(e) => updateServiceRow(index, { bedsOccupied: Number(e.target.value) })} />
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <Label className="w-28">Hors service</Label>
                                <Input type="number" min={0} value={service.bedsOutOfService} onChange={(e) => updateServiceRow(index, { bedsOutOfService: Number(e.target.value) })} />
                              </div>
                              <Button type="button" size="sm" variant="danger" className="justify-self-start" onClick={() => removeServiceRow(index)}>
                                <Trash2 className="h-3.5 w-3.5" /> Retirer
                              </Button>
                            </div>
                          ))}
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => setExpandedId("")}>Annuler</Button>
                          <Button type="submit" disabled={saving}>{saving ? "Enregistrement..." : "Enregistrer"}</Button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : null}
                {expandedId === c._id && expandedMode === "beds" ? (
                  <tr key={`${c._id}-beds`} className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={6} className="p-4">
                      <div className="flex flex-col gap-3">
                        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-400">Places disponibles</h4>
                        {services.length === 0 ? <p className="text-sm text-slate-400">Aucun service enregistre.</p> : null}
                        {services.map((service) => (
                          <div key={service.name} className="rounded-xl border border-slate-200 bg-white p-4">
                            {editingServiceName === service.name ? (
                              <div className="flex flex-col gap-2">
                                <Input value={serviceDraft.name} onChange={(e) => setServiceDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Nom du service" />
                                <Input value={serviceDraft.description} onChange={(e) => setServiceDraft((p) => ({ ...p, description: e.target.value }))} placeholder="Description" />
                                <Input type="number" value={serviceDraft.bedsAvailable} onChange={(e) => setServiceDraft((p) => ({ ...p, bedsAvailable: e.target.value }))} placeholder="Places disponibles" />
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline" onClick={() => setEditingServiceName("")}>Annuler</Button>
                                  <Button size="sm" onClick={() => saveServiceEdit(c._id)} disabled={serviceActionName === service.name}>
                                    {serviceActionName === service.name ? "..." : "Enregistrer"}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-bold text-slate-800">{service.name}</span>
                                  <Badge variant={service.bedsAvailable > 0 ? "green" : "red"}>
                                    {service.bedsAvailable > 0 ? `${service.bedsAvailable} place(s)` : "Complet"}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  Occupees: {service.bedsOccupied} · Hors service: {service.bedsOutOfService}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Button size="sm" variant="outline" disabled={serviceActionName === service.name || service.bedsAvailable <= 0} onClick={() => adjustBeds(c._id, service.name, "occupy")}>
                                    <MinusCircle className="h-3.5 w-3.5" /> Occuper une place
                                  </Button>
                                  <Button size="sm" variant="outline" disabled={serviceActionName === service.name || service.bedsOccupied <= 0} onClick={() => adjustBeds(c._id, service.name, "free")}>
                                    <PlusCircle className="h-3.5 w-3.5" /> Liberer une place
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => startEditService(service)}>
                                    <BedDouble className="h-3.5 w-3.5" /> Modifier
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                        <div className="flex justify-end">
                          <Button type="button" variant="outline" onClick={() => setExpandedId("")}>Fermer</Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-sm text-slate-400">Aucun centre trouve.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Precedent</Button>
          <span className="text-xs text-slate-500">Page {page} / {pageCount}</span>
          <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Suivant</Button>
        </div>
      ) : null}
    </div>
  );
}

function PendingCentersTab({ token }: { token: string }) {
  const [centers, setCenters] = useState<PendingCenter[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setError("");
    try {
      setCenters(await apiFetch<PendingCenter[]>("/centers/pending", { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function review(id: string, action: "APPROVE" | "REJECT") {
    setError(""); setSuccess("");
    try {
      await apiFetch(`/centers/${id}/review`, { token, method: "POST", body: { action } });
      setSuccess(action === "APPROVE" ? "Centre approuve" : "Centre rejete");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur"); }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}
      {centers.length === 0 ? <p className="text-sm text-slate-400">Aucun centre en attente.</p> : null}
      {centers.map((c) => (
        <div key={c._id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <p className="text-sm font-bold text-slate-900">{c.name}</p>
            <p className="text-xs text-slate-500">{c.establishmentCode || "-"} · {c.address}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => review(c._id, "APPROVE")}>Approuver</Button>
            <Button size="sm" variant="danger" onClick={() => review(c._id, "REJECT")}>Rejeter</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AppTab({ token }: { token: string }) {
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [apps, setApps] = useState<AppDef[]>([{ key: "mobile", label: "Mobile" }, { key: "mobile-minima", label: "Mobile Minima" }]);
  const [appKey, setAppKey] = useState("mobile");
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [error, setError] = useState("");

  async function loadAppSettings() {
    try {
      const data = await apiFetch<{ centerReviewsEnabled: boolean }>("/settings", { token });
      setReviewsEnabled(!!data.centerReviewsEnabled);
    } catch {
      // ignore
    }
  }
  async function loadModules(app = appKey) {
    setError("");
    try {
      const data = await apiFetch<{ modules: ModuleDef[]; roles: RoleDef[]; apps: AppDef[]; appKey: string; matrix: Record<string, Record<string, boolean>> }>(
        `/settings/modules?appKey=${app}`, { token }
      );
      setModules(data.modules || []);
      setRoles(data.roles || []);
      if (data.apps?.length) setApps(data.apps);
      setAppKey(data.appKey || app);
      setMatrix(data.matrix || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  useEffect(() => {
    loadAppSettings();
    loadModules("mobile");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggleReviews(checked: boolean) {
    const previous = reviewsEnabled;
    setReviewsEnabled(checked);
    setError("");
    try {
      await apiFetch("/settings/centerReviewsEnabled", { token, method: "PATCH", body: { value: checked } });
    } catch (err) {
      setReviewsEnabled(previous);
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function toggleModule(moduleKey: string, roleKey: string, checked: boolean) {
    const previous = matrix[moduleKey]?.[roleKey];
    setMatrix((p) => ({ ...p, [moduleKey]: { ...p[moduleKey], [roleKey]: checked } }));
    setError("");
    try {
      await apiFetch("/settings/modules", { token, method: "PATCH", body: { moduleKey, role: roleKey, enabled: checked, appKey } });
    } catch (err) {
      setMatrix((p) => ({ ...p, [moduleKey]: { ...p[moduleKey], [roleKey]: previous !== false } }));
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-sm font-bold text-slate-800">Notation, satisfaction et &quot;J&apos;ai visite ce centre&quot;</p>
          <p className="text-xs text-slate-500">Controle ces fonctionnalites sur l&apos;app mobile a distance.</p>
        </div>
        <label className="relative inline-flex h-6 w-11 cursor-pointer items-center">
          <input type="checkbox" className="peer sr-only" checked={reviewsEnabled} onChange={(e) => toggleReviews(e.target.checked)} />
          <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-600" />
          <span className="absolute left-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
        </label>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Modules actifs par role</h3>
        <div className="mb-3 flex gap-2">
          {apps.map((a) => (
            <button
              key={a.key}
              onClick={() => loadModules(a.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                appKey === a.key ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left font-bold uppercase text-slate-400">
                <th className="p-2.5">Module</th>
                {roles.map((r) => <th key={r.key} className="p-2.5 text-center">{r.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.key} className="border-b border-slate-50">
                  <td className="p-2.5 font-semibold text-slate-700">{m.label}</td>
                  {roles.map((r) => (
                    <td key={r.key} className="p-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={matrix[m.key]?.[r.key] !== false}
                        onChange={(e) => toggleModule(m.key, r.key, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
