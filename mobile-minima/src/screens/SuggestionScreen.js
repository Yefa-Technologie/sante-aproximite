import * as Location from "expo-location";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch, trackEvent } from "../api/client";
import { loadCenterCatalog, syncCenterCatalog } from "../storage/centerCatalog";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

function haversineKm(lat1, lon1, lat2, lon2) {
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function SuggestionScreen() {
  const { token } = useAuth();
  const [centers, setCenters] = useState([]);
  const [mySuggestions, setMySuggestions] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCenter, setSelectedCenter] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [coords, setCoords] = useState(null);

  async function loadData({ silent = false } = {}) {
    try {
      if (!silent) setError("");
      const catalog = await loadCenterCatalog(token);
      setCenters(Array.isArray(catalog?.centers) ? catalog.centers : []);
      try {
        const mine = await apiFetch("/suggestions/mine", { token });
        setMySuggestions(Array.isArray(mine) ? mine : []);
      } catch (err) {
        if (!silent) setError(err.message);
      }
      syncCenterCatalog(token)
        .then((nextCatalog) => setCenters(Array.isArray(nextCatalog?.centers) ? nextCatalog.centers : []))
        .catch(() => {});
    } catch (err) {
      if (!silent) setError(err.message);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(() => { loadData({ silent: true }).catch(() => {}); }, 30000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const current = await Location.getCurrentPositionAsync({});
        setCoords({ lat: current.coords.latitude, lon: current.coords.longitude });
      } catch {
        // localisation indisponible, on garde la liste non triee
      }
    })();
  }, []);

  const centersWithDistance = useMemo(() => {
    if (!coords) return centers;
    return centers
      .map((center) => {
        const lat = Number(center?.location?.coordinates?.[1]);
        const lon = Number(center?.location?.coordinates?.[0]);
        const distanceKm = Number.isFinite(lat) && Number.isFinite(lon)
          ? Number(haversineKm(coords.lat, coords.lon, lat, lon).toFixed(2))
          : null;
        return { ...center, distanceKm };
      })
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }, [centers, coords]);

  const filteredCenters = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return centersWithDistance.slice(0, 20);
    return centersWithDistance.filter((center) =>
      center.name.toLowerCase().includes(q) || center.address.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [centersWithDistance, search]);

  const canSubmit = message.trim().length > 9 && !!selectedCenter;

  async function submitSuggestion() {
    setError("");
    setSuccess("");
    if (!selectedCenter) { setError("Selectionnez un centre de sante"); return; }
    if (!message.trim()) { setError("Le message est obligatoire"); return; }
    setLoading(true);
    try {
      await apiFetch(`/centers/${selectedCenter._id}/suggestions`, {
        token,
        method: "POST",
        body: { message: message.trim() }
      });
      setSuccess("Observation envoyee avec succes");
      const mine = await apiFetch("/suggestions/mine", { token });
      setMySuggestions(Array.isArray(mine) ? mine : []);
      trackEvent("suggestions", "submit", { centerId: selectedCenter._id });
      setMessage("");
      setSelectedCenter(null);
      setSearch("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Observation / Suggestion</Text>
        <Text style={styles.subtitle}>Partagez une remarque ou une idee d'amelioration au sujet d'un centre de sante.</Text>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroRow}>
          <View style={styles.heroIcon}>
            <Text style={styles.heroIconText}>💡</Text>
          </View>
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroTitle}>Votre avis compte</Text>
            <Text style={styles.heroSubtitle}>L'etablissement concerne verra votre observation dans son espace de gestion.</Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Selection du centre</Text>
          <Text style={styles.sectionCaption}>Cherchez puis touchez un centre.</Text>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Nom du centre ou adresse..."
          placeholderTextColor={C.textLight}
          value={search}
          onChangeText={setSearch}
        />
        {selectedCenter ? (
          <View style={styles.selectedCenterBox}>
            <View style={styles.selectedCenterInfo}>
              <Text style={styles.selectedCenterTag}>Centre selectionne</Text>
              <Text style={styles.selectedCenterName}>{selectedCenter.name}</Text>
              <Text style={styles.selectedCenterAddr}>{selectedCenter.address}</Text>
            </View>
            <Pressable style={styles.changeCenterBtn} onPress={() => setSelectedCenter(null)}>
              <Text style={styles.changeCenterBtnText}>Changer</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.centerPickerPanel}>
            <View style={styles.centerPickerHeader}>
              <Text style={styles.centerPickerTitle}>
                {search.trim() ? "Resultats trouves" : "Centres suggeres"}
              </Text>
              <Text style={styles.centerPickerCount}>{filteredCenters.length}</Text>
            </View>
            <ScrollView
              style={styles.centerList}
              contentContainerStyle={styles.centerListContentWrap}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {filteredCenters.map((center) => (
                <Pressable
                  key={center._id}
                  style={styles.centerListItem}
                  onPress={() => setSelectedCenter(center)}
                >
                  <View style={styles.centerListTop}>
                    <View style={styles.centerBullet} />
                    <View style={styles.centerListContent}>
                      <Text style={styles.centerListName}>{center.name}</Text>
                      <Text style={styles.centerListAddr}>
                        {center.address}{center.distanceKm != null ? ` · ${center.distanceKm} km` : ""}
                      </Text>
                    </View>
                    <View style={styles.centerSelectPill}>
                      <Text style={styles.centerSelectText}>Choisir</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
              {filteredCenters.length === 0 ? (
                <View style={styles.centerEmptyState}>
                  <Text style={styles.centerEmptyTitle}>Aucun centre trouve</Text>
                  <Text style={styles.centerEmptyText}>Essayez un autre mot-cle.</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        )}
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Votre observation</Text>
          <Text style={styles.sectionCaption}>Decrivez votre remarque ou votre suggestion d'amelioration.</Text>
        </View>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Ecrivez votre observation ou suggestion..."
          placeholderTextColor={C.textLight}
          value={message}
          onChangeText={setMessage}
          multiline
        />
        <View style={styles.counterRow}>
          <Text style={styles.counterHint}>Plus vous etes precis, plus votre retour est utile.</Text>
          <Text style={styles.counterValue}>{message.trim().length} car.</Text>
        </View>
      </View>

      {error   ? <Text style={styles.errorMsg}>{error}</Text>   : null}
      {success ? <Text style={styles.successMsg}>{success}</Text> : null}

      <Pressable
        style={[styles.submitBtn, (!canSubmit || loading) && styles.submitBtnDisabled]}
        onPress={submitSuggestion}
        disabled={!canSubmit || loading}
      >
        <Text style={styles.submitBtnText}>{loading ? "Envoi en cours..." : "Envoyer l'observation"}</Text>
      </Pressable>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Mes observations</Text>
          <Text style={styles.sectionCaption}>Historique de vos observations et suggestions envoyees.</Text>
        </View>

        {mySuggestions.length === 0 ? (
          <View style={styles.emptyHistoryBox}>
            <Text style={styles.emptyHistoryTitle}>Aucune observation pour le moment</Text>
            <Text style={styles.emptyHistoryText}>Vos observations envoyees apparaitront ici.</Text>
          </View>
        ) : null}

        {mySuggestions.map((item) => (
          <View key={item.id} style={styles.suggestionCard}>
            <View style={styles.suggestionCardHeader}>
              <Text style={styles.suggestionCenter}>{item.centerName || "Centre inconnu"}</Text>
              <View style={[styles.readBadge, item.isRead ? styles.readBadgeRead : styles.readBadgeUnread]}>
                <Text style={[styles.readBadgeText, { color: item.isRead ? C.green : C.amber }]}>
                  {item.isRead ? "Lue" : "Non lue"}
                </Text>
              </View>
            </View>
            <Text style={styles.suggestionMeta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            <Text style={styles.suggestionBody}>{item.message}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { padding: 14, gap: 14, paddingBottom: 32 },

  header:   { gap: 4 },
  title:    { fontSize: 20, fontWeight: "800", color: C.textDark },
  subtitle: { fontSize: 13, color: C.textMuted },

  heroCard: {
    backgroundColor: "#102542",
    borderRadius: R.lg,
    padding: 16,
    ...S.md,
  },
  heroRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#f59e0b",
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconText: { fontSize: 20 },
  heroTextWrap: { flex: 1, gap: 2 },
  heroTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  heroSubtitle: { color: "rgba(255,255,255,0.78)", fontSize: 12.5, lineHeight: 18 },

  sectionCard: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
    ...S.sm,
  },
  sectionHead: { gap: 4, marginBottom: 2 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: C.textDark },
  sectionCaption: { fontSize: 12.5, color: C.textMuted, lineHeight: 18 },
  input: { ...shared.input },
  textArea: { ...shared.input, ...shared.textArea },

  selectedCenterBox: {
    backgroundColor: C.primaryLight,
    borderRadius: R.sm,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectedCenterInfo:  { flex: 1 },
  selectedCenterTag: { color: C.primary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  selectedCenterName:  { fontWeight: "700", color: C.primary, fontSize: 14 },
  selectedCenterAddr:  { fontSize: 12, color: C.textMuted, marginTop: 2 },
  changeCenterBtn: {
    borderWidth: 1,
    borderColor: C.primary,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  changeCenterBtnText: { color: C.primary, fontWeight: "600", fontSize: 12 },

  centerPickerPanel: {
    backgroundColor: C.surfaceAlt,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    gap: 8,
  },
  centerPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  centerPickerTitle: { color: C.textDark, fontWeight: "800", fontSize: 13 },
  centerPickerCount: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.primaryLight,
    color: C.primary,
    textAlign: "center",
    textAlignVertical: "center",
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 28,
    overflow: "hidden",
  },
  centerList: { maxHeight: 240 },
  centerListContentWrap: { gap: 8 },
  centerListItem: {
    backgroundColor: C.surface,
    borderRadius: R.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    ...S.sm,
  },
  centerListTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  centerBullet: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.primary,
  },
  centerListContent: { flex: 1 },
  centerListName: { fontWeight: "700", color: C.textDark, fontSize: 13 },
  centerListAddr: { color: C.textMuted, fontSize: 12, marginTop: 2 },
  centerSelectPill: {
    backgroundColor: C.primaryLight,
    borderRadius: R.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  centerSelectText: { color: C.primary, fontWeight: "700", fontSize: 12 },
  centerEmptyState: {
    backgroundColor: C.surface,
    borderRadius: R.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.borderDark,
    padding: 14,
    gap: 4,
    alignItems: "center",
  },
  centerEmptyTitle: { color: C.textDark, fontWeight: "700", fontSize: 13 },
  centerEmptyText: { color: C.textMuted, fontSize: 12, textAlign: "center", lineHeight: 17 },

  counterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  counterHint: { color: C.textMuted, fontSize: 11.5, flex: 1 },
  counterValue: { color: C.primary, fontWeight: "700", fontSize: 12 },

  submitBtn: {
    backgroundColor: C.primary,
    borderRadius: R.md,
    paddingVertical: 15,
    alignItems: "center",
    ...S.sm,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  errorMsg:   { ...shared.error,   backgroundColor: "#FEF2F2", padding: 10, borderRadius: R.sm },
  successMsg: { ...shared.success, backgroundColor: "#ECFDF5", padding: 10, borderRadius: R.sm },

  emptyHistoryBox: {
    backgroundColor: C.surfaceAlt,
    borderRadius: R.sm,
    padding: 14,
    gap: 5,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyHistoryTitle: { color: C.textDark, fontWeight: "700", fontSize: 13 },
  emptyHistoryText: { color: C.textMuted, fontSize: 12.5, lineHeight: 18 },

  suggestionCard: {
    backgroundColor: C.bg,
    borderRadius: R.sm,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  suggestionCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  suggestionCenter: { flex: 1, fontWeight: "700", color: C.textDark, fontSize: 14 },
  suggestionMeta:    { fontSize: 12, color: C.textMuted },
  suggestionBody:    { fontSize: 13, color: C.textMed, lineHeight: 19 },

  readBadge: {
    borderRadius: R.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  readBadgeRead:   { backgroundColor: C.greenLight },
  readBadgeUnread: { backgroundColor: C.amberLight },
  readBadgeText:   { fontSize: 10, fontWeight: "700" },
});
