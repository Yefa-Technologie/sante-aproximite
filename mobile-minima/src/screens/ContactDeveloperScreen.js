import { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { C, S, shared } from "../theme";

export function ContactDeveloperScreen() {
  const { user } = useAuth();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || "");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => subject.trim().length >= 3 && message.trim().length >= 10 && !submitting,
    [subject, message, submitting]
  );

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const bodyLines = [
        `Nom: ${user?.fullName || "Utilisateur mobile"}`,
        `Email: ${user?.email || "Non renseigne"}`,
        `Telephone: ${phoneNumber.trim() || "Non renseigne"}`,
        "",
        "Message:",
        message.trim(),
      ];
      const mailtoUrl =
        `mailto:yefa.technologie@gmail.com` +
        `?subject=${encodeURIComponent(subject.trim())}` +
        `&body=${encodeURIComponent(bodyLines.join("\n"))}`;

      const supported = await Linking.canOpenURL(mailtoUrl);
      if (!supported) {
        throw new Error("Aucune application mail n'est disponible sur ce telephone.");
      }

      await Linking.openURL(mailtoUrl);
      setSubject("");
      setMessage("");
    } catch (error) {
      Alert.alert("Ouverture impossible", error?.message || "Le client mail n'a pas pu etre ouvert.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Support direct</Text>
          </View>
          <Text style={styles.heroTitle}>Contacter le developpeur</Text>
          <Text style={styles.heroText}>
            Saisissez votre message puis ouvrez Gmail ou l'application mail du telephone avec un brouillon
            deja prepare pour YEFA Technologie.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={shared.sectionLabel}>Vos coordonnees</Text>
          <View style={styles.identityBox}>
            <Text style={styles.identityName}>{user?.fullName || "Utilisateur mobile"}</Text>
            <Text style={styles.identityEmail}>{user?.email || "Email non renseigne"}</Text>
          </View>

          <Text style={shared.sectionLabel}>Telephone</Text>
          <TextInput
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            style={shared.input}
            placeholder="Numero WhatsApp ou appel"
            keyboardType="phone-pad"
            placeholderTextColor={C.textLight}
          />

          <Text style={[shared.sectionLabel, styles.sectionSpacing]}>Sujet</Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            style={shared.input}
            placeholder="Ex: Bug, assistance, suggestion"
            placeholderTextColor={C.textLight}
          />

          <Text style={[shared.sectionLabel, styles.sectionSpacing]}>Message</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            style={[shared.input, shared.textArea]}
            multiline
            placeholder="Decrivez clairement votre besoin..."
            placeholderTextColor={C.textLight}
          />

          <Pressable
            style={[styles.submitBtn, (!canSubmit || submitting) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            <Text style={styles.submitBtnText}>{submitting ? "Ouverture..." : "Ouvrir dans le mail du telephone"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 14, gap: 14 },
  hero: {
    backgroundColor: "#FFF7D6",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#FACC15",
    ...S.md,
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FEF08A",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 10,
  },
  heroBadgeText: { color: "#854D0E", fontWeight: "800", fontSize: 11, textTransform: "uppercase" },
  heroTitle: { color: C.textDark, fontSize: 24, fontWeight: "900", marginBottom: 8 },
  heroText: { color: C.textMed, fontSize: 14, lineHeight: 21 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    ...S.sm,
  },
  identityBox: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  identityName: { color: C.textDark, fontSize: 16, fontWeight: "800" },
  identityEmail: { color: C.textMuted, fontSize: 13, marginTop: 4 },
  sectionSpacing: { marginTop: 16 },
  submitBtn: {
    marginTop: 20,
    backgroundColor: "#D4A100",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    ...S.md,
  },
  submitBtnDisabled: { opacity: 0.55 },
  submitBtnText: { color: "#1F2937", fontWeight: "900", fontSize: 15 },
});
