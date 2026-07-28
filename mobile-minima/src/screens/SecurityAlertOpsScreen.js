import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const ACCENT = C.primary;

const ALERT_TYPES = {
  AGRESSION:  { label: "Agression",       emoji: "⚠️" },
  ACCIDENT:   { label: "Attroupement",    emoji: "👥" },
  INCENDIE:   { label: "Drogue/Fumoir",   emoji: "🚬" },
  INTRUSION:  { label: "Intrusion",       emoji: "🔓" },
  AUTRE:      { label: "Autre menace",    emoji: "🆘" }
};

const STATUS_CFG = {
  NEW:          { label: "NOUVELLE",        bg: "#EFF6FF", color: C.primary,  border: C.primary  },
  ACKNOWLEDGED: { label: "PRISE EN CHARGE", bg: C.amberLight, color: C.amber, border: C.amber    },
  RESOLVED:     { label: "RESOLUE",         bg: C.greenLight, color: C.green, border: C.green    },
  CLOSED:       { label: "CLOTUREE",        bg: C.border,  color: C.textMuted,border: C.textMuted}
};

const NEXT_STATUS = { NEW: "ACKNOWLEDGED", ACKNOWLEDGED: "RESOLVED", RESOLVED: "CLOSED" };
const NEXT_LABEL  = { NEW: "Prendre en charge", ACKNOWLEDGED: "Marquer resolue", RESOLVED: "Cloturer" };

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status || "-", bg: C.border, color: C.textMuted };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

export function SecurityAlertOpsScreen() {
  const { token, user } = useAuth();
  const [alerts, setAlerts]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [actionId, setActionId]   = useState("");
  const [error, setError]         = useState("");
  const [tab, setTab]             = useState("active");

  async function loadAlerts({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch("/security-alerts", { token });
      setAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(() => loadAlerts({ silent: true }).catch(() => {}), 20000);
    return () => clearInterval(interval);
  }, [token]);

  async function advance(alert) {
    const nextStatus = NEXT_STATUS[alert.status];
    if (!nextStatus) return;
    setActionId(alert.id);
    setError("");
    try {
      await apiFetch(`/security-alerts/${alert.id}`, {
        token, method: "PATCH",
        body: { status: nextStatus }
      });
      await loadAlerts({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setActionId("");
    }
  }

  const activeAlerts   = alerts.filter((a) => !["RESOLVED", "CLOSED"].includes(a.status));
  const resolvedAlerts = alerts.filter((a) =>  ["RESOLVED", "CLOSED"].includes(a.status));
  const displayed      = tab === "active" ? activeAlerts : resolvedAlerts;

  const roleName = String(user?.role || "").toUpperCase();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: ACCENT + "18" }]}>
          <Text style={styles.headerEmoji}>🚔</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Urgences securitaires</Text>
          <Text style={styles.headerSub}>{roleName} - traitement des signalements securitaires</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {[
          { key: "active",   label: `Actives (${activeAlerts.length})`   },
          { key: "resolved", label: `Historique (${resolvedAlerts.length})` }
        ].map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tabBtn, active && { backgroundColor: ACCENT, borderColor: ACCENT }]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabBtnText, active && { color: "#fff" }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={shared.error}>{error}</Text> : null}
      {loading ? <Text style={shared.hint}>Chargement...</Text> : null}

      {displayed.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {tab === "active" ? "Aucune alerte active." : "Aucun historique."}
          </Text>
        </View>
      ) : null}

      {displayed.map((alert) => {
        const typeInfo  = ALERT_TYPES[alert.alertType] || { emoji: "🆘", label: alert.alertType };
        const statusCfg = STATUS_CFG[alert.status] || { border: C.border };
        const nextSt    = NEXT_STATUS[alert.status];
        const busy      = actionId === alert.id;

        return (
          <View key={alert.id} style={[styles.card, { borderLeftColor: statusCfg.border }]}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardType}>{typeInfo.emoji} {typeInfo.label}</Text>
                <Text style={styles.cardLocation}>📍 {alert.locationName}</Text>
              </View>
              <StatusBadge status={alert.status} />
            </View>

            <Text style={styles.cardDesc} numberOfLines={4}>{alert.description}</Text>
            {Array.isArray(alert.photos) && alert.photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                {alert.photos.map((photo, index) => (
                  <Image key={`security_ops_photo_${alert.id}_${index}`} source={{ uri: photo }} style={styles.photoThumb} />
                ))}
              </ScrollView>
            ) : null}

            <View style={styles.cardMeta}>
              <Text style={styles.metaText}>📞 {alert.phoneNumber}</Text>
              {alert.reporterName ? <Text style={styles.metaText}>👤 {alert.reporterName}</Text> : null}
              <Text style={styles.metaText}>🕐 {new Date(alert.createdAt).toLocaleString()}</Text>
              {alert.handlerName ? <Text style={[styles.metaText, { color: C.green }]}>✅ Traite par {alert.handlerName}</Text> : null}
            </View>

            {nextSt ? (
              <Pressable
                style={[styles.actionBtn, { backgroundColor: statusCfg.border }, busy && { opacity: 0.5 }]}
                onPress={() => advance(alert)}
                disabled={busy}
              >
                <Text style={styles.actionBtnText}>{busy ? "..." : NEXT_LABEL[alert.status]}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { padding: 16, gap: 14, paddingBottom: 32 },

  header:      { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 2 },
  headerIcon:  { width: 52, height: 52, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  headerEmoji: { fontSize: 26 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: C.textDark },
  headerSub:   { fontSize: 13, color: C.textMuted, marginTop: 2 },

  tabBar: { flexDirection: "row", gap: 8 },
  tabBtn: {
    flex: 1, borderRadius: R.sm, borderWidth: 1.5,
    borderColor: ACCENT, paddingVertical: 10,
    alignItems: "center", backgroundColor: "#EFF6FF",
  },
  tabBtnText: { color: ACCENT, fontWeight: "700", fontSize: 13 },

  empty:     { alignItems: "center", padding: 28 },
  emptyText: { color: C.textMuted, fontSize: 14 },

  card: {
    backgroundColor: C.surface, borderRadius: R.md,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 4, padding: 14, gap: 10, ...S.sm,
  },
  cardTop:      { flexDirection: "row", alignItems: "flex-start" },
  cardType:     { fontWeight: "700", color: C.textDark, fontSize: 15 },
  cardLocation: { color: C.textMed, fontWeight: "600", fontSize: 13, marginTop: 3 },
  cardDesc:     { color: C.textMuted, fontSize: 13, lineHeight: 18 },
  photoRow: { gap: 8 },
  photoThumb: { width: 88, height: 88, borderRadius: R.sm, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceAlt },

  cardMeta: { gap: 3 },
  metaText: { color: C.textMuted, fontSize: 12 },

  actionBtn: {
    borderRadius: R.sm, paddingVertical: 11,
    alignItems: "center", ...S.sm,
  },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  badge:     { borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
