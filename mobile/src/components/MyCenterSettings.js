import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const ACCENT = C.primary;

const ESTABLISHMENT_TYPE_OPTIONS = ["PUBLIQUE", "PRIVE", "CONFESSIONNEL"];
const LEVEL_OPTIONS = [
  "CHU", "CHR", "CH", "CHS", "CLINIQUE", "POLYCLINIQUE", "INFIRMERIE",
  "CLCC", "ESPC", "CENTRE_SANTE", "SSR",
  "EHPAD_USLD", "CENTRE_RADIOTHERAPIE", "CENTRE_CARDIOLOGIE"
];

const APPROVAL_CFG = {
  APPROVED: { label: "APPROUVE",   bg: "#DCFCE7", color: C.green },
  PENDING:  { label: "EN ATTENTE", bg: "#FEF3C7", color: "#92400E" },
  REJECTED: { label: "REJETE",     bg: "#FEE2E2", color: C.red }
};

const EMPTY_PLATFORM = "Non renseigne";

function parsePlatform(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === EMPTY_PLATFORM.toLowerCase()) return [];
  return text.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function toInfoForm(center) {
  return {
    name: String(center?.name || ""),
    address: String(center?.address || ""),
    establishmentCode: String(center?.establishmentCode || ""),
    level: String(center?.level || "CENTRE_SANTE"),
    establishmentType: String(center?.establishmentType || "PUBLIQUE"),
    latitude: center?.location?.coordinates?.[1] == null ? "" : String(center.location.coordinates[1]),
    longitude: center?.location?.coordinates?.[0] == null ? "" : String(center.location.coordinates[0]),
  };
}

