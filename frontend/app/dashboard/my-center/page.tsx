"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Hospital, Plus, Trash2, BedDouble, PlusCircle, MinusCircle, Pencil } from "lucide-react";

type Service = {
  name: string;
  description: string | null;
  bedsAvailable: number;
  bedsOccupied: number;
  bedsOutOfService: number;
};

type Center = {
  _id: string;
  name: string;
  address: string;
  establishmentCode: string | null;
  level: string;
  establishmentType: string;
  technicalPlatform: string;
  regionCode: string | null;
  districtCode: string | null;
  approvalStatus: string;
  location: { coordinates: [number, number] };
  services: Service[];
};

type GeoItem = { code: string; name: string; regionCode?: string };

const LEVEL_OPTIONS = [
  ["CHU", "CHU"], ["CHR", "CHR"], ["CH", "CH"], ["CHS", "CHS"],
  ["CLINIQUE", "Clinique"], ["POLYCLINIQUE", "Polyclinique"], ["INFIRMERIE", "Infirmerie"],
  ["CLCC", "CLCC"], ["ESPC", "ESPC"],
  ["CENTRE_SANTE", "Centre de sante"], ["SSR", "SSR"], ["EHPAD_USLD", "EHPAD / USLD"],
  ["CENTRE_RADIOTHERAPIE", "Centre de radiotherapie"], ["CENTRE_CARDIOLOGIE", "Centre de cardiologie"],
];
const TYPE_OPTIONS = [
  ["CONFESSIONNEL", "Confessionnel"], ["PRIVE", "Prive"], ["PUBLIQUE", "Publique"],
];
const APPROVAL_CFG: Record<string, { label: string; variant: "green" | "amber" | "red" | "slate" }> = {
  APPROVED: { label: "Approuve", variant: "green" },
  PENDING: { label: "En attente", variant: "amber" },
  REJECTED: { label: "Rejete", variant: "red" },
};

const emptyForm = {
  name: "", address: "", establishmentCode: "", level: "CENTRE_SANTE", establishmentType: "PUBLIQUE",
  regionCode: "", districtCode: "", technicalPlatform: "", latitude: "", longitude: "",
};

