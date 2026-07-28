import { useMemo, useState } from "react";
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { C, S, shared } from "../theme";

const SECTORS = [
  { icon: "🎓", label: "Education", detail: "ecole, universite, formation" },
  { icon: "🏠", label: "Immobilier", detail: "agence, location, vente" },
  { icon: "🏥", label: "Sante", detail: "hopital, clinique, suivi" },
  { icon: "🛒", label: "Commerce", detail: "boutique, livraison, stock" },
  { icon: "🚌", label: "Transport", detail: "trajets, flotte, reservation" },
  { icon: "🍽️", label: "Hotellerie", detail: "hotel, restaurant, accueil" },
  { icon: "💰", label: "Finance", detail: "paiement, collecte, suivi" },
  { icon: "🎭", label: "Evenementiel", detail: "ticketing, planning, public" },
  { icon: "✳️", label: "Autre", detail: "besoin specifique" },
];

const NEEDS = [
  { icon: "📱", label: "Application mobile", detail: "Android / iPhone" },
  { icon: "💳", label: "Paiement", detail: "mobile money, carte, caisse" },
  { icon: "🔗", label: "API / integration", detail: "connexion entre services" },
  { icon: "🌐", label: "Site web", detail: "vitrine, portail, service" },
  { icon: "📊", label: "Gestion interne", detail: "dashboard, suivi, reporting" },
  { icon: "⚡", label: "Automatisation", detail: "processus repetitifs" },
  { icon: "✳️", label: "Autre", detail: "besoin sur mesure" },
];

const DEADLINES = [
  { icon: "⚡", label: "Immediat" },
  { icon: "📅", label: "Dans 1 mois" },
  { icon: "🗓️", label: "Dans 3 mois" },
];

