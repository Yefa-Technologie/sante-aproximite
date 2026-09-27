import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../api/client";
import { C, R, S } from "../theme";

const ROLE_LABELS = {
  USER: "Utilisateur public",
  ETABLISSEMENT: "Etablissement de sante",
  CHEF_ETABLISSEMENT: "Chef d'etablissement",
  DISTRICT: "District sanitaire",
  REGION: "Direction regionale",
  NATIONAL: "Niveau national",
  REGULATOR: "Regulateur",
  SAMU: "SAMU",
  SAPEUR_POMPIER: "Sapeurs-pompiers",
  POLICE: "Police",
  GENDARMERIE: "Gendarmerie",
  PROTECTION_CIVILE: "Protection civile",
  DEVELOPER: "Developpeur",
};

function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 10);
}

export function ProfileScreen() {
  const { user, token, updateProfile } = useAuth();
  const [form, setForm] = useState({
    fullName: user?.fullName || "",
    email: user?.email || "",
    phoneNumber: normalizePhone(user?.phoneNumber),
  });
  const [initial, setInitial] = useState(form);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isPublicUser = String(user?.role || "").toUpperCase() === "USER";

  useEffect(() => {
    let active = true;
    apiFetch("/auth/profile", { token }).then((data) => {
      if (!active) return;
      const next = {
        fullName: data.fullName || "",
        email: data.email || "",
        phoneNumber: normalizePhone(data.phoneNumber),
      };
      setForm(next);
      setInitial(next);
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const emailChanged = form.email.trim().toLowerCase() !== initial.email.trim().toLowerCase();
  const needsCurrentPassword = showPasswordForm || (emailChanged && Boolean(initial.email));

  async function save() {
    if (saving) return;
    setError(""); setMessage("");
    const fullName = form.fullName.trim();
    if (fullName.length < 2 || fullName.length > 120) {
      setError("Le nom doit contenir entre 2 et 120 caracteres."); return;
    }
    if (form.phoneNumber && form.phoneNumber.length !== 10) {
      setError("Le numero de telephone doit contenir 10 chiffres."); return;
    }
    if (showPasswordForm) {
      if (passwords.next.length < 6) { setError("Le nouveau mot de passe doit contenir au moins 6 caracteres."); return; }
      if (passwords.next !== passwords.confirm) { setError("La confirmation ne correspond pas au nouveau mot de passe."); return; }
    }
    if (needsCurrentPassword && !passwords.current) {
      setError("Saisissez votre mot de passe actuel pour confirmer."); return;
    }

    setSaving(true);
    try {
      const body = { fullName, phoneNumber: form.phoneNumber };
      if (form.email.trim()) body.email = form.email.trim();
      if (needsCurrentPassword) body.currentPassword = passwords.current;
      if (showPasswordForm) body.newPassword = passwords.next;

      const data = await apiFetch("/auth/profile", { token, method: "PATCH", body });
      await updateProfile(data);
      const next = { fullName: data.fullName || "", email: data.email || "", phoneNumber: normalizePhone(data.phoneNumber) };
      setForm(next);
      setInitial(next);
      setPasswords({ current: "", next: "", confirm: "" });
      setShowPasswordForm(false);
      setMessage(showPasswordForm ? "Profil et mot de passe mis a jour." : "Votre profil a ete mis a jour.");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  const disabled = loading || saving;
  const initialLetter = String(form.fullName || user?.fullName || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initialLetter}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroName} numberOfLines={2}>{form.fullName || user?.fullName}</Text>
          <Text style={styles.heroRole}>{ROLE_LABELS[String(user?.role || "").toUpperCase()] || user?.role}</Text>
        </View>
      </View>
      {loading ? <ActivityIndicator color={C.primary} /> : null}

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>INFORMATIONS PERSONNELLES</Text>
        <Text style={styles.label}>Nom complet</Text>
        <TextInput style={styles.input} value={form.fullName} maxLength={120} editable={!disabled}
          onChangeText={(v) => setForm((p) => ({ ...p, fullName: v }))}
          placeholder="Nom complet" placeholderTextColor={C.textMuted} />

        <Text style={styles.label}>Telephone</Text>
        <TextInput style={styles.input} value={form.phoneNumber} editable={!disabled} keyboardType="number-pad"
          onChangeText={(v) => setForm((p) => ({ ...p, phoneNumber: normalizePhone(v) }))}
          placeholder="10 chiffres" placeholderTextColor={C.textMuted} />
        {isPublicUser ? <Text style={styles.hint}>Ce numero sert a vous connecter.</Text> : null}

        <Text style={styles.label}>E-mail</Text>
        <TextInput style={styles.input} value={form.email} editable={!disabled} keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false}
          onChangeText={(v) => setForm((p) => ({ ...p, email: v }))}
          placeholder={isPublicUser ? "Optionnel" : "adresse@exemple.com"} placeholderTextColor={C.textMuted} />
        {!isPublicUser ? <Text style={styles.hint}>L'e-mail sert a vous connecter.</Text> : null}
      </View>

      {!isPublicUser ? (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionLabel}>MOT DE PASSE</Text>
            <Pressable onPress={() => { setShowPasswordForm((v) => !v); setPasswords((p) => ({ ...p, next: "", confirm: "" })); }}>
              <Text style={styles.link}>{showPasswordForm ? "Annuler" : "Changer"}</Text>
            </Pressable>
          </View>
          {showPasswordForm ? (
            <>
              <TextInput style={styles.input} value={passwords.next} secureTextEntry editable={!disabled} autoCapitalize="none"
                onChangeText={(v) => setPasswords((p) => ({ ...p, next: v }))}
                placeholder="Nouveau mot de passe (6 caracteres min.)" placeholderTextColor={C.textMuted} />
              <TextInput style={styles.input} value={passwords.confirm} secureTextEntry editable={!disabled} autoCapitalize="none"
                onChangeText={(v) => setPasswords((p) => ({ ...p, confirm: v }))}
                placeholder="Confirmer le nouveau mot de passe" placeholderTextColor={C.textMuted} />
            </>
          ) : (
            <Text style={styles.hint}>Votre mot de passe n'est jamais affiche.</Text>
          )}
        </View>
      ) : null}

      {needsCurrentPassword ? (
        <View style={[styles.card, { borderColor: C.amber }]}>
          <Text style={styles.sectionLabel}>CONFIRMATION</Text>
          <TextInput style={styles.input} value={passwords.current} secureTextEntry editable={!disabled} autoCapitalize="none"
            onChangeText={(v) => setPasswords((p) => ({ ...p, current: v }))}
            placeholder="Mot de passe actuel" placeholderTextColor={C.textMuted} />
          <Text style={styles.hint}>Requis pour modifier l'e-mail ou le mot de passe.</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      <Pressable style={[styles.button, disabled && { opacity: 0.5 }]} onPress={save} disabled={disabled} accessibilityRole="button">
        <Text style={styles.buttonText}>{saving ? "Enregistrement..." : "Enregistrer les modifications"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, paddingBottom: 32 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.surface, borderRadius: R.lg, padding: 16, ...S.sm },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 24, fontWeight: "800" },
  heroName: { fontSize: 19, fontWeight: "800", color: C.textDark },
  heroRole: { fontSize: 13, color: C.textMuted, fontWeight: "600", marginTop: 2 },
  card: { backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8, ...S.sm },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: C.textMuted, letterSpacing: 0.8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: C.primary, fontWeight: "700" },
  label: { fontWeight: "700", color: C.textDark, marginTop: 4 },
  input: { backgroundColor: "#fff", color: C.textDark, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 13 },
  hint: { color: C.textMuted, fontSize: 12 },
  error: { color: C.red, fontWeight: "600" },
  success: { color: C.green, fontWeight: "600" },
  button: { backgroundColor: C.primary, padding: 16, borderRadius: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700" },
});
