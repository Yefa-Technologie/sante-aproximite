import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const ACCENT = C.orange;

// Statuts actifs vs terminés
const DONE_STATUSES = ["COMPLETED", "CLOSED"];

// Séquence de progression
function getNextStatus(currentStatus) {
  if (currentStatus === "ACKNOWLEDGED") return "EN_ROUTE";
  const flow = ["EN_ROUTE", "ON_SITE", "COMPLETED"];
  const idx = flow.indexOf(currentStatus);
  if (idx >= 0 && idx < flow.length - 1) return flow[idx + 1];
  return null;
}

const NEXT_BTN_LABEL = {
  EN_ROUTE:  "🚗  Je pars - En route",
  ON_SITE:   "📍  Je suis sur site",
  COMPLETED: "✅  Terminer l'intervention",
};

const STATUS_CFG = {
  NEW:          { label: "NOUVELLE",        bg: "#FEE2E2", color: C.red,     border: C.red },
  ACKNOWLEDGED: { label: "PRISE EN CHARGE", bg: "#FEF3C7", color: "#92400E", border: C.amber },
  EN_ROUTE:     { label: "EN ROUTE",        bg: "#FFF7ED", color: ACCENT,    border: ACCENT },
  ON_SITE:      { label: "SUR SITE",        bg: "#EFF6FF", color: C.primary, border: C.primary },
  COMPLETED:    { label: "TERMINEE",        bg: "#DCFCE7", color: C.green,   border: C.green },
  CLOSED:       { label: "CLOTUREE",        bg: C.border,  color: C.textMuted, border: C.border },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status || "-", bg: C.border, color: C.textMuted };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildMapRegion(item) {
  const lat = toNumberOrNull(item?.latitude);
  const lon = toNumberOrNull(item?.longitude);
  if (lat == null || lon == null) return null;
  const teamLat = toNumberOrNull(item?.teamLatitude);
  const teamLon = toNumberOrNull(item?.teamLongitude);
  if (teamLat == null || teamLon == null) {
    return { latitude: lat, longitude: lon, latitudeDelta: 0.02, longitudeDelta: 0.02 };
  }
  const midLat = (lat + teamLat) / 2;
  const midLon = (lon + teamLon) / 2;
  const latDelta = Math.max(0.02, Math.abs(lat - teamLat) * 2.4);
  const lonDelta = Math.max(0.02, Math.abs(lon - teamLon) * 2.4);
  return { latitude: midLat, longitude: midLon, latitudeDelta: latDelta, longitudeDelta: lonDelta };
}