export function ProjectDigitalizationModal({ visible, onClose }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: user?.fullName || "",
    email: user?.email || "",
    whatsapp: user?.phoneNumber || "",
    sector: "",
    otherSector: "",
    need: "",
    otherNeed: "",
    deadline: "",
    message: "",
  });

  const totalSteps = 4;
  const canGoNext = useMemo(() => {
    if (step === 1) return form.fullName.trim() && form.email.trim();
    if (step === 2) return form.sector.trim();
    if (step === 3) return form.need.trim();
    return true;
  }, [step, form]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function closeAndReset() {
    setStep(1);
    setSubmitting(false);
    onClose?.();
  }

  async function handleSubmit() {
    if (!form.fullName.trim() || !form.email.trim() || !form.sector || !form.need || !form.deadline) {
      Alert.alert("Informations manquantes", "Veuillez remplir les champs obligatoires.");
      return;
    }

    setSubmitting(true);
    try {
      const normalizedFullName = form.fullName.trim();
      const normalizedEmail = form.email.trim();
      const normalizedWhatsapp = form.whatsapp.trim();
      const normalizedSector = form.otherSector ? `${form.sector} - ${form.otherSector.trim()}` : form.sector;
      const normalizedNeed = form.otherNeed ? `${form.need} - ${form.otherNeed.trim()}` : form.need;
      const normalizedMessage = form.message.trim();

      const bodyLines = [
        "Bonjour YEFA Technologie,",
        "",
        "Je souhaite vous soumettre un projet de digitalisation.",
        "",
        `Nom: ${normalizedFullName}`,
        `Email: ${normalizedEmail}`,
        `WhatsApp: ${normalizedWhatsapp || "Non renseigne"}`,
        `Secteur: ${normalizedSector}`,
        `Besoin: ${normalizedNeed}`,
        `Delai: ${form.deadline}`,
        "",
        "Description du projet:",
        normalizedMessage || "Aucun message complementaire.",
        "",
        `Compte application: ${user?.fullName || normalizedFullName}`,
      ];

      const mailtoUrl =
        `mailto:yefa.technologie@gmail.com` +
        `?subject=${encodeURIComponent(`Projet de digitalisation - ${normalizedFullName}`)}` +
        `&body=${encodeURIComponent(bodyLines.join("\n"))}`;

      const supported = await Linking.canOpenURL(mailtoUrl);
      if (!supported) {
        throw new Error("Aucune application mail n'est disponible sur ce telephone.");
      }

      await Linking.openURL(mailtoUrl);
      closeAndReset();
    } catch (error) {
      Alert.alert("Ouverture impossible", error?.message || "Le client mail n'a pas pu etre ouvert.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeAndReset}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.headerEyebrow}>Projet digital</Text>
              <Text style={styles.headerTitle}>Votre projet de digitalisation</Text>
              <Text style={styles.headerSub}>Expliquez votre besoin, YEFA vous recontacte ensuite.</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={closeAndReset}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.progressRow}>
            {[1, 2, 3, 4].map((index) => (
              <View key={index} style={styles.progressItem}>
                <Text style={[styles.progressLabel, step >= index && styles.progressLabelActive]}>Etape {index}</Text>
                <View style={[styles.progressBar, step >= index && styles.progressBarActive]} />
              </View>
            ))}
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {step === 1 ? (
              <View>
                <Text style={shared.sectionLabel}>Qui etes-vous ?</Text>
                <TextInput
                  value={form.fullName}
                  onChangeText={(value) => updateField("fullName", value)}
                  style={shared.input}
                  placeholder="Votre nom complet"
                  placeholderTextColor={C.textLight}
                />
                <TextInput
                  value={form.email}
                  onChangeText={(value) => updateField("email", value)}
                  style={[shared.input, styles.fieldSpacing]}
                  placeholder="Votre email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={C.textLight}
                />
                <TextInput
                  value={form.whatsapp}
                  onChangeText={(value) => updateField("whatsapp", value)}
                  style={[shared.input, styles.fieldSpacing]}
                  placeholder="WhatsApp (optionnel)"
                  keyboardType="phone-pad"
                  placeholderTextColor={C.textLight}
                />
              </View>
            ) : null}

            {step === 2 ? (
              <View>
                <Text style={shared.sectionLabel}>Votre secteur</Text>
                <View style={styles.choiceGrid}>
                  {SECTORS.map((item) => {
                    const active = form.sector === item.label;
                    return (
                      <Pressable
                        key={item.label}
                        style={[styles.choiceCard, active && styles.choiceCardBlue]}
                        onPress={() => updateField("sector", item.label)}
                      >
                        <Text style={styles.choiceIcon}>{item.icon}</Text>
                        <Text style={styles.choiceTitle}>{item.label}</Text>
                        <Text style={styles.choiceDetail}>{item.detail}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {form.sector === "Autre" ? (
                  <TextInput
                    value={form.otherSector}
                    onChangeText={(value) => updateField("otherSector", value)}
                    style={[shared.input, styles.fieldSpacing]}
                    placeholder="Precisez votre secteur"
                    placeholderTextColor={C.textLight}
                  />
                ) : null}
              </View>
            ) : null}

            {step === 3 ? (
              <View>
                <Text style={shared.sectionLabel}>Votre besoin</Text>
                <View style={styles.choiceGrid}>
                  {NEEDS.map((item) => {
                    const active = form.need === item.label;
                    return (
                      <Pressable
                        key={item.label}
                        style={[styles.choiceCard, active && styles.choiceCardGreen]}
                        onPress={() => updateField("need", item.label)}
                      >
                        <Text style={styles.choiceIcon}>{item.icon}</Text>
                        <Text style={styles.choiceTitle}>{item.label}</Text>
                        <Text style={styles.choiceDetail}>{item.detail}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {form.need === "Autre" ? (
                  <TextInput
                    value={form.otherNeed}
                    onChangeText={(value) => updateField("otherNeed", value)}
                    style={[shared.input, styles.fieldSpacing, shared.textArea]}
                    multiline
                    placeholder="Precisez votre besoin"
                    placeholderTextColor={C.textLight}
                  />
                ) : null}
              </View>
            ) : null}

            {step === 4 ? (
              <View>
                <Text style={shared.sectionLabel}>Delai et message</Text>
                <View style={styles.deadlineGrid}>
                  {DEADLINES.map((item) => {
                    const active = form.deadline === item.label;
                    return (
                      <Pressable
                        key={item.label}
                        style={[styles.deadlineCard, active && styles.deadlineCardActive]}
                        onPress={() => updateField("deadline", item.label)}
                      >
                        <Text style={styles.deadlineIcon}>{item.icon}</Text>
                        <Text style={styles.deadlineLabel}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  value={form.message}
                  onChangeText={(value) => updateField("message", value)}
                  style={[shared.input, shared.textArea, styles.fieldSpacing]}
                  multiline
                  placeholder="Parlez-nous de votre projet, de vos objectifs et de vos attentes..."
                  placeholderTextColor={C.textLight}
                />
                <View style={styles.recapBox}>
                  <Text style={styles.recapTitle}>Recapitulatif</Text>
                  <Text style={styles.recapText}>Nom: {form.fullName || "-"}</Text>
                  <Text style={styles.recapText}>Email: {form.email || "-"}</Text>
                  <Text style={styles.recapText}>Secteur: {form.otherSector ? `${form.sector} - ${form.otherSector}` : form.sector || "-"}</Text>
                  <Text style={styles.recapText}>Besoin: {form.otherNeed ? `${form.need} - ${form.otherNeed}` : form.need || "-"}</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {step > 1 ? (
              <Pressable style={styles.prevBtn} onPress={() => setStep((value) => Math.max(1, value - 1))}>
                <Text style={styles.prevBtnText}>Precedent</Text>
              </Pressable>
            ) : (
              <View />
            )}

            {step < totalSteps ? (
              <Pressable
                style={[styles.nextBtn, !canGoNext && styles.disabledBtn]}
                onPress={() => canGoNext && setStep((value) => Math.min(totalSteps, value + 1))}
                disabled={!canGoNext}
              >
                <Text style={styles.nextBtnText}>Suivant</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.nextBtn, submitting && styles.disabledBtn]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                <Text style={styles.nextBtnText}>{submitting ? "Ouverture..." : "Ouvrir dans le mail"}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.68)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "94%",
    overflow: "hidden",
  },
  header: {
    backgroundColor: "#DC2626",
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: { flex: 1 },
  headerEyebrow: { color: "rgba(255,255,255,0.72)", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  headerTitle: { color: "#fff", fontWeight: "900", fontSize: 22, marginTop: 5 },
  headerSub: { color: "rgba(255,255,255,0.88)", fontSize: 13, marginTop: 5, lineHeight: 19 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  progressRow: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  progressItem: { flex: 1, gap: 5 },
  progressLabel: { fontSize: 11, color: C.textLight, textAlign: "center", fontWeight: "700" },
  progressLabelActive: { color: C.red },
  progressBar: { height: 5, borderRadius: 999, backgroundColor: "#E5E7EB" },
  progressBarActive: { backgroundColor: C.red },
  body: { paddingHorizontal: 16, paddingBottom: 18 },
  fieldSpacing: { marginTop: 12 },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  choiceCard: {
    width: "48%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
    padding: 12,
    minHeight: 108,
  },
  choiceCardBlue: { borderColor: C.primary, backgroundColor: C.primaryLight },
  choiceCardGreen: { borderColor: C.green, backgroundColor: C.greenLight },
  choiceIcon: { fontSize: 24, marginBottom: 8 },
  choiceTitle: { color: C.textDark, fontWeight: "800", fontSize: 13, marginBottom: 4 },
  choiceDetail: { color: C.textMuted, fontSize: 11, lineHeight: 15 },
  deadlineGrid: { flexDirection: "row", gap: 10 },
  deadlineCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  deadlineCardActive: { borderColor: "#F59E0B", backgroundColor: "#FFF7D6" },
  deadlineIcon: { fontSize: 24, marginBottom: 6 },
  deadlineLabel: { color: C.textMed, fontWeight: "800", fontSize: 12, textAlign: "center" },
  recapBox: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.borderDark,
    backgroundColor: C.surfaceAlt,
    padding: 14,
  },
  recapTitle: { color: C.textDark, fontWeight: "800", marginBottom: 8 },
  recapText: { color: C.textMuted, fontSize: 12, marginBottom: 4 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  prevBtn: {
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  prevBtnText: { color: C.textMed, fontWeight: "800" },
  nextBtn: {
    backgroundColor: C.red,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
    ...S.sm,
  },
  nextBtnText: { color: "#fff", fontWeight: "800" },
  disabledBtn: { opacity: 0.55 },
});