function toCount(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function Counter({ label, value, color, onChange, disabled }) {
  return (
    <View style={styles.counter}>
      <Text style={[styles.counterLabel, { color }]}>{label}</Text>
      <View style={styles.counterRow}>
        <Pressable style={[styles.counterBtn, (disabled || value <= 0) && { opacity: 0.4 }]} disabled={disabled || value <= 0} onPress={() => onChange(value - 1)} accessibilityLabel={`Retirer une place ${label}`}>
          <Text style={styles.counterBtnText}>−</Text>
        </Pressable>
        <TextInput
          style={styles.counterValue}
          keyboardType="number-pad"
          value={String(value)}
          editable={!disabled}
          onChangeText={(v) => onChange(toCount(v.replace(/\D/g, "")))}
        />
        <Pressable style={[styles.counterBtn, disabled && { opacity: 0.4 }]} disabled={disabled} onPress={() => onChange(value + 1)} accessibilityLabel={`Ajouter une place ${label}`}>
          <Text style={styles.counterBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function MyCenterSettings() {
  const { token, user } = useAuth();
  const [centers, setCenters] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [editingInfo, setEditingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState(toInfoForm(null));
  const [platformInput, setPlatformInput] = useState("");
  const [serviceDrafts, setServiceDrafts] = useState({});
  const [editingServiceName, setEditingServiceName] = useState("");
  const [serviceEdit, setServiceEdit] = useState({ name: "", description: "" });
  const [newService, setNewService] = useState({ name: "", description: "", beds: "" });
  const [showNewService, setShowNewService] = useState(false);

  const center = useMemo(
    () => centers.find((c) => String(c._id) === String(selectedId)) || centers[0] || null,
    [centers, selectedId]
  );
  const platform = useMemo(() => parsePlatform(center?.technicalPlatform), [center]);
  const services = Array.isArray(center?.services) ? center.services : [];

  const totals = useMemo(() => services.filter((s) => s.isActive !== false).reduce((acc, s) => ({
    available: acc.available + toCount(s.bedsAvailable),
    occupied: acc.occupied + toCount(s.bedsOccupied),
    outOfService: acc.outOfService + toCount(s.bedsOutOfService),
  }), { available: 0, occupied: 0, outOfService: 0 }), [services]);

  function notify(text) { setError(""); setMessage(text); }
  function fail(err) { setMessage(""); setError(err?.message || String(err)); }

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch("/centers?includeInactive=1", { token });
      const list = Array.isArray(data) ? data : [];
      setCenters(list);
      if (list.length && !list.some((c) => String(c._id) === String(selectedId))) setSelectedId(String(list[0]._id));
    } catch (err) { fail(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [token]);
  useEffect(() => { setServiceDrafts({}); setEditingInfo(false); setEditingServiceName(""); }, [center?._id]);

  function replaceCenter(updated) {
    setCenters((list) => list.map((c) => (String(c._id) === String(updated._id) ? { ...c, ...updated } : c)));
  }

  // PUT /centers/:id remplace l'ensemble du centre (services compris) : on renvoie toujours tout.
  async function saveCenter(overrides = {}, successText = "Centre mis a jour") {
    if (!center) return false;
    const info = overrides.info || toInfoForm(center);
    const body = {
      name: info.name.trim(),
      address: info.address.trim(),
      establishmentCode: info.establishmentCode.trim() || null,
      level: info.level,
      establishmentType: info.establishmentType,
      regionCode: center.regionCode,
      districtCode: center.districtCode || null,
      technicalPlatform: (overrides.platform || platform).join(", ") || EMPTY_PLATFORM,
      services: overrides.services || services,
      latitude: Number(info.latitude),
      longitude: Number(info.longitude),
    };
    if (!body.name || !body.address) { fail(new Error("Le nom et l'adresse sont obligatoires.")); return false; }
    if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) { fail(new Error("Latitude et longitude invalides.")); return false; }
    const wasApproved = center.approvalStatus === "APPROVED";
    const updated = await apiFetch(`/centers/${center._id}`, { token, method: "PUT", body });
    replaceCenter(updated);
    notify(wasApproved && updated.approvalStatus === "PENDING"
      ? `${successText}. Les informations modifiees seront revalidees par votre district.`
      : successText);
    return true;
  }

  async function run(key, fn) {
    if (busy) return;
    setBusy(key); setError(""); setMessage("");
    try { await fn(); } catch (err) { fail(err); } finally { setBusy(""); }
  }

  // ── Informations ──
  function submitInfo() {
    run("info", async () => {
      if (await saveCenter({ info: infoForm }, "Informations enregistrees")) setEditingInfo(false);
    });
  }

  // ── Plateau technique ──
  function addPlatformItem() {
    const items = platformInput.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    const next = [...platform];
    for (const item of items) if (!next.some((p) => p.toLowerCase() === item.toLowerCase())) next.push(item);
    if (next.length === platform.length) { setPlatformInput(""); return; }
    run("platform", async () => {
      if (await saveCenter({ platform: next }, "Plateau technique mis a jour")) setPlatformInput("");
    });
  }
  function removePlatformItem(item) {
    run("platform", () => saveCenter({ platform: platform.filter((p) => p !== item) }, "Equipement retire"));
  }

  // ── Services & places ──
  function draftOf(service) {
    return serviceDrafts[service.name] || {
      bedsAvailable: toCount(service.bedsAvailable),
      bedsOccupied: toCount(service.bedsOccupied),
      bedsOutOfService: toCount(service.bedsOutOfService),
    };
  }
  function isDirty(service) {
    const d = serviceDrafts[service.name];
    return Boolean(d) && (d.bedsAvailable !== toCount(service.bedsAvailable)
      || d.bedsOccupied !== toCount(service.bedsOccupied)
      || d.bedsOutOfService !== toCount(service.bedsOutOfService));
  }
  function setDraft(service, key, value) {
    setServiceDrafts((p) => ({ ...p, [service.name]: { ...draftOf(service), [key]: toCount(value) } }));
  }
  function applyServiceUpdate(oldName, updatedService) {
    replaceCenter({
      ...center,
      services: services.map((s) => (s.name === oldName ? { ...s, ...updatedService } : s)),
    });
    setServiceDrafts((p) => { const n = { ...p }; delete n[oldName]; return n; });
  }

  function saveBeds(service) {
    run(`beds-${service.name}`, async () => {
      const data = await apiFetch(`/centers/${center._id}/services/${encodeURIComponent(service.name)}`, {
        token, method: "PATCH", body: draftOf(service),
      });
      applyServiceUpdate(service.name, data.service);
      notify(`Places du service "${service.name}" enregistrees`);
    });
  }

  function adjustBed(service, adjust) {
    run(`adjust-${service.name}`, async () => {
      const data = await apiFetch(`/centers/${center._id}/services/${encodeURIComponent(service.name)}`, {
        token, method: "PATCH", body: { adjust },
      });
      applyServiceUpdate(service.name, data.service);
      notify(adjust === "occupy" ? "1 place occupee" : "1 place liberee");
    });
  }

  function saveServiceEdit(service) {
    const name = serviceEdit.name.trim();
    if (!name) { fail(new Error("Le nom du service est obligatoire.")); return; }
    if (name.toLowerCase() !== service.name.toLowerCase() && services.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      fail(new Error("Un service porte deja ce nom.")); return;
    }
    run(`edit-${service.name}`, async () => {
      const data = await apiFetch(`/centers/${center._id}/services/${encodeURIComponent(service.name)}`, {
        token, method: "PATCH", body: { name, description: serviceEdit.description },
      });
      applyServiceUpdate(service.name, data.service);
      setEditingServiceName("");
      notify("Service modifie");
    });
  }

  function confirmToggleService(service) {
    const deactivate = service.isActive !== false;
    const doToggle = () => run(`toggle-${service.name}`, async () => {
      const data = await apiFetch(`/centers/${center._id}/services/${encodeURIComponent(service.name)}`, {
        token, method: "PATCH", body: { isActive: !deactivate },
      });
      applyServiceUpdate(service.name, data.service);
      notify(deactivate ? `Service "${service.name}" desactive` : `Service "${service.name}" reactive`);
    });
    if (!deactivate) { doToggle(); return; }
    Alert.alert(
      "Desactiver le service",
      `"${service.name}" ne sera plus propose aux patients ni pour les references. Ses places sont conservees et vous pourrez le reactiver.`,
      [{ text: "Annuler", style: "cancel" }, { text: "Desactiver", onPress: doToggle }]
    );
  }

  function confirmDeleteService(service) {
    Alert.alert("Supprimer le service", `Supprimer definitivement le service "${service.name}" et toutes ses places ? Cette action est irreversible.`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive",
        onPress: () => run(`delete-${service.name}`, () => saveCenter({ services: services.filter((s) => s.name !== service.name) }, "Service supprime")),
      },
    ]);
  }

  function addService() {
    const name = newService.name.trim();
    if (!name) { fail(new Error("Le nom du service est obligatoire.")); return; }
    if (services.some((s) => s.name.toLowerCase() === name.toLowerCase())) { fail(new Error("Ce service existe deja.")); return; }
    run("add-service", async () => {
      const updated = await apiFetch(`/centers/${center._id}/services`, {
        token, method: "POST",
        body: { name, description: newService.description.trim(), bedsAvailable: toCount(newService.beds) },
      });
      replaceCenter(updated);
      setNewService({ name: "", description: "", beds: "" });
      setShowNewService(false);
      notify(`Service "${name}" ajoute`);
    });
  }

  if (loading && !center) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={ACCENT} /></View>;
  }

  if (!center) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Aucun centre rattache a votre compte</Text>
        <Text style={styles.emptyText}>Rattachez votre etablissement depuis l'Espace chef avec son code.</Text>
        {error ? <Text style={[shared.error, styles.msgBox]}>{error}</Text> : null}
        <Pressable style={[styles.outlineBtn, { marginTop: 12 }]} onPress={load}><Text style={styles.outlineBtnText}>Actualiser</Text></Pressable>
      </View>
    );
  }

  const approval = APPROVAL_CFG[String(center.approvalStatus || "").toUpperCase()] || { label: center.approvalStatus || "-", bg: C.border, color: C.textMuted };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 12}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

        {centers.length > 1 ? (
          <View style={styles.chipGroup}>
            {centers.map((c) => {
              const active = String(c._id) === String(center._id);
              return (
                <Pressable key={c._id} style={[styles.chip, active && styles.chipActive]} onPress={() => setSelectedId(String(c._id))}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.connectedBar}>
          <View style={styles.connectedAvatar}>
            <Text style={styles.connectedAvatarText}>{String(user?.fullName || "?").trim().charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.connectedLabel}>Connecte en tant que</Text>
            <Text style={styles.connectedName} numberOfLines={1}>{user?.fullName || "-"}</Text>
          </View>
        </View>

        {/* Fiche du centre */}
        <View style={styles.heroCard}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>{center.name}</Text>
              <Text style={styles.heroSub}>
                {center.level || "-"} · {center.establishmentType || "-"}{center.establishmentCode ? ` · Code ${center.establishmentCode}` : ""}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: approval.bg }]}>
              <Text style={[styles.badgeText, { color: approval.color }]}>{approval.label}</Text>
            </View>
          </View>
          {center.address ? <Text style={styles.heroAddress}>📍 {center.address}</Text> : null}
          <Text style={styles.heroMeta}>
            {center.regionCode || "-"}{center.districtCode ? ` / ${center.districtCode}` : ""} · {center.isActive === false ? "Desactive" : "Actif"}
          </Text>
          <View style={styles.statsRow}>
            <View style={[styles.stat, { backgroundColor: C.greenLight }]}>
              <Text style={[styles.statValue, { color: C.green }]}>{totals.available}</Text>
              <Text style={styles.statLabel}>Places libres</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: C.orangeLight }]}>
              <Text style={[styles.statValue, { color: C.orange }]}>{totals.occupied}</Text>
              <Text style={styles.statLabel}>Occupees</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: C.bg }]}>
              <Text style={[styles.statValue, { color: C.textMuted }]}>{totals.outOfService}</Text>
              <Text style={styles.statLabel}>Hors service</Text>
            </View>
          </View>
        </View>

        {message ? <Text style={[shared.success, styles.msgBox]}>{message}</Text> : null}
        {error ? <Text style={[shared.error, styles.msgBox]}>{error}</Text> : null}

        {/* Informations */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionLabel}>INFORMATIONS DU CENTRE</Text>
            {!editingInfo ? (
              <Pressable onPress={() => { setInfoForm(toInfoForm(center)); setEditingInfo(true); }}>
                <Text style={styles.link}>Modifier</Text>
              </Pressable>
            ) : null}
          </View>

          {editingInfo ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.fieldLabel}>Nom du centre</Text>
              <TextInput style={shared.input} value={infoForm.name} onChangeText={(v) => setInfoForm((p) => ({ ...p, name: v }))} />
              <Text style={styles.fieldLabel}>Adresse</Text>
              <TextInput style={shared.input} value={infoForm.address} onChangeText={(v) => setInfoForm((p) => ({ ...p, address: v }))} />
              <Text style={styles.fieldLabel}>Code etablissement</Text>
              <TextInput style={shared.input} value={infoForm.establishmentCode} autoCapitalize="characters" onChangeText={(v) => setInfoForm((p) => ({ ...p, establishmentCode: v }))} />

              <Text style={styles.fieldLabel}>Niveau</Text>
              <View style={styles.chipGroup}>
                {LEVEL_OPTIONS.map((level) => (
                  <Pressable key={level} style={[styles.chip, infoForm.level === level && styles.chipActive]} onPress={() => setInfoForm((p) => ({ ...p, level }))}>
                    <Text style={[styles.chipText, infoForm.level === level && styles.chipTextActive]}>{level.replace(/_/g, " ")}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Type</Text>
              <View style={styles.chipGroup}>
                {ESTABLISHMENT_TYPE_OPTIONS.map((type) => (
                  <Pressable key={type} style={[styles.chip, infoForm.establishmentType === type && styles.chipActive]} onPress={() => setInfoForm((p) => ({ ...p, establishmentType: type }))}>
                    <Text style={[styles.chipText, infoForm.establishmentType === type && styles.chipTextActive]}>{type}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Coordonnees GPS</Text>
              <View style={styles.row}>
                <TextInput style={[shared.input, { flex: 1 }]} placeholder="Latitude" keyboardType="numeric" value={infoForm.latitude} onChangeText={(v) => setInfoForm((p) => ({ ...p, latitude: v }))} />
                <TextInput style={[shared.input, { flex: 1 }]} placeholder="Longitude" keyboardType="numeric" value={infoForm.longitude} onChangeText={(v) => setInfoForm((p) => ({ ...p, longitude: v }))} />
              </View>
              <Text style={styles.hint}>Modifier le nom, l'adresse, le code, le niveau, le type ou la position renvoie le centre en validation.</Text>

              <View style={styles.row}>
                <Pressable style={styles.outlineBtn} onPress={() => setEditingInfo(false)}>
                  <Text style={styles.outlineBtnText}>Annuler</Text>
                </Pressable>
                <Pressable style={[styles.primaryBtn, { flex: 1 }, busy === "info" && { opacity: 0.6 }]} onPress={submitInfo} disabled={Boolean(busy)}>
                  <Text style={styles.primaryBtnText}>{busy === "info" ? "Enregistrement..." : "Enregistrer"}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              {[
                ["Nom", center.name],
                ["Adresse", center.address],
                ["Code", center.establishmentCode],
                ["Niveau", String(center.level || "").replace(/_/g, " ")],
                ["Type", center.establishmentType],
                ["Position", center.location?.coordinates ? `${center.location.coordinates[1]}, ${center.location.coordinates[0]}` : ""],
              ].map(([label, value]) => (
                <View key={label} style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{label}</Text>
                  <Text style={styles.infoValue}>{value || "-"}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Plateau technique */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PLATEAU TECHNIQUE</Text>
          {platform.length ? (
            <View style={styles.chipGroup}>
              {platform.map((item) => (
                <View key={item} style={styles.equipChip}>
                  <Text style={styles.equipChipText}>{item}</Text>
                  <Pressable onPress={() => removePlatformItem(item)} disabled={Boolean(busy)} hitSlop={8} accessibilityLabel={`Retirer ${item}`}>
                    <Text style={styles.equipChipRemove}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.hint}>Aucun equipement renseigne.</Text>
          )}
          <View style={styles.row}>
            <TextInput
              style={[shared.input, { flex: 1 }]}
              placeholder="Ex: Radiologie, Echographie, Laboratoire"
              value={platformInput}
              onChangeText={setPlatformInput}
              onSubmitEditing={addPlatformItem}
              returnKeyType="done"
            />
            <Pressable style={[styles.primaryBtn, { paddingHorizontal: 16 }, (!platformInput.trim() || busy) && { opacity: 0.5 }]} onPress={addPlatformItem} disabled={!platformInput.trim() || Boolean(busy)}>
              <Text style={styles.primaryBtnText}>{busy === "platform" ? "..." : "Ajouter"}</Text>
            </Pressable>
          </View>
        </View>

        {/* Services & places */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionLabel}>SERVICES ET GESTION DES PLACES</Text>
            <Pressable onPress={() => setShowNewService((v) => !v)}>
              <Text style={styles.link}>{showNewService ? "Fermer" : "+ Ajouter"}</Text>
            </Pressable>
          </View>

          {showNewService ? (
            <View style={styles.newServiceBox}>
              <TextInput style={shared.input} placeholder="Nom du service (ex: Maternite)" value={newService.name} onChangeText={(v) => setNewService((p) => ({ ...p, name: v }))} />
              <TextInput style={shared.input} placeholder="Description (optionnel)" value={newService.description} onChangeText={(v) => setNewService((p) => ({ ...p, description: v }))} />
              <TextInput style={shared.input} placeholder="Nombre de places disponibles" keyboardType="number-pad" value={newService.beds} onChangeText={(v) => setNewService((p) => ({ ...p, beds: v.replace(/\D/g, "") }))} />
              <Pressable style={[styles.primaryBtn, busy === "add-service" && { opacity: 0.6 }]} onPress={addService} disabled={Boolean(busy)}>
                <Text style={styles.primaryBtnText}>{busy === "add-service" ? "Ajout..." : "Ajouter le service"}</Text>
              </Pressable>
            </View>
          ) : null}

          {services.length === 0 ? <Text style={styles.hint}>Aucun service. Ajoutez vos services pour gerer leurs places.</Text> : null}

          {services.map((service) => {
            const draft = draftOf(service);
            const dirty = isDirty(service);
            const editing = editingServiceName === service.name;
            const serviceBusy = busy.endsWith(`-${service.name}`);
            const inactive = service.isActive === false;
            return (
              <View key={service.name} style={[styles.serviceCard, inactive && styles.serviceCardInactive]}>
                {editing ? (
                  <View style={{ gap: 8 }}>
                    <TextInput style={shared.input} value={serviceEdit.name} onChangeText={(v) => setServiceEdit((p) => ({ ...p, name: v }))} placeholder="Nom du service" />
                    <TextInput style={shared.input} value={serviceEdit.description} onChangeText={(v) => setServiceEdit((p) => ({ ...p, description: v }))} placeholder="Description" />
                    <View style={styles.row}>
                      <Pressable style={styles.outlineBtn} onPress={() => setEditingServiceName("")}>
                        <Text style={styles.outlineBtnText}>Annuler</Text>
                      </Pressable>
                      <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={() => saveServiceEdit(service)} disabled={Boolean(busy)}>
                        <Text style={styles.primaryBtnText}>{serviceBusy ? "..." : "Enregistrer"}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.serviceName}>{service.name}</Text>
                      {service.description ? <Text style={styles.serviceDesc}>{service.description}</Text> : null}
                    </View>
                    {inactive ? (
                      <View style={[styles.badge, { backgroundColor: C.border }]}>
                        <Text style={[styles.badgeText, { color: C.textMuted }]}>DESACTIVE</Text>
                      </View>
                    ) : (
                      <View style={[styles.badge, { backgroundColor: toCount(service.bedsAvailable) > 0 ? C.greenLight : C.redLight }]}>
                        <Text style={[styles.badgeText, { color: toCount(service.bedsAvailable) > 0 ? C.green : C.red }]}>
                          {toCount(service.bedsAvailable) > 0 ? `${toCount(service.bedsAvailable)} LIBRE(S)` : "COMPLET"}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {inactive ? (
                  <Text style={styles.hint}>Service desactive : il n'est plus visible par les patients ni propose pour les references.</Text>
                ) : null}

                <View style={[styles.countersRow, inactive && { opacity: 0.5 }]}>
                  <Counter label="Libres" color={C.green} value={draft.bedsAvailable} disabled={serviceBusy || inactive} onChange={(v) => setDraft(service, "bedsAvailable", v)} />
                  <Counter label="Occupees" color={C.orange} value={draft.bedsOccupied} disabled={serviceBusy || inactive} onChange={(v) => setDraft(service, "bedsOccupied", v)} />
                  <Counter label="Hors service" color={C.textMuted} value={draft.bedsOutOfService} disabled={serviceBusy || inactive} onChange={(v) => setDraft(service, "bedsOutOfService", v)} />
                </View>

                {dirty ? (
                  <View style={styles.row}>
                    <Pressable style={styles.outlineBtn} onPress={() => setServiceDrafts((p) => { const n = { ...p }; delete n[service.name]; return n; })}>
                      <Text style={styles.outlineBtnText}>Annuler</Text>
                    </Pressable>
                    <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={() => saveBeds(service)} disabled={Boolean(busy)}>
                      <Text style={styles.primaryBtnText}>{serviceBusy ? "..." : "Enregistrer les places"}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.actionsRow}>
                    {!inactive ? (<>
                    <Pressable style={[styles.smallBtn, { borderColor: C.orange }, (serviceBusy || toCount(service.bedsAvailable) <= 0) && { opacity: 0.4 }]} disabled={Boolean(busy) || toCount(service.bedsAvailable) <= 0} onPress={() => adjustBed(service, "occupy")}>
                      <Text style={[styles.smallBtnText, { color: C.orange }]}>Admettre un patient</Text>
                    </Pressable>
                    <Pressable style={[styles.smallBtn, { borderColor: C.green }, (serviceBusy || toCount(service.bedsOccupied) <= 0) && { opacity: 0.4 }]} disabled={Boolean(busy) || toCount(service.bedsOccupied) <= 0} onPress={() => adjustBed(service, "free")}>
                      <Text style={[styles.smallBtnText, { color: C.green }]}>Liberer une place</Text>
                    </Pressable>
                    </>) : null}
                    {!editing ? (
                      <Pressable style={styles.smallBtn} disabled={Boolean(busy)} onPress={() => { setEditingServiceName(service.name); setServiceEdit({ name: service.name, description: service.description || "" }); }}>
                        <Text style={styles.smallBtnText}>Modifier</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={[styles.smallBtn, { borderColor: inactive ? C.green : C.amber }]} disabled={Boolean(busy)} onPress={() => confirmToggleService(service)}>
                      <Text style={[styles.smallBtnText, { color: inactive ? C.green : C.amber }]}>
                        {busy === `toggle-${service.name}` ? "..." : inactive ? "Reactiver le service" : "Desactiver le service"}
                      </Text>
                    </Pressable>
                    <Pressable style={[styles.smallBtn, { borderColor: C.red }]} disabled={Boolean(busy)} onPress={() => confirmDeleteService(service)}>
                      <Text style={[styles.smallBtnText, { color: C.red }]}>Supprimer le service</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <Pressable style={styles.outlineBtn} onPress={load} disabled={loading}>
          <Text style={styles.outlineBtnText}>{loading ? "Chargement..." : "Actualiser"}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: C.textDark, textAlign: "center" },
  emptyText: { color: C.textMuted, textAlign: "center" },

  heroCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: 16, gap: 8, borderLeftWidth: 4, borderLeftColor: ACCENT, ...S.sm },
  heroTitle: { fontSize: 18, fontWeight: "800", color: C.textDark },
  heroSub: { fontSize: 12, color: C.textMuted, fontWeight: "600", marginTop: 2 },
  heroAddress: { fontSize: 13, color: C.textMed },
  heroMeta: { fontSize: 12, color: C.textMuted, fontWeight: "600" },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  stat: { flex: 1, borderRadius: R.sm, paddingVertical: 10, alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "800" },
  statLabel: { fontSize: 11, color: C.textMed, fontWeight: "600" },

  card: { backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10, ...S.sm },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: C.textMuted, letterSpacing: 0.8, flexShrink: 1 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: C.textMed },
  hint: { fontSize: 12, color: C.textMuted },
  link: { color: ACCENT, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  msgBox: { padding: 10, borderRadius: R.sm },

  infoRow: { flexDirection: "row", gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { width: 80, fontSize: 12, color: C.textMuted, fontWeight: "700" },
  infoValue: { flex: 1, fontSize: 13, color: C.textDark },

  chipGroup: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1.5, borderColor: C.border, borderRadius: R.full, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surface, maxWidth: "100%" },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { color: C.textMed, fontWeight: "600", fontSize: 12 },
  chipTextActive: { color: "#fff" },

  equipChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primaryLight, borderRadius: R.full, paddingLeft: 12, paddingRight: 10, paddingVertical: 6 },
  equipChipText: { color: C.primaryDark, fontWeight: "700", fontSize: 13 },
  equipChipRemove: { color: C.primaryDark, fontWeight: "800", fontSize: 12 },

  newServiceBox: { gap: 8, backgroundColor: C.surfaceAlt, borderRadius: R.sm, padding: 10, borderWidth: 1, borderColor: C.border },
  serviceCard: { borderWidth: 1, borderColor: C.border, borderRadius: R.sm, padding: 12, gap: 10, backgroundColor: C.surfaceAlt },
  serviceCardInactive: { backgroundColor: C.bg, borderStyle: "dashed" },
  connectedBar: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.primaryLight, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 14 },
  connectedAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" },
  connectedAvatarText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  connectedLabel: { fontSize: 11, color: C.textMuted, fontWeight: "700" },
  connectedName: { fontSize: 15, color: C.primaryDark, fontWeight: "800" },
  serviceName: { fontSize: 15, fontWeight: "800", color: C.textDark },
  serviceDesc: { fontSize: 12, color: C.textMuted, marginTop: 2 },

  countersRow: { flexDirection: "row", gap: 8 },
  counter: { flex: 1, backgroundColor: C.surface, borderRadius: R.sm, borderWidth: 1, borderColor: C.border, padding: 8, alignItems: "center", gap: 6 },
  counterLabel: { fontSize: 11, fontWeight: "800" },
  counterRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  counterBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
  counterBtnText: { fontSize: 18, fontWeight: "800", color: C.textDark, lineHeight: 20 },
  counterValue: { minWidth: 36, textAlign: "center", fontSize: 16, fontWeight: "800", color: C.textDark, paddingVertical: 2 },

  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallBtn: { borderWidth: 1.5, borderColor: ACCENT, borderRadius: R.sm, paddingVertical: 7, paddingHorizontal: 10 },
  smallBtnText: { color: ACCENT, fontWeight: "700", fontSize: 12 },

  outlineBtn: { borderWidth: 1.5, borderColor: ACCENT, borderRadius: R.sm, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
  outlineBtnText: { color: ACCENT, fontWeight: "700", fontSize: 13 },
  primaryBtn: { backgroundColor: ACCENT, borderRadius: R.sm, paddingVertical: 11, alignItems: "center", ...S.sm },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  badge: { borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
