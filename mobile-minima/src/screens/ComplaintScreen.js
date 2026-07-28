import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch, getPendingRequests, trackEvent } from "../api/client";
import { loadCenterCatalog, syncCenterCatalog } from "../storage/centerCatalog";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const QUICK_SUBJECTS = ["Accueil", "Temps d'attente", "Proprete", "Tarification", "Disponibilite des soins"];

const STATUS_CONFIG = {
  NEW:         { label: "NOUVELLE",    color: C.statusNew,        bg: C.statusNewBg        },
  IN_PROGRESS: { label: "EN COURS",    color: C.statusInProgress, bg: C.statusInProgressBg },
  RESOLVED:    { label: "RESOLUE",     color: C.statusResolved,   bg: C.statusResolvedBg   },
  REJECTED:    { label: "REJETEE",     color: C.statusRejected,   bg: C.statusRejectedBg   },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status || "-", color: C.textMuted, bg: C.bg };
  return (
    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.statusBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function toOfflineComplaint(queueItem, centers) {
  const centerId = queueItem?.body?.centerId || null;
  const matchedCenter = Array.isArray(centers)
    ? centers.find((center) => String(center?._id || "") === String(centerId || ""))
    : null;
  return {
    id: `offline_${queueItem.createdAt}_${queueItem.body?.subject || "complaint"}`,
    subject: String(queueItem?.body?.subject || "Plainte hors ligne"),
    message: String(queueItem?.body?.message || ""),
    centerName: matchedCenter?.name || null,
    status: "IN_PROGRESS",
    updates: [
      {
        id: `offline_update_${queueItem.createdAt}`,
        message: "Plainte enregistree hors ligne. Synchronisation en attente."
      }
    ],
    createdAt: queueItem?.createdAt || new Date().toISOString(),
    isOfflinePending: true
  };
}

export function ComplaintScreen({ defaultHistoryTab = "ACTIVE", hideForm = false, hideHistory = false }) {
  const { token } = useAuth();
  const [centers, setCenters] = useState([]);
  const [myComplaints, setMyComplaints] = useState([]);
  const [complaintType, setComplaintType] = useState("WITH_CENTER");
  const [search, setSearch] = useState("");
  const [selectedCenter, setSelectedCenter] = useState(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedbackLoadingComplaintId, setFeedbackLoadingComplaintId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [historyTab, setHistoryTab] = useState(defaultHistoryTab);

  async function loadData({ silent = false } = {}) {
    try {
      if (!silent) setError("");
      const catalog = await loadCenterCatalog(token);
      setCenters(Array.isArray(catalog?.centers) ? catalog.centers : []);
      const queue = await getPendingRequests();
      const offlineComplaints = queue
        .filter((item) => item?.path === "/complaints" && String(item?.method || "").toUpperCase() === "POST")
        .map((item) => toOfflineComplaint(item, catalog?.centers || []));
      let complaintData = [];
      try {
        complaintData = await apiFetch("/complaints/mine", { token });
      } catch (err) {
        if (!silent && offlineComplaints.length === 0) {
          setError(err.message);
        }
      }
      setMyComplaints([...(Array.isArray(complaintData) ? complaintData : []), ...offlineComplaints]);
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

  const filteredCenters = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return centers.slice(0, 20);
    return centers.filter((center) =>
      center.name.toLowerCase().includes(q) || center.address.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [centers, search]);

  const needsCenter = complaintType === "WITH_CENTER";
  const canSubmit = subject.trim().length > 2 && message.trim().length > 9 && (!needsCenter || !!selectedCenter);
  const activeComplaints   = myComplaints.filter((item) => !["RESOLVED", "REJECTED"].includes(item.status));
  const resolvedComplaints = myComplaints.filter((item) =>  ["RESOLVED", "REJECTED"].includes(item.status));
  const displayedComplaints = historyTab === "RESOLVED" ? resolvedComplaints : activeComplaints;
  const selectedSubjectPreset = QUICK_SUBJECTS.includes(subject) ? subject : "";

  async function submitComplaint() {
    setError("");
    setSuccess("");
    if (!subject.trim() || !message.trim()) { setError("Sujet et message sont obligatoires"); return; }
    if (needsCenter && !selectedCenter) { setError("Selectionnez un centre ou passez en plainte generale"); return; }
    setLoading(true);
    try {
      const result = await apiFetch("/complaints", {
        token,
        method: "POST",
        body: {
          centerId: needsCenter ? selectedCenter?._id ?? null : null,
          subject: subject.trim(),
          message: message.trim()
        }
      });
      if (result?.queued) {
        setSuccess(result.message || "Plainte enregistree hors ligne.");
        const queuedComplaint = toOfflineComplaint(
          {
            path: "/complaints",
            method: "POST",
            body: {
              centerId: needsCenter ? selectedCenter?._id ?? null : null,
              subject: subject.trim(),
              message: message.trim()
            },
            createdAt: new Date().toISOString()
          },
          centers
        );
        setMyComplaints((prev) => [queuedComplaint, ...prev]);
      } else {
        setSuccess("Plainte envoyee avec succes");
        const mine = await apiFetch("/complaints/mine", { token });
        setMyComplaints(mine);
      }
      trackEvent("complaints", "submit", {
        queued: !!result?.queued,
        withCenter: needsCenter,
        centerId: needsCenter ? selectedCenter?._id ?? null : null,
      });
      setSubject("");
      setMessage("");
      if (needsCenter) { setSelectedCenter(null); setSearch(""); }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitComplaintFeedback(complaintId, status) {
    setError("");
    setSuccess("");
    setFeedbackLoadingComplaintId(complaintId);
    try {
      await apiFetch(`/complaints/${complaintId}/feedback`, {
        token,
        method: "POST",
        body: { status }
      });
      trackEvent("complaints_tracking", "submit_feedback", { complaintId, status });
      setSuccess("Validation enregistree");
      const mine = await apiFetch("/complaints/mine", { token });
      setMyComplaints(mine);
    } catch (err) {
      setError(err.message);
    } finally {
      setFeedbackLoadingComplaintId("");
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {!hideForm ? (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>Poser une plainte</Text>
            <Text style={styles.subtitle}>Choisissez un type, decrivez la situation et l'application s'occupe du reste, meme hors ligne.</Text>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroRow}>
              <View style={styles.heroIcon}>
                <Text style={styles.heroIconText}>!</Text>
              </View>
              <View style={styles.heroTextWrap}>
                <Text style={styles.heroTitle}>Signalement rapide</Text>
                <Text style={styles.heroSubtitle}>Votre message est enregistre et synchronise automatiquement.</Text>
              </View>
            </View>

            <View style={styles.modeGrid}>
              <Pressable
                style={[styles.modeCard, complaintType === "WITH_CENTER" && styles.modeCardActive]}
                onPress={() => setComplaintType("WITH_CENTER")}
              >
                <Text style={styles.modeEmoji}>🏥</Text>
                <Text style={[styles.modeCardTitle, complaintType === "WITH_CENTER" && styles.modeCardTitleActive]}>
                  Centre cible
                </Text>
                <Text style={[styles.modeCardDesc, complaintType === "WITH_CENTER" && styles.modeCardDescActive]}>
                  Liee a un etablissement precis
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeCard, complaintType === "GENERAL" && styles.modeCardActive]}
                onPress={() => setComplaintType("GENERAL")}
              >
                <Text style={styles.modeEmoji}>📝</Text>
                <Text style={[styles.modeCardTitle, complaintType === "GENERAL" && styles.modeCardTitleActive]}>
                  Generale
                </Text>
                <Text style={[styles.modeCardDesc, complaintType === "GENERAL" && styles.modeCardDescActive]}>
                  Remontee globale sur le service
                </Text>
              </Pressable>
            </View>
          </View>

          {needsCenter ? (
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
                  <Text style={styles.centerPickerHint}>
                    Touchez une carte pour associer la plainte au bon etablissement.
                  </Text>
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
                            <Text style={styles.centerListAddr}>{center.address}</Text>
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
                        <Text style={styles.centerEmptyText}>Essayez un autre mot-cle ou basculez sur plainte generale.</Text>
                      </View>
                    ) : null}
                  </ScrollView>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.infoBox}>
              <Text style={styles.infoBoxText}>Cette plainte sera enregistree comme remarque generale sur le systeme de soins.</Text>
            </View>
          )}

          <View style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Sujet de la plainte</Text>
              <Text style={styles.sectionCaption}>Touchez un theme ou saisissez votre propre sujet.</Text>
            </View>
            <View style={styles.quickSubjects}>
              {QUICK_SUBJECTS.map((item) => (
                <Pressable
                  key={item}
                  style={[styles.quickChip, selectedSubjectPreset === item && styles.quickChipActive]}
                  onPress={() => setSubject(item)}
                >
                  <Text style={[styles.quickChipText, selectedSubjectPreset === item && styles.quickChipTextActive]}>{item}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Ou saisissez un sujet libre..."
              placeholderTextColor={C.textLight}
              value={subject}
              onChangeText={setSubject}
            />
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Description detaillee</Text>
              <Text style={styles.sectionCaption}>Expliquez ce qui s'est passe, ou et depuis quand.</Text>
            </View>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Decrivez precisement le probleme rencontre..."
              placeholderTextColor={C.textLight}
              value={message}
              onChangeText={setMessage}
              multiline
            />
            <View style={styles.counterRow}>
              <Text style={styles.counterHint}>Plus vous etes precis, plus le traitement est rapide.</Text>
              <Text style={styles.counterValue}>{message.trim().length} car.</Text>
            </View>
          </View>

          {error   ? <Text style={styles.errorMsg}>{error}</Text>   : null}
          {success ? <Text style={styles.successMsg}>{success}</Text> : null}

          <Pressable
            style={[styles.submitBtn, (!canSubmit || loading) && styles.submitBtnDisabled]}
            onPress={submitComplaint}
            disabled={!canSubmit || loading}
          >
            <Text style={styles.submitBtnText}>{loading ? "Envoi en cours..." : "Envoyer la plainte"}</Text>
          </Pressable>
        </>
      ) : null}

      {/* History */}
      {!hideHistory ? (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Suivi de mes plaintes</Text>
            <Text style={styles.sectionCaption}>Retrouvez vos signalements en cours et ceux deja traites.</Text>
          </View>
          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tab, historyTab === "ACTIVE" && styles.tabActive]}
              onPress={() => setHistoryTab("ACTIVE")}
            >
              <Text style={[styles.tabText, historyTab === "ACTIVE" && styles.tabTextActive]}>
                En cours ({activeComplaints.length})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, historyTab === "RESOLVED" && styles.tabActive]}
              onPress={() => setHistoryTab("RESOLVED")}
            >
              <Text style={[styles.tabText, historyTab === "RESOLVED" && styles.tabTextActive]}>
                Resolues ({resolvedComplaints.length})
              </Text>
            </Pressable>
          </View>

          {displayedComplaints.length === 0 ? (
            <View style={styles.emptyHistoryBox}>
              <Text style={styles.emptyHistoryTitle}>Aucune plainte ici pour le moment</Text>
              <Text style={styles.emptyHistoryText}>Les nouveaux signalements apparaitront automatiquement dans cette section.</Text>
            </View>
          ) : null}

          {displayedComplaints.map((item) => (
            <View key={item.id} style={styles.complaintCard}>
              <View style={styles.complaintCardHeader}>
                <Text style={styles.complaintSubject}>{item.subject}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.complaintMeta}>
                {item.centerName || "Plainte generale"} · {new Date(item.createdAt).toLocaleDateString()}
              </Text>
              <Text style={styles.complaintBody}>{item.message}</Text>
              {item.isOfflinePending ? (
                <View style={styles.pendingSyncTag}>
                  <Text style={styles.pendingSyncTagText}>En attente de synchronisation</Text>
                </View>
              ) : null}
              {Array.isArray(item.updates) && item.updates.length > 0 ? (
                <View style={styles.updatesList}>
                  {item.updates.map((u) => (
                    <View key={u.id} style={styles.updateItem}>
                      <View style={styles.updateDot} />
                      <Text style={styles.updateText}>{u.message}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {["RESOLVED", "REJECTED"].includes(item.status) ? (
                item.userFeedbackStatus ? (
                  <View style={[
                    styles.feedbackTag,
                    { backgroundColor: item.userFeedbackStatus === "SATISFIED" ? C.greenLight : C.redLight }
                  ]}>
                    <Text style={[
                      styles.feedbackTagText,
                      { color: item.userFeedbackStatus === "SATISFIED" ? C.green : C.red }
                    ]}>
                      {item.userFeedbackStatus === "SATISFIED" ? "Satisfait" : "Insatisfait"}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.feedbackActions}>
                    <Text style={[shared.hint, { marginBottom: 6 }]}>Votre avis sur le traitement :</Text>
                    <View style={styles.feedbackBtns}>
                      <Pressable
                        style={styles.feedbackBtnSatisfied}
                        onPress={() => submitComplaintFeedback(item.id, "SATISFIED")}
                      >
                        <Text style={styles.feedbackBtnText}>
                          {feedbackLoadingComplaintId === item.id ? "..." : "Satisfait"}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.feedbackBtnUnsatisfied}
                        onPress={() => submitComplaintFeedback(item.id, "UNSATISFIED")}
                      >
                        <Text style={styles.feedbackBtnText}>
                          {feedbackLoadingComplaintId === item.id ? "..." : "Insatisfait"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
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
    gap: 14,
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
  heroIconText: { color: "#fff", fontWeight: "900", fontSize: 22 },
  heroTextWrap: { flex: 1, gap: 2 },
  heroTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  heroSubtitle: { color: "rgba(255,255,255,0.78)", fontSize: 12.5, lineHeight: 18 },
  modeGrid: { flexDirection: "row", gap: 10 },
  modeCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 12,
    gap: 6,
  },
  modeCardActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  modeEmoji: { fontSize: 20 },
  modeCardTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },
  modeCardTitleActive: { color: C.textDark },
  modeCardDesc: { color: "rgba(255,255,255,0.75)", fontSize: 12, lineHeight: 17 },
  modeCardDescActive: { color: C.textMuted },

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
  sectionLabel: shared.sectionLabel,
  input: { ...shared.input },
  textArea: { ...shared.input, ...shared.textArea },

  infoBox: {
    backgroundColor: C.primaryLight,
    borderRadius: R.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: C.primary + "33",
  },
  infoBoxText: { color: C.primary, fontWeight: "600", fontSize: 13 },

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

  centerList: { gap: 6, maxHeight: 200 },
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
  centerPickerHint: { color: C.textMuted, fontSize: 12, lineHeight: 17 },
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

  quickSubjects: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: C.bg,
  },
  quickChipActive:    { backgroundColor: C.primary, borderColor: C.primary },
  quickChipText:      { color: C.textMed, fontWeight: "600", fontSize: 12 },
  quickChipTextActive:{ color: "#fff" },
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

  tabRow: { flexDirection: "row", gap: 8 },
  tab: {
    flex: 1,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: C.bg,
  },
  tabActive:    { backgroundColor: C.primary, borderColor: C.primary },
  tabText:      { color: C.textMed, fontWeight: "700", fontSize: 13 },
  tabTextActive:{ color: "#fff" },
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

  complaintCard: {
    backgroundColor: C.bg,
    borderRadius: R.sm,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  complaintCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  complaintSubject: { flex: 1, fontWeight: "700", color: C.textDark, fontSize: 14 },
  complaintMeta:    { fontSize: 12, color: C.textMuted },
  complaintBody:    { fontSize: 13, color: C.textMed, lineHeight: 19 },

  statusBadge: {
    borderRadius: R.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: { fontSize: 10, fontWeight: "700" },

  updatesList: { gap: 4, paddingLeft: 4 },
  updateItem:  { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  updateDot:   { width: 5, height: 5, borderRadius: 3, backgroundColor: C.border, marginTop: 5 },
  updateText:  { flex: 1, fontSize: 12, color: C.textMed },

  feedbackTag: {
    alignSelf: "flex-start",
    borderRadius: R.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  feedbackTagText: { fontSize: 12, fontWeight: "700" },
  pendingSyncTag: {
    alignSelf: "flex-start",
    backgroundColor: C.amberLight,
    borderRadius: R.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pendingSyncTagText: { color: C.amber, fontSize: 12, fontWeight: "700" },

  feedbackActions: { gap: 6 },
  feedbackBtns: { flexDirection: "row", gap: 8 },
  feedbackBtnSatisfied: {
    flex: 1,
    backgroundColor: C.green,
    borderRadius: R.sm,
    paddingVertical: 8,
    alignItems: "center",
  },
  feedbackBtnUnsatisfied: {
    flex: 1,
    backgroundColor: C.red,
    borderRadius: R.sm,
    paddingVertical: 8,
    alignItems: "center",
  },
  feedbackBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