export function EmergencyOpsScreen() {
  const { token } = useAuth();
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [noteById, setNoteById]   = useState({});
  const [pendingId, setPendingId] = useState("");
  const [activeTab, setActiveTab] = useState("active"); // "active" | "reports"

  async function loadItems({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      // all=true : toutes les alertes visibles peu importe le service (SAMU + Pompiers)
      const data = await apiFetch("/emergency-reports?all=true", { token });
      setItems(Array.isArray(data) ? data : []);
      if (!silent) setError("");
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    const interval = setInterval(() => loadItems({ silent: true }).catch(() => {}), 15000);
    return () => clearInterval(interval);
  }, [token]);

  async function getCurrentPosition() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") throw new Error("Permission de localisation refusee");
    const current = await Location.getCurrentPositionAsync({});
    return { latitude: current.coords.latitude, longitude: current.coords.longitude };
  }

  async function acknowledge(itemId) {
    setPendingId(String(itemId)); setError("");
    try {
      const position = await getCurrentPosition();
      await apiFetch(`/emergency-reports/${itemId}/acknowledge`, {
        token, method: "POST",
        body: { teamLatitude: position.latitude, teamLongitude: position.longitude }
      });
      await loadItems({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingId("");
    }
  }

  async function updateProgress(itemId, status) {
    // Rapport obligatoire avant de terminer
    if (status === "COMPLETED" && !String(noteById[itemId] || "").trim()) {
      setError("Le rapport d'intervention est obligatoire avant de terminer.");
      return;
    }
    setPendingId(String(itemId)); setError("");
    try {
      const position = await getCurrentPosition();
      await apiFetch(`/emergency-reports/${itemId}/progress`, {
        token, method: "PATCH",
        body: {
          status,
          teamLatitude:  position.latitude,
          teamLongitude: position.longitude,
          teamNote:      noteById[itemId] || ""
        }
      });
      // Apres completion : basculer sur l'onglet rapports
      if (status === "COMPLETED") setActiveTab("reports");
      await loadItems({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingId("");
    }
  }

  async function navigateToAlert(item) {
    const lat = toNumberOrNull(item?.latitude);
    const lon = toNumberOrNull(item?.longitude);
    if (lat == null || lon == null) { setError("Coordonnees invalides"); return; }
    const teamLat = toNumberOrNull(item?.teamLatitude);
    const teamLon = toNumberOrNull(item?.teamLongitude);
    const url = teamLat != null && teamLon != null
      ? `https://www.google.com/maps/dir/?api=1&origin=${teamLat},${teamLon}&destination=${lat},${lon}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    try { await Linking.openURL(url); } catch { setError("Impossible d'ouvrir la navigation"); }
  }

  const activeItems = items.filter((i) => !DONE_STATUSES.includes(i.status));
  const reportItems = items.filter((i) =>  DONE_STATUSES.includes(i.status));

  function renderAlertCard(item) {
    const mapRegion   = buildMapRegion(item);
    const isBusy      = pendingId === String(item.id);
    const nextStatus  = getNextStatus(item.status);
    const nextCfg     = nextStatus ? (STATUS_CFG[nextStatus] || {}) : null;
    const borderColor = STATUS_CFG[item.status]?.border || ACCENT;
    const isCompleting = nextStatus === "COMPLETED";
    const rapport     = String(noteById[item.id] || "").trim();
    const canComplete = rapport.length >= 5;

    return (
      <View key={item.id} style={[styles.card, { borderLeftColor: borderColor }]}>
        {/* En-tête */}
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardType}>{item.emergencyType}</Text>
            <Text style={styles.cardReporter}>{item.reporterName || "Demandeur inconnu"}</Text>
          </View>
          <StatusBadge status={item.status} />
        </View>

        {/* Infos */}
        <View style={styles.infoGrid}>
          {[
            { key: "Tel",        val: item.phoneNumber || "-" },
            { key: "Position",   val: `${item.latitude}, ${item.longitude}` },
            item.teamLatitude != null ? { key: "Equipe", val: `${item.teamLatitude}, ${item.teamLongitude}` } : null,
            item.description ? { key: "Description", val: item.description } : null,
          ].filter(Boolean).map(({ key, val }) => (
            <View key={key} style={styles.infoRow}>
              <Text style={styles.infoKey}>{key}</Text>
              <Text style={[styles.infoVal, { flex: 1 }]}>{val}</Text>
            </View>
          ))}
        </View>

        {Array.isArray(item.photos) && item.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {item.photos.map((photo, index) => (
              <Image key={`emergency_ops_photo_${item.id}_${index}`} source={{ uri: photo }} style={styles.photoThumb} />
            ))}
          </ScrollView>
        ) : null}

        {/* Carte */}
        {mapRegion ? (
          <View style={styles.mapWrap}>
            <MapView style={styles.map} initialRegion={mapRegion}>
              <Marker coordinate={{ latitude: Number(item.latitude), longitude: Number(item.longitude) }} title="Victime" pinColor={C.red} />
              {item.teamLatitude != null && item.teamLongitude != null ? (
                <>
                  <Marker coordinate={{ latitude: Number(item.teamLatitude), longitude: Number(item.teamLongitude) }} title="Mon equipe" pinColor={ACCENT} />
                  <Polyline coordinates={[{ latitude: Number(item.teamLatitude), longitude: Number(item.teamLongitude) }, { latitude: Number(item.latitude), longitude: Number(item.longitude) }]} strokeColor={ACCENT} strokeWidth={4} />
                </>
              ) : null}
            </MapView>
          </View>
        ) : null}

        {/* Champ rapport / note */}
        <View>
          <Text style={[styles.noteLabel, isCompleting && { color: C.red, fontWeight: "800" }]}>
            {isCompleting ? "📋 Rapport d'intervention (obligatoire *)" : "📝 Note equipe (optionnel)"}
          </Text>
          <TextInput
            style={[
              shared.input,
              shared.textArea,
              styles.noteInput,
              isCompleting && !canComplete && { borderColor: C.red + "80", borderWidth: 1.5 }
            ]}
            placeholder={isCompleting ? "Decrivez le deroulement de l'intervention (min 5 car.)..." : "Note pour l'equipe..."}
            value={noteById[item.id] || ""}
            onChangeText={(value) => setNoteById((prev) => ({ ...prev, [item.id]: value }))}
            multiline
          />
          {isCompleting ? (
            <Text style={[styles.noteHint, !canComplete && { color: C.red }]}>
              {rapport.length} / 5 min
            </Text>
          ) : null}
        </View>

        {/* Boutons d'action */}
        <View style={styles.actionsRow}>
          {item.status === "NEW" ? (
            <Pressable style={[styles.primaryBtn, { flex: 1 }, isBusy && { opacity: 0.6 }]} onPress={() => acknowledge(item.id)} disabled={isBusy}>
              <Text style={styles.primaryBtnText}>{isBusy ? "..." : "✋ Prendre en charge"}</Text>
            </Pressable>
          ) : nextStatus ? (
            <Pressable
              style={[
                styles.nextBtn,
                { backgroundColor: isCompleting && !canComplete ? C.textLight : (nextCfg.color || ACCENT), flex: 1 },
                (isBusy || (isCompleting && !canComplete)) && { opacity: isCompleting && !canComplete ? 0.5 : 0.6 }
              ]}
              onPress={() => updateProgress(item.id, nextStatus)}
              disabled={isBusy || (isCompleting && !canComplete)}
            >
              <Text style={styles.nextBtnText}>
                {isBusy ? "..." : NEXT_BTN_LABEL[nextStatus] || nextStatus}
              </Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.navBtn} onPress={() => navigateToAlert(item)}>
            <Text style={styles.navBtnText}>🗺️ Naviguer</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderReportCard(item) {
    return (
      <View key={item.id} style={[styles.card, styles.cardReport]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardType}>{item.emergencyType}</Text>
            <Text style={styles.cardReporter}>{item.reporterName || "Demandeur inconnu"}</Text>
          </View>
          <StatusBadge status={item.status} />
        </View>
        <View style={styles.infoGrid}>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>Tel</Text>
            <Text style={[styles.infoVal, { flex: 1 }]}>{item.phoneNumber || "-"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>Position</Text>
            <Text style={[styles.infoVal, { flex: 1 }]}>{item.latitude}, {item.longitude}</Text>
          </View>
          {item.completedAt || item.updatedAt ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>Terminee</Text>
              <Text style={[styles.infoVal, { flex: 1 }]}>{new Date(item.completedAt || item.updatedAt).toLocaleString()}</Text>
            </View>
          ) : null}
        </View>
        {item.teamNote ? (
          <View style={styles.reportBox}>
            <Text style={styles.reportLabel}>📋 Rapport d'intervention</Text>
            <Text style={styles.reportText}>{item.teamNote}</Text>
          </View>
        ) : null}
        {Array.isArray(item.photos) && item.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {item.photos.map((photo, index) => (
              <Image key={`emergency_report_photo_${item.id}_${index}`} source={{ uri: photo }} style={styles.photoThumb} />
            ))}
          </ScrollView>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: ACCENT + "1A" }]}>
          <Text style={styles.headerEmoji}>🚨</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Urgences sanitaires</Text>
          <Text style={styles.headerSub}>
            {loading ? "Chargement..." : `${activeItems.length} active(s) · ${reportItems.length} rapport(s) · 15 s`}
          </Text>
        </View>
      </View>

      {/* Onglets */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabBtn, activeTab === "active" && styles.tabBtnActive]}
          onPress={() => setActiveTab("active")}
        >
          <Text style={[styles.tabBtnText, activeTab === "active" && styles.tabBtnTextActive]}>
            Alertes actives{activeItems.length > 0 ? ` (${activeItems.length})` : ""}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, activeTab === "reports" && [styles.tabBtnActive, { backgroundColor: C.green, borderColor: C.green }]]}
          onPress={() => setActiveTab("reports")}
        >
          <Text style={[styles.tabBtnText, activeTab === "reports" && styles.tabBtnTextActive]}>
            Rapports{reportItems.length > 0 ? ` (${reportItems.length})` : ""}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errBox}>
          <Text style={shared.error}>{error}</Text>
        </View>
      ) : null}

      {/* Onglet alertes actives */}
      {activeTab === "active" ? (
        activeItems.length === 0 && !loading ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>✅</Text>
            <Text style={styles.emptyText}>Aucune alerte active en ce moment.</Text>
          </View>
        ) : (
          activeItems.map(renderAlertCard)
        )
      ) : null}

      {/* Onglet rapports */}
      {activeTab === "reports" ? (
        reportItems.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>Aucun rapport d'intervention pour le moment.</Text>
          </View>
        ) : (
          reportItems.map(renderReportCard)
        )
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { padding: 16, gap: 14, paddingBottom: 32 },

  header:      { flexDirection: "row", alignItems: "center", gap: 14 },
  headerIcon:  { width: 52, height: 52, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  headerEmoji: { fontSize: 26 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: C.textDark },
  headerSub:   { fontSize: 13, color: C.textMuted, marginTop: 2 },

  // Tab bar
  tabBar: { flexDirection: "row", gap: 8 },
  tabBtn: {
    flex: 1, borderRadius: R.sm, borderWidth: 1.5,
    borderColor: ACCENT, paddingVertical: 10,
    alignItems: "center", backgroundColor: C.orangeLight,
  },
  tabBtnActive:     { backgroundColor: ACCENT, borderColor: ACCENT },
  tabBtnText:       { color: ACCENT, fontWeight: "700", fontSize: 13 },
  tabBtnTextActive: { color: "#fff" },

  errBox: { backgroundColor: C.redLight, borderRadius: R.sm, padding: 10, borderWidth: 1, borderColor: C.red + "40" },

  emptyBox:   { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyEmoji: { fontSize: 40 },
  emptyText:  { color: C.textMuted, fontSize: 15 },

  // Alert card
  card: {
    backgroundColor: C.surface, borderRadius: R.md,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 4, borderLeftColor: ACCENT,
    padding: 14, gap: 10, ...S.md,
  },
  cardReport: { borderLeftColor: C.green, opacity: 0.9 },
  cardHeader:   { flexDirection: "row", alignItems: "flex-start" },
  cardType:     { fontSize: 16, fontWeight: "800", color: C.textDark },
  cardReporter: { fontSize: 13, color: C.textMuted, marginTop: 2 },

  infoGrid: { gap: 5 },
  infoRow:  { flexDirection: "row", gap: 8 },
  infoKey:  { fontSize: 12, fontWeight: "700", color: C.textMuted, width: 72 },
  infoVal:  { fontSize: 13, color: C.textMed, fontWeight: "500" },

  mapWrap: { borderRadius: R.sm, overflow: "hidden", borderColor: C.border, borderWidth: 1 },
  map:     { width: "100%", height: 180 },
  photoRow: { gap: 8 },
  photoThumb: { width: 88, height: 88, borderRadius: R.sm, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceAlt },

  // Note / rapport
  noteLabel: { fontSize: 12, fontWeight: "700", color: C.textMed, marginBottom: 6 },
  noteInput: { minHeight: 80 },
  noteHint:  { fontSize: 11, color: C.textMuted, textAlign: "right", marginTop: 2 },

  // Report box (rapports tab)
  reportBox:   { backgroundColor: C.greenLight, borderRadius: R.sm, borderWidth: 1, borderColor: C.green + "40", padding: 12, gap: 4 },
  reportLabel: { fontSize: 12, fontWeight: "800", color: C.green },
  reportText:  { fontSize: 13, color: C.textMed, lineHeight: 20 },

  // Buttons
  actionsRow:     { flexDirection: "row", gap: 8 },
  primaryBtn:     { backgroundColor: ACCENT, borderRadius: R.sm, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", ...S.sm },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  nextBtn:        { borderRadius: R.sm, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", ...S.sm },
  nextBtnText:    { color: "#fff", fontWeight: "800", fontSize: 14 },
  navBtn:         { borderWidth: 1.5, borderColor: C.teal, borderRadius: R.sm, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
  navBtnText:     { color: C.teal, fontWeight: "700", fontSize: 13 },

  badge:     { borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