export default function MyCenterPage() {
  const { token } = useAuthStore();
  const [center, setCenter] = useState<Center | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [regions, setRegions] = useState<GeoItem[]>([]);
  const [districts, setDistricts] = useState<GeoItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [services, setServices] = useState<Service[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [skipCodeClaim, setSkipCodeClaim] = useState(false);
  const [claimCode, setClaimCode] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimNotFound, setClaimNotFound] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingServiceName, setEditingServiceName] = useState("");
  const [serviceDraft, setServiceDraft] = useState({ name: "", description: "", bedsAvailable: "0" });
  const [serviceActionName, setServiceActionName] = useState("");
  const [serviceError, setServiceError] = useState("");

  async function loadCenter() {
    try {
      const data = await apiFetch<Center[]>("/centers", { token });
      const found = data[0] || null;
      setCenter(found);
      if (found) {
        setForm({
          name: found.name || "",
          address: found.address || "",
          establishmentCode: found.establishmentCode || "",
          level: found.level || "CENTRE_SANTE",
          establishmentType: found.establishmentType || "PUBLIQUE",
          regionCode: found.regionCode || "",
          districtCode: found.districtCode || "",
          technicalPlatform: found.technicalPlatform || "",
          latitude: String(found.location?.coordinates?.[1] ?? ""),
          longitude: String(found.location?.coordinates?.[0] ?? ""),
        });
        setServices(found.services || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    loadCenter();
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

  function setField<K extends keyof typeof form>(key: K, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function claimByCode() {
    if (!claimCode.trim()) {
      setClaimError("Entrez le code de votre etablissement");
      return;
    }
    setClaimLoading(true);
    setClaimError("");
    setClaimNotFound(false);
    try {
      await apiFetch("/centers/claim-by-code", { token, method: "POST", body: { code: claimCode.trim() } });
      await loadCenter();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setClaimNotFound(true);
      else setClaimError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setClaimLoading(false);
    }
  }

  function createWithClaimCode() {
    setField("establishmentCode", claimCode.trim());
    setSkipCodeClaim(true);
  }

  async function getCurrentPosition() {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject)
      );
      setField("latitude", String(pos.coords.latitude));
      setField("longitude", String(pos.coords.longitude));
    } catch {
      setError("Impossible de recuperer votre position");
    }
  }

  async function submitCenter(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
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
      if (center) {
        await apiFetch(`/centers/${center._id}`, { token, method: "PUT", body });
        setSuccess("Centre mis a jour");
      } else {
        await apiFetch("/centers", { token, method: "POST", body });
        setSuccess("Centre cree et envoye en validation");
      }
      await loadCenter();
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  function addServiceRow() {
    setServices((p) => [...p, { name: "", description: "", bedsAvailable: 0, bedsOccupied: 0, bedsOutOfService: 0 }]);
  }
  function removeServiceRow(index: number) {
    setServices((p) => p.filter((_, i) => i !== index));
  }
  function updateServiceRow(index: number, patch: Partial<Service>) {
    setServices((p) => p.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function adjustBeds(serviceName: string, adjust: "occupy" | "free") {
    if (!center) return;
    setServiceError("");
    setServiceActionName(serviceName);
    try {
      await apiFetch(`/centers/${center._id}/services/${encodeURIComponent(serviceName)}`, {
        token, method: "PATCH", body: { adjust },
      });
      await loadCenter();
    } catch (err) {
      setServiceError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setServiceActionName("");
    }
  }

  function startEditService(service: Service) {
    setEditingServiceName(service.name);
    setServiceDraft({ name: service.name, description: service.description || "", bedsAvailable: String(service.bedsAvailable) });
    setServiceError("");
  }

  async function saveServiceEdit() {
    if (!center) return;
    setServiceActionName(editingServiceName);
    setServiceError("");
    try {
      await apiFetch(`/centers/${center._id}/services/${encodeURIComponent(editingServiceName)}`, {
        token, method: "PATCH",
        body: { name: serviceDraft.name.trim(), description: serviceDraft.description.trim(), bedsAvailable: Number(serviceDraft.bedsAvailable) || 0 },
      });
      setEditingServiceName("");
      await loadCenter();
    } catch (err) {
      setServiceError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setServiceActionName("");
    }
  }

  const availableDistricts = useMemo(() => districts, [districts]);
  const approval = center ? APPROVAL_CFG[center.approvalStatus] || { label: center.approvalStatus, variant: "slate" as const } : null;

  if (!loaded) return <p className="text-sm text-slate-400">Chargement...</p>;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Hospital}
        title={center ? "Mon centre de sante" : "Creer mon centre"}
        subtitle={center?.name || "Aucun centre cree pour le moment"}
        action={approval ? <Badge variant={approval.variant}>{approval.label}</Badge> : undefined}
      />

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      {!center && !skipCodeClaim ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">Code de l&apos;etablissement</h3>
          <p className="text-sm text-slate-500">
            Si votre etablissement existe deja dans la base (import officiel), entrez son code pour recuperer ses
            informations. Sinon, creez un nouveau centre.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Code etablissement</Label>
            <Input
              value={claimCode}
              onChange={(e) => {
                setClaimCode(e.target.value);
                setClaimError("");
                setClaimNotFound(false);
              }}
              className="uppercase"
              placeholder="Code etablissement"
            />
          </div>
          {claimError ? <Alert variant="error">{claimError}</Alert> : null}
          {claimNotFound ? (
            <div className="flex flex-col gap-2">
              <Alert variant="error">Aucun centre trouve avec ce code.</Alert>
              <Button onClick={createWithClaimCode}>Creer un nouveau centre avec ce code</Button>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setSkipCodeClaim(true)}>Creer sans code</Button>
            <Button onClick={claimByCode} disabled={claimLoading}>
              {claimLoading ? "Verification..." : "Verifier le code"}
            </Button>
          </div>
        </div>
      ) : center && !isEditing ? (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">Informations du centre</h3>
              <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Modifier
              </Button>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {[
                ["Nom", form.name], ["Adresse", form.address], ["Code etablissement", form.establishmentCode || "-"],
                ["Region", form.regionCode || "-"], ["District", form.districtCode || "-"],
                ["Niveau", LEVEL_OPTIONS.find(([v]) => v === form.level)?.[1] || "-"],
                ["Type", TYPE_OPTIONS.find(([v]) => v === form.establishmentType)?.[1] || "-"],
                ["Plateau technique", form.technicalPlatform || "-"],
                ["GPS", `${form.latitude}, ${form.longitude}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between border-b border-slate-100 py-1.5 text-sm">
                  <span className="font-semibold text-slate-400">{label}</span>
                  <span className="text-right text-slate-800">{value}</span>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Places disponibles</h3>
            {serviceError ? <Alert variant="error" className="mb-3">{serviceError}</Alert> : null}
            {services.length === 0 ? <p className="text-sm text-slate-400">Aucun service enregistre.</p> : null}
            <div className="flex flex-col gap-3">
              {services.map((service) => (
                <div key={service.name} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  {editingServiceName === service.name ? (
                    <div className="flex flex-col gap-2">
                      <Input value={serviceDraft.name} onChange={(e) => setServiceDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Nom du service" />
                      <Input value={serviceDraft.description} onChange={(e) => setServiceDraft((p) => ({ ...p, description: e.target.value }))} placeholder="Description" />
                      <Input type="number" value={serviceDraft.bedsAvailable} onChange={(e) => setServiceDraft((p) => ({ ...p, bedsAvailable: e.target.value }))} placeholder="Places disponibles" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingServiceName("")}>Annuler</Button>
                        <Button size="sm" onClick={saveServiceEdit} disabled={serviceActionName === service.name}>
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
                        <Button size="sm" variant="outline" disabled={serviceActionName === service.name || service.bedsAvailable <= 0} onClick={() => adjustBeds(service.name, "occupy")}>
                          <MinusCircle className="h-3.5 w-3.5" /> Occuper une place
                        </Button>
                        <Button size="sm" variant="outline" disabled={serviceActionName === service.name || service.bedsOccupied <= 0} onClick={() => adjustBeds(service.name, "free")}>
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
            </div>
          </div>
        </>
      ) : (
        <form onSubmit={submitCenter} className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Informations generales</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Nom du centre</Label>
                <Input required value={form.name} onChange={(e) => setField("name", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Adresse</Label>
                <Input required value={form.address} onChange={(e) => setField("address", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Code etablissement (optionnel)</Label>
                <Input value={form.establishmentCode} onChange={(e) => setField("establishmentCode", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Localisation</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Region</Label>
                <Select required value={form.regionCode} onChange={(e) => { setField("regionCode", e.target.value); setField("districtCode", ""); }}>
                  <option value="">- Selectionner une region -</option>
                  {regions.map((r) => <option key={r.code} value={r.code}>{r.code} - {r.name}</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>District (optionnel)</Label>
                <Select value={form.districtCode} onChange={(e) => setField("districtCode", e.target.value)}>
                  <option value="">- Ville (optionnel) -</option>
                  {availableDistricts.map((d) => <option key={d.code} value={d.code}>{d.code} - {d.name}</option>)}
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Classification</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Niveau</Label>
                <Select required value={form.level} onChange={(e) => setField("level", e.target.value)}>
                  {LEVEL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                <Select required value={form.establishmentType} onChange={(e) => setField("establishmentType", e.target.value)}>
                  {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Plateau technique & services</h3>
            <div className="flex flex-col gap-1.5">
              <Label>Plateau technique</Label>
              <Textarea required value={form.technicalPlatform} onChange={(e) => setField("technicalPlatform", e.target.value)} />
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-600">Services</span>
                <Button type="button" size="sm" variant="outline" onClick={addServiceRow}>
                  <Plus className="h-3.5 w-3.5" /> Ajouter un service
                </Button>
              </div>
              {services.map((service, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
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
              {services.length === 0 ? <p className="text-xs text-slate-400">Aucun service ajoute.</p> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Coordonnees GPS</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Latitude</Label>
                <Input required type="number" step="any" value={form.latitude} onChange={(e) => setField("latitude", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Longitude</Label>
                <Input required type="number" step="any" value={form.longitude} onChange={(e) => setField("longitude", e.target.value)} />
              </div>
            </div>
            <Button type="button" variant="outline" className="mt-3" onClick={getCurrentPosition}>
              📍 Utiliser ma position
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Apres creation/modification, le centre passe en attente de validation.</p>
            <div className="flex gap-2">
              {center ? <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>Annuler</Button> : null}
              <Button type="submit" disabled={saving}>{saving ? "Enregistrement..." : center ? "Mettre a jour" : "Creer mon centre"}</Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
