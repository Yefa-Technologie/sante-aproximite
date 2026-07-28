import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";

export function AuthScreen() {
  const { login } = useAuth();
  const [profileType, setProfileType] = useState("USER");
  const [hasAccount, setHasAccount] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    phoneNumber: "",
    role: "USER",
    establishmentCode: ""
  });
  const [success, setSuccess] = useState("");

  function normalizePhone(raw) {
    return String(raw || "").replace(/\D/g, "").slice(0, 10);
  }

  async function submit() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      let path = "/auth/login";
      let payload = {};

      if (profileType === "USER") {
        path = "/auth/mobile-user-session";
        payload = {
          fullName: hasAccount ? "" : form.fullName,
          phoneNumber: normalizePhone(form.phoneNumber)
        };
      } else if (profileType === "EMERGENCY") {
        path = "/auth/login";
        payload = { email: form.email, password: form.password };
      } else {
        path = hasAccount ? "/auth/login" : "/auth/register";
        payload =
          hasAccount
            ? { email: form.email, password: form.password }
            : { ...form, role: "CHEF_ETABLISSEMENT" };
      }

      const data = await apiFetch(path, { method: "POST", body: payload });
      if (data.pendingApproval) {
        setSuccess(data.message || "Compte en attente de validation");
        setForm({ fullName: "", email: "", password: "", phoneNumber: "", role: "USER", establishmentCode: "" });
        return;
      }
      await login(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 12}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.heroBlobPrimary} />
            <View style={styles.heroBlobSecondary} />
            <View style={styles.heroLogoPanel}>
              <Image source={require("../../assets/logo-sante.png")} style={styles.heroLogo} resizeMode="contain" />
            </View>
            <Text style={styles.title}>Sante Aproximite</Text>
            <Text style={styles.heroSubtitle}>Plateforme mobile de signalement, d'orientation sanitaire et de securite de proximite.</Text>
            <View style={styles.heroBadgeRow}>
              <Text style={styles.heroBadge}>Urgence 24/7</Text>
              <Text style={styles.heroBadge}>Geolocalisation</Text>
            </View>
          </View>

          <View style={styles.formCard}>
            <View style={styles.roleRow}>
              <Pressable
                style={[styles.roleButton, profileType === "USER" && styles.roleButtonActive]}
                onPress={() => {
                  setProfileType("USER");
                  setError("");
                  setSuccess("");
                }}
              >
                <Text style={[styles.roleText, profileType === "USER" && styles.roleTextActive]}>Utilisateur simple</Text>
              </Pressable>
              <Pressable
                style={[styles.roleButton, profileType === "CHEF_ETABLISSEMENT" && styles.roleButtonActive]}
                onPress={() => {
                  setProfileType("CHEF_ETABLISSEMENT");
                  setError("");
                  setSuccess("");
                }}
              >
                <Text style={[styles.roleText, profileType === "CHEF_ETABLISSEMENT" && styles.roleTextActive]}>
                  Chef d'etablissement
                </Text>
              </Pressable>
              <Pressable
                style={[styles.roleButton, profileType === "EMERGENCY" && styles.roleButtonActive]}
                onPress={() => {
                  setProfileType("EMERGENCY");
                  setHasAccount(true);
                  setError("");
                  setSuccess("");
                }}
              >
                <Text style={[styles.roleText, profileType === "EMERGENCY" && styles.roleTextActive]}>
                  Secours / Sécurités
                </Text>
              </Pressable>
            </View>
            <Text style={styles.subtitle}>
              {profileType === "USER"
                ? hasAccount
                  ? "Utilisateur: connexion par numero"
                  : "Utilisateur: creation de compte"
                : profileType === "EMERGENCY"
                  ? "comptes professionnels: connexion securisee"
                : hasAccount
                  ? "Chef d'établissement: connexion"
                  : "Chef d'établissement: inscription"}
            </Text>
            {profileType !== "EMERGENCY" ? (
              <>
                <Text style={styles.label}>Avez-vous deja un compte ?</Text>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>{hasAccount ? "Oui" : "Non"}</Text>
                  <Switch
                    value={hasAccount}
                    onValueChange={(value) => {
                      setHasAccount(value);
                      setError("");
                      setSuccess("");
                    }}
                    trackColor={{ false: "#fdd4bf", true: "#fdba74" }}
                    thumbColor={hasAccount ? "#ea580c" : "#94a3b8"}
                  />
                </View>
              </>
            ) : null}

            {profileType === "USER" && !hasAccount ? (
              <TextInput
                style={styles.input}
                placeholder="Nom complet"
                value={form.fullName}
                onChangeText={(value) => setForm({ ...form, fullName: value })}
              />
            ) : null}

            {profileType === "USER" ? (
              <TextInput
                style={styles.input}
                placeholder="Numero de telephone"
                keyboardType="number-pad"
                value={form.phoneNumber}
                onChangeText={(value) => setForm({ ...form, phoneNumber: normalizePhone(value) })}
              />
            ) : null}

            {profileType === "CHEF_ETABLISSEMENT" ? (
              <>
                {!hasAccount ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Nom complet"
                    value={form.fullName}
                    onChangeText={(value) => setForm({ ...form, fullName: value })}
                  />
                ) : null}
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                  returnKeyType="next"
                  textContentType="username"
                  value={form.email}
                  onChangeText={(value) => setForm({ ...form, email: value })}
                />
                <View style={styles.passwordField}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Mot de passe"
                    secureTextEntry={!showPassword}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType={hasAccount ? "go" : "next"}
                    textContentType="password"
                    value={form.password}
                    onChangeText={(value) => setForm({ ...form, password: value })}
                  />
                  <Pressable style={styles.passwordToggle} onPress={() => setShowPassword((value) => !value)}>
                    <Text style={styles.passwordToggleText}>{showPassword ? "Masquer" : "Afficher"}</Text>
                  </Pressable>
                </View>
                {!hasAccount ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Code de l'etablissement"
                    autoCapitalize="characters"
                    value={form.establishmentCode}
                    onChangeText={(value) => setForm({ ...form, establishmentCode: value })}
                  />
                ) : null}
              </>
            ) : null}
            {profileType === "EMERGENCY" ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Email professionnel"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                  returnKeyType="next"
                  textContentType="username"
                  value={form.email}
                  onChangeText={(value) => setForm({ ...form, email: value })}
                />
                <View style={styles.passwordField}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Mot de passe"
                    secureTextEntry={!showPassword}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="go"
                    textContentType="password"
                    value={form.password}
                    onChangeText={(value) => setForm({ ...form, password: value })}
                  />
                  <Pressable style={styles.passwordToggle} onPress={() => setShowPassword((value) => !value)}>
                    <Text style={styles.passwordToggleText}>{showPassword ? "Masquer" : "Afficher"}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {success ? <Text style={styles.success}>{success}</Text> : null}

            <Pressable style={styles.primaryButton} onPress={submit} disabled={loading}>
              <Text style={styles.primaryButtonText}>
                {loading ? "Chargement..." : hasAccount ? "Se connecter" : "Creer le compte"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#fff7ed" },
  content: { padding: 20, paddingTop: 24, paddingBottom: 40, gap: 14, justifyContent: "center", flexGrow: 1 },
  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: "#ffffff",
    borderColor: "#e5eef8",
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 24,
    alignItems: "center",
    marginBottom: 6,
    gap: 10
  },
  heroBlobPrimary: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "#f97316",
    top: -90,
    right: -80,
    opacity: 0.22
  },
  heroBlobSecondary: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "#fb923c",
    bottom: -75,
    left: -65,
    opacity: 0.16
  },
  heroLogoPanel: {
    width: "100%",
    backgroundColor: "#ffffff",
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  heroLogo: {
    width: 220,
    height: 220
  },
  title: { fontSize: 32, fontWeight: "900", color: "#16314f", textAlign: "center" },
  heroSubtitle: {
    color: "#47627d",
    marginTop: 2,
    textAlign: "center",
    fontWeight: "600",
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 8
  },
  heroBadgeRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  heroBadge: {
    backgroundColor: "#f0f7ff",
    borderColor: "#d7e7f8",
    borderWidth: 1,
    color: "#16314f",
    fontSize: 12,
    fontWeight: "700",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10
  },
  formCard: {
    backgroundColor: "#ffffff",
    borderColor: "#fed7aa",
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12
  },
  subtitle: { color: "#7c2d12", marginBottom: 4, fontWeight: "600" },
  label: { color: "#334155", fontWeight: "600" },
  input: {
    backgroundColor: "#fff",
    borderColor: "#d0e3ec",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  passwordField: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#d0e3ec",
    borderWidth: 1,
    borderRadius: 10,
    paddingLeft: 12,
    paddingRight: 8
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 12
  },
  passwordToggle: {
    minWidth: 74,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 8
  },
  passwordToggleText: {
    color: "#c2410c",
    fontWeight: "700",
    fontSize: 12
  },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  roleButton: {
    borderColor: "#fb923c",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  roleButtonActive: { backgroundColor: "#f97316" },
  roleText: { color: "#c2410c" },
  roleTextActive: { color: "#fff" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderColor: "#fed7aa",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff"
  },
  switchLabel: { color: "#0f172a", fontWeight: "600" },
  primaryButton: {
    backgroundColor: "#ea580c",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center"
  },
  primaryButtonText: { color: "#fff", fontWeight: "700" },
  error: { color: "#b42318" },
  success: { color: "#067647" }
});
