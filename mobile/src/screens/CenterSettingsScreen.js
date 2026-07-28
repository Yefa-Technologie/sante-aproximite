import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const ACCENT = C.primary;

const ESTABLISHMENT_TYPE_OPTIONS = ["CONFESSIONNEL", "PRIVE", "PUBLIQUE"];
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

function ApprovalBadge({ status }) {
  const s = String(status || "").toUpperCase();
  const cfg = APPROVAL_CFG[s] || { label: s || "-", bg: C.border, color: C.textMuted };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function normalizeGeoCode(value) { return String(value || "").trim().toUpperCase(); }

function formatGeoOption(option) {
  if (!option) return "";
  const code = String(option.code || "").trim().toUpperCase();
  const name = String(option.name || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code;
}

function parseServices(servicesCsv) {
  return String(servicesCsv || "").split(",").map((item) => item.trim()).filter(Boolean).map((name) => ({ name }));
}

function toTextNumber(value) {
  if (value == null || value === "") return "";
  return String(value);
}

function toEditForm(center) {
  return {
    name: String(center?.name || ""),
    address: String(center?.address || ""),
    establishmentCode: String(center?.establishmentCode || ""),
    regionCode: String(center?.regionCode || ""),
    districtCode: String(center?.districtCode || ""),
    level: String(center?.level || "CENTRE_SANTE"),
    establishmentType: String(center?.establishmentType || "PUBLIQUE"),
    technicalPlatform: String(center?.technicalPlatform || ""),
    servicesCsv: Array.isArray(center?.services) ? center.services.map((s) => s?.name).filter(Boolean).join(", ") : "",
    latitude: toTextNumber(center?.location?.coordinates?.[1]),
    longitude: toTextNumber(center?.location?.coordinates?.[0])
  };
}

export function CenterSettingsScreen() {
  const { token, user } = useAuth();
  const scrollRef = useRef(null);
  const inputRefs = useRef({});
  const [loading, setLoading]             = useState(false);
  const [savingId, setSavingId]           = useState("");
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [regions, setRegions]             = useState([]);
  const [districts, setDistricts]         = useState([]);
  const [centers, setCenters]             = useState([]);
  const [regionFilter, setRegionFilter]   = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [search, setSearch]               = useState("");
  const [editingCenterId, setEditingCenterId] = useState("");
  const [editForm, setEditForm]           = useState(toEditForm(null));
  const [message, setMessage]             = useState("");
  const [error, setError]                 = useState("");

  const normalizedRoles = useMemo(
    () =>
      Array.from(new Set(
        [...(Array.isArray(user?.roles) ? user.roles : []), user?.role]
          .map((value) => String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_"))
          .filter(Boolean)
      )),
    [user]
  );
  const isAdminScope = normalizedRoles.some((role) => ["REGULATOR", "NATIONAL", "REGION", "DISTRICT"].includes(role));

  function registerInputRef(key, ref) {
    if (ref) inputRefs.current[key] = ref;
  }

  function scrollToField() {
    // no-op: measureLayout against the ScrollView ref is unsupported on the new
    // architecture (logs "ref.measureLayout must be called with a ref to a
    // native component" instead of throwing a catchable error) — disabled.
  }

  async function loadRegions() {
    const data = await apiFetch("/geo/regions", { token });
    setRegions(Array.isArray(data) ? data : []);
  }

  async function loadDistricts(regionCode) {
    const normalizedRegion = normalizeGeoCode(regionCode);
    if (!normalizedRegion) { setDistricts([]); return; }
    const data = await apiFetch(`/geo/districts?regionCode=${encodeURIComponent(normalizedRegion)}`, { token });
    setDistricts(Array.isArray(data) ? data : []);
  }

  async function loadCenters() {
    const data = await apiFetch("/centers?includeInactive=1", { token });
    setCenters(Array.isArray(data) ? data : []);
  }

  async function refreshAll({ silent = false } = {}) {
    if (!silent) { setLoading(true); setError(""); setMessage(""); }
    try {
      await Promise.all([loadRegions(), loadCenters()]);
      await loadDistricts(regionFilter);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { refreshAll().catch(() => {}); }, [token]);
  useEffect(() => {
    setDistrictFilter("");
    loadDistricts(regionFilter).catch(() => setDistricts([]));
  }, [regionFilter, token]);

  const filteredCenters = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const r = normalizeGeoCode(regionFilter);
    const d = normalizeGeoCode(districtFilter);
    return centers.filter((center) => {
      if (r && normalizeGeoCode(center?.regionCode) !== r) return false;
      if (d && normalizeGeoCode(center?.districtCode) !== d) return false;
      if (!q) return true;
      const name    = String(center?.name || "").toLowerCase();
      const code    = String(center?.establishmentCode || "").toLowerCase();
      const address = String(center?.address || "").toLowerCase();
      return name.includes(q) || code.includes(q) || address.includes(q);
    });
  }, [centers, search, regionFilter, districtFilter]);

  async function updateCenterByAdmin(centerId) {
    setError(""); setMessage(""); setSavingId(String(centerId));
    try {
      await apiFetch(isAdminScope ? `/centers/${centerId}/admin` : `/centers/${centerId}`, {
        token, method: "PUT",
        body: {
          name: editForm.name, address: editForm.address,
          establishmentCode: editForm.establishmentCode || null,
          regionCode: normalizeGeoCode(editForm.regionCode),
          districtCode: normalizeGeoCode(editForm.districtCode) || null,
          level: editForm.level, establishmentType: editForm.establishmentType,
          technicalPlatform: editForm.technicalPlatform,
          services: parseServices(editForm.servicesCsv),
          latitude: Number(editForm.latitude), longitude: Number(editForm.longitude)
        }
      });
      setEditingCenterId("");
      setMessage("Centre modifie");
      await loadCenters();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId("");
    }
  }

  async function toggleCenterActive(center) {
    const nextActive = center?.isActive === false;
    setError(""); setMessage(""); setActionLoadingId(String(center._id));
    try {
      await apiFetch(`/centers/${center._id}/active`, { token, method: "PATCH", body: { isActive: nextActive } });
      setMessage(nextActive ? "Centre active" : "Centre desactive");
      await loadCenters();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoadingId("");
    }
  }

  async function deleteCenter(center) {
    setError(""); setMessage(""); setActionLoadingId(String(center._id));
    try {
      await apiFetch(`/centers/${center._id}`, { token, method: "DELETE" });
      setMessage("Centre supprime");
      if (editingCenterId === String(center._id)) setEditingCenterId("");
      await loadCenters();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoadingId("");
    }
  }

  function confirmDelete(center) {
    Alert.alert("Suppression", `Supprimer le centre "${center.name}" ?`, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: () => { deleteCenter(center).catch(() => {}); } }
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 12}
    >
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: ACCENT + "1A" }]}>
          <Text style={styles.headerEmoji}>⚙️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Centres de sante</Text>
          <Text style={styles.headerSub}>
            {isAdminScope ? "Filtrer, modifier, desactiver ou supprimer" : "Gestion de votre etablissement"}
          </Text>
        </View>
      </View>

      {/* Search & filter card */}
      <View style={styles.filterCard}>
        <Text style={styles.sectionLabel}>RECHERCHE & FILTRES</Text>

        <TextInput
          ref={(ref) => registerInputRef("search", ref)}
          onFocus={() => scrollToField("search")}
          style={shared.input}
          placeholder="🔍 Recherche (nom, code, adresse)"
          value={search}
          onChangeText={setSearch}
        />

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Region</Text>
            <TextInput
              ref={(ref) => registerInputRef("regionFilter", ref)}
              onFocus={() => scrollToField("regionFilter")}
              style={shared.input}
              placeholder="Ex: ABIDJAN"
              autoCapitalize="characters"
              value={regionFilter}
              onChangeText={setRegionFilter}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>District</Text>
            <TextInput
              ref={(ref) => registerInputRef("districtFilterBottom", ref)}
              onFocus={() => scrollToField("districtFilterBottom")}
              style={shared.input}
              placeholder="Optionnel"
              autoCapitalize="characters"
              value={districtFilter}
              onChangeText={setDistrictFilter}
            />
          </View>
        </View>

        {regions.length ? (
          <View style={styles.chipGroup}>
            {regions.map((region) => (
              <Pressable
                key={region.code}
                style={[styles.chip, normalizeGeoCode(regionFilter) === region.code && styles.chipActive]}
                onPress={() => setRegionFilter(region.code)}
              >
                <Text style={[styles.chipText, normalizeGeoCode(regionFilter) === region.code && styles.chipTextActive]}>
                  {formatGeoOption(region)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable style={styles.outlineBtn} onPress={() => refreshAll().catch(() => {})} disabled={loading}>
          <Text style={styles.outlineBtnText}>{loading ? "Chargement..." : "Actualiser"}</Text>
        </Pressable>
      </View>

      {String(regionFilter || "").trim() ? (
        <View style={styles.filterCard}>
          <Text style={styles.sectionLabel}>DISTRICTS DE LA REGION</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>District</Text>
            <TextInput
              ref={(ref) => registerInputRef("districtFilterTop", ref)}
              onFocus={() => scrollToField("districtFilterTop")}
              style={shared.input}
              placeholder="Optionnel"
              autoCapitalize="characters"
              value={districtFilter}
              onChangeText={setDistrictFilter}
            />
          </View>

          {districts.length ? (
            <View style={styles.chipGroup}>
              {districts.map((district) => (
                <Pressable
                  key={district.code}
                  style={[styles.chip, normalizeGeoCode(districtFilter) === district.code && styles.chipActive]}
                  onPress={() => setDistrictFilter(district.code)}
                >
                  <Text style={[styles.chipText, normalizeGeoCode(districtFilter) === district.code && styles.chipTextActive]}>
                    {formatGeoOption(district)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Aucun district charge pour cette region.</Text>
          )}
        </View>
      ) : null}

      {message ? <Text style={[shared.success, styles.msgBox]}>{message}</Text> : null}
      {error   ? <Text style={[shared.error,   styles.msgBox]}>{error}</Text>   : null}

      {filteredCenters.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>{loading ? "Chargement..." : "Aucun centre pour ce filtre."}</Text>
        </View>
      ) : null}

      {filteredCenters.map((center) => {
        const isEditing = editingCenterId === String(center._id);
        const isBusy    = actionLoadingId === String(center._id);
        return (
          <View key={center._id} style={[styles.card, center.isActive === false && styles.cardInactive]}>

            {/* Card header */}
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{center.name}</Text>
                <Text style={styles.cardCode}>{center.establishmentCode || "-"}</Text>
              </View>
              <ApprovalBadge status={center.approvalStatus} />
            </View>

            {/* Meta */}
            <View style={styles.metaRow}>
              <Text style={styles.metaItem}>📍 {center.regionCode || "-"}{center.districtCode ? ` / ${center.districtCode}` : ""}</Text>
              <Text style={[styles.metaItem, { color: center.isActive === false ? C.red : C.green }]}>
                {center.isActive === false ? "● Desactive" : "● Actif"}
              </Text>
            </View>
            {center.address ? <Text style={styles.cardAddress}>{center.address}</Text> : null}

            {/* Edit form */}
            {isEditing ? (
              <View style={styles.editBox}>
                <Text style={styles.sectionLabel}>MODIFIER LE CENTRE</Text>

                {[
                  { key: "name",              placeholder: "Nom du centre" },
                  { key: "address",           placeholder: "Adresse" },
                  { key: "establishmentCode", placeholder: "Code etablissement" },
                  { key: "regionCode",        placeholder: "Region", autoCapitalize: "characters" },
                  { key: "districtCode",      placeholder: "District", autoCapitalize: "characters" },
                  { key: "technicalPlatform", placeholder: "Plateau technique" },
                  { key: "servicesCsv",       placeholder: "Services (csv)" }
                ].map((field) => (
                  <TextInput
                    key={field.key}
                    ref={(ref) => registerInputRef(`edit-${center._id}-${field.key}`, ref)}
                    onFocus={() => scrollToField(`edit-${center._id}-${field.key}`)}
                    style={shared.input}
                    placeholder={field.placeholder}
                    autoCapitalize={field.autoCapitalize || "sentences"}
                    value={editForm[field.key]}
                    onChangeText={(v) => setEditForm((p) => ({ ...p, [field.key]: v }))}
                  />
                ))}

                <Text style={styles.fieldLabel}>Niveau: {LEVEL_OPTIONS.join(", ")}</Text>
                <TextInput ref={(ref) => registerInputRef(`edit-${center._id}-level`, ref)} onFocus={() => scrollToField(`edit-${center._id}-level`)} style={shared.input} placeholder="Niveau" value={editForm.level} onChangeText={(v) => setEditForm((p) => ({ ...p, level: v }))} />

                <Text style={styles.fieldLabel}>Type: {ESTABLISHMENT_TYPE_OPTIONS.join(", ")}</Text>
                <TextInput ref={(ref) => registerInputRef(`edit-${center._id}-establishmentType`, ref)} onFocus={() => scrollToField(`edit-${center._id}-establishmentType`)} style={shared.input} placeholder="Type" value={editForm.establishmentType} onChangeText={(v) => setEditForm((p) => ({ ...p, establishmentType: v }))} />

                <View style={styles.row}>
                  <TextInput ref={(ref) => registerInputRef(`edit-${center._id}-latitude`, ref)} onFocus={() => scrollToField(`edit-${center._id}-latitude`)} style={[shared.input, { flex: 1 }]} placeholder="Latitude"  keyboardType="numeric" value={editForm.latitude}  onChangeText={(v) => setEditForm((p) => ({ ...p, latitude: v }))} />
                  <TextInput ref={(ref) => registerInputRef(`edit-${center._id}-longitude`, ref)} onFocus={() => scrollToField(`edit-${center._id}-longitude`)} style={[shared.input, { flex: 1 }]} placeholder="Longitude" keyboardType="numeric" value={editForm.longitude} onChangeText={(v) => setEditForm((p) => ({ ...p, longitude: v }))} />
                </View>

                <View style={styles.row}>
                  <Pressable style={styles.outlineBtn} onPress={() => setEditingCenterId("")}>
                    <Text style={styles.outlineBtnText}>Annuler</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.primaryBtn, { flex: 1 }, savingId === String(center._id) && { opacity: 0.6 }]}
                    onPress={() => updateCenterByAdmin(center._id).catch(() => {})}
                    disabled={savingId === String(center._id)}
                  >
                    <Text style={styles.primaryBtnText}>{savingId === String(center._id) ? "..." : "Enregistrer"}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.outlineBtn}
                  onPress={() => { setEditingCenterId(String(center._id)); setEditForm(toEditForm(center)); }}
                >
                  <Text style={styles.outlineBtnText}>Modifier</Text>
                </Pressable>
                <Pressable
                  style={[styles.outlineBtn, isBusy && { opacity: 0.5 }]}
                  onPress={() => toggleCenterActive(center).catch(() => {})}
                  disabled={isBusy}
                >
                  <Text style={styles.outlineBtnText}>
                    {isBusy ? "..." : center.isActive === false ? "Activer" : "Desactiver"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.dangerBtn, isBusy && { opacity: 0.5 }]}
                  onPress={() => confirmDelete(center)}
                  disabled={isBusy}
                >
                  <Text style={styles.dangerBtnText}>Supprimer</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { padding: 16, gap: 14, paddingBottom: 32 },

  // Header
  header:      { flexDirection: "row", alignItems: "center", gap: 14 },
  headerIcon:  { width: 52, height: 52, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  headerEmoji: { fontSize: 26 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: C.textDark },
  headerSub:   { fontSize: 13, color: C.textMuted, marginTop: 2 },

  // Filter card
  filterCard: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
    ...S.sm,
  },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: C.textMuted, letterSpacing: 0.8 },
  fieldLabel:   { fontSize: 12, fontWeight: "700", color: C.textMed, marginBottom: 2 },

  chipGroup: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: R.full,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surface,
  },
  chipActive:     { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText:       { color: C.textMed, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#fff" },

  row:    { flexDirection: "row", gap: 10 },
  msgBox: { padding: 10, borderRadius: R.sm },

  emptyBox:  { alignItems: "center", padding: 24 },
  emptyText: { color: C.textMuted },

  // Center card
  card: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
    borderLeftColor: ACCENT,
    padding: 14,
    gap: 8,
    ...S.sm,
  },
  cardInactive: { borderLeftColor: C.textMuted, opacity: 0.75 },
  cardHeader:   { flexDirection: "row", alignItems: "flex-start" },
  cardTitle:    { fontSize: 16, fontWeight: "700", color: C.textDark, flex: 1 },
  cardCode:     { fontSize: 12, color: C.textMuted, marginTop: 2 },
  metaRow:      { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 4 },
  metaItem:     { fontSize: 12, color: C.textMuted, fontWeight: "600" },
  cardAddress:  { fontSize: 13, color: C.textMed },

  editBox: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, gap: 8, marginTop: 4 },

  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  outlineBtn: {
    borderWidth: 1.5, borderColor: ACCENT, borderRadius: R.sm,
    paddingVertical: 9, paddingHorizontal: 14, alignItems: "center",
  },
  outlineBtnText: { color: ACCENT, fontWeight: "700", fontSize: 13 },
  primaryBtn: {
    backgroundColor: ACCENT, borderRadius: R.sm,
    paddingVertical: 10, alignItems: "center", ...S.sm,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  dangerBtn: {
    borderWidth: 1.5, borderColor: C.red, borderRadius: R.sm,
    paddingVertical: 9, paddingHorizontal: 14, alignItems: "center",
  },
  dangerBtnText: { color: C.red, fontWeight: "700", fontSize: 13 },

  // Badge
  badge:     { borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
