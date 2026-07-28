import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch, trackEvent } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const ACCENT = C.purple;

const TARGET_SERVICES = [
  { key: "POLICE",            label: "Police",            emoji: "👮" },
  { key: "GENDARMERIE",       label: "Gendarmerie",       emoji: "🪖" },
  { key: "PROTECTION_CIVILE", label: "Protection Civile", emoji: "🛡️" }
];

const ALERT_TYPES_BY_SERVICE = {
  POLICE: [
    { key: "AGRESSION", label: "Agression", emoji: "⚠️" },
    { key: "VOL", label: "Vol / braquage", emoji: "💰" },
    { key: "ATTROUPEMENT_SUSPECT", label: "Attroupement suspect", emoji: "👥" },
    { key: "INTRUSION", label: "Intrusion", emoji: "🔓" },
    { key: "DROGUE", label: "Drogue / fumoir", emoji: "🚬" },
    { key: "AFFRONTEMENT", label: "Affrontement", emoji: "🥊" },
    { key: "TROUBLE_URBAIN", label: "Trouble urbain", emoji: "🚨" },
    { key: "AUTRE", label: "Autre menace", emoji: "🆘" },
  ],
  GENDARMERIE: [
    { key: "ATTAQUE", label: "Attaque / agression", emoji: "⚠️" },
    { key: "BRAQUAGE", label: "Braquage", emoji: "💰" },
    { key: "CONFLIT", label: "Conflit / menace", emoji: "🪖" },
    { key: "COUPEUR_ROUTE", label: "Coupeur de route", emoji: "🛣️" },
    { key: "TERRORISME", label: "Menace terroriste", emoji: "💣" },
    { key: "AFFRONTEMENT", label: "Affrontement arme", emoji: "🔥" },
    { key: "INTRUSION", label: "Intrusion", emoji: "🔓" },
    { key: "AUTRE", label: "Autre menace", emoji: "🆘" },
  ],
  PROTECTION_CIVILE: [
    { key: "INCENDIE", label: "Incendie", emoji: "🔥" },
    { key: "INONDATION", label: "Inondation", emoji: "🌊" },
    { key: "EFFONDREMENT", label: "Effondrement", emoji: "🏚️" },
    { key: "FUITE_GAZ", label: "Fuite de gaz", emoji: "💨" },
    { key: "SAUVETAGE", label: "Sauvetage / evacuation", emoji: "🚨" },
    { key: "AUTRE", label: "Autre sinistre", emoji: "🆘" },
  ],
};

const STATUS_CFG = {
  NEW:          { label: "NOUVELLE",        bg: C.purpleLight, color: ACCENT },
  ACKNOWLEDGED: { label: "PRISE EN CHARGE", bg: C.amberLight,  color: C.amber },
  RESOLVED:     { label: "RESOLUE",         bg: C.greenLight,  color: C.green },
  CLOSED:       { label: "CLOTUREE",        bg: C.border,      color: C.textMuted }
};

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status || "-", bg: C.border, color: C.textMuted };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

export function SecurityAlertScreen() {
  const { token } = useAuth();
  const [targetService, setTargetService]     = useState("");
  const [alertType, setAlertType]             = useState("");
  const [locationName, setLocationName]       = useState("");
  const [description, setDescription]         = useState("");
  const [phoneNumber, setPhoneNumber]         = useState("");
  const [photos, setPhotos]                   = useState([]);
  const [coords, setCoords]                   = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState("");
  const [success, setSuccess]                 = useState("");
  const [myAlerts, setMyAlerts]               = useState([]);
  const [tab, setTab]                         = useState("form");
  const availableAlertTypes = ALERT_TYPES_BY_SERVICE[targetService] || [];

  async function loadMyAlerts({ silent = false } = {}) {
    try {
      const data = await apiFetch("/security-alerts/mine", { token });
      setMyAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) setError(err.message);
    }
  }

  useEffect(() => {
    loadMyAlerts();
    const interval = setInterval(() => loadMyAlerts({ silent: true }).catch(() => {}), 30000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!targetService) {
      setAlertType("");
      return;
    }
    const nextTypes = ALERT_TYPES_BY_SERVICE[targetService] || [];
    if (!nextTypes.some((type) => type.key === alertType)) {
      setAlertType(nextTypes[0]?.key || "");
    }
  }, [targetService]);

  async function captureLocation() {
    setLocationLoading(true); setError("");
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") throw new Error("Permission de localisation refusee.");
      const current = await Location.getCurrentPositionAsync({});
      setCoords({ lat: current.coords.latitude, lon: current.coords.longitude });
    } catch (err) {
      setError(err.message);
    } finally {
      setLocationLoading(false);
    }
  }

  async function takePhoto() {
    setError("");
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== "granted") throw new Error("Permission camera refusee");
      const result = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (result.canceled) return;
      const nextPhotos = (result.assets || [])
        .map((asset) => {
          if (!asset?.base64) return "";
          const mime = asset.mimeType || "image/jpeg";
          return `data:${mime};base64,${asset.base64}`;
        })
        .filter(Boolean);
      setPhotos((prev) => [...prev, ...nextPhotos].slice(0, 4));
    } catch (err) {
      setError(err.message || "Impossible de prendre une photo");
    }
  }

  async function submitAlert() {
    setError(""); setSuccess("");
    if (!targetService)                               { setError("Choisissez le service destinataire."); return; }
    if (!alertType)                                   { setError("Choisissez un type d'alerte."); return; }
    if (locationName.trim().length < 3)               { setError("Indiquez le lieu (min 3 car.)."); return; }
    if (description.trim().length < 10)               { setError("Description trop courte (min 10 car.)."); return; }
    if (phoneNumber.replace(/\D/g, "").length !== 10) { setError("Numero invalide (10 chiffres)."); return; }
    if (!coords)                                      { setError("Capturez votre position GPS."); return; }

    setLoading(true);
    try {
      const result = await apiFetch("/security-alerts", {
        token, method: "POST",
        body: {
          targetService,
          alertType,
          locationName:  locationName.trim(),
          description:   description.trim(),
          phoneNumber:   phoneNumber.replace(/\D/g, ""),
          photos,
          latitude:      coords.lat,
          longitude:     coords.lon
        }
      });
      setSuccess(result?.queued ? result.message || "Enregistree hors ligne." : "Alerte envoyee avec succes.");
      trackEvent("security_alert", "send_security", {
        targetService,
        alertType,
        queued: !!result?.queued,
      });
      setTargetService(""); setAlertType(""); setLocationName(""); setDescription(""); setPhoneNumber(""); setCoords(null); setPhotos([]);
      await loadMyAlerts();
      setTab("history");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !!targetService &&
    !!alertType &&
    locationName.trim().length >= 3 &&
    description.trim().length >= 10 &&
    phoneNumber.replace(/\D/g, "").length === 10 &&
    !!coords;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: ACCENT + "18" }]}>
          <Text style={styles.headerEmoji}>🛡️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Urgence securitaire</Text>
          <Text style={styles.headerSub}>Signalez un incident securitaire en temps reel</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {[
          { key: "form",    label: "Nouveau signalement" },
          { key: "history", label: `Mes urgences (${myAlerts.length})` }
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

      {tab === "form" ? (
        <>
          {/* Service destinataire */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>ADRESSER A</Text>
            <View style={styles.typeGrid}>
              {TARGET_SERVICES.map((svc) => {
                const active = targetService === svc.key;
                return (
                  <Pressable
                    key={svc.key}
                    style={[styles.typeCard, active && { backgroundColor: ACCENT, borderColor: ACCENT }]}
                    onPress={() => setTargetService(svc.key)}
                  >
                    <Text style={styles.typeEmoji}>{svc.emoji}</Text>
                    <Text style={[styles.typeLabel, active && { color: "#fff" }]}>{svc.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Type d'incident */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>TYPE D'INCIDENT</Text>
            <View style={styles.typeGrid}>
              {availableAlertTypes.map((type) => {
                const active = alertType === type.key;
                return (
                  <Pressable
                    key={type.key}
                    style={[styles.typeCard, active && { backgroundColor: ACCENT, borderColor: ACCENT }]}
                    onPress={() => setAlertType(type.key)}
                  >
                    <Text style={styles.typeEmoji}>{type.emoji}</Text>
                    <Text style={[styles.typeLabel, active && { color: "#fff" }]}>{type.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Lieu */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>LIEU DE L'INCIDENT</Text>
            <TextInput
              style={shared.input}
              placeholder="Ex: Marche de Cocody, Rue des jardins..."
              value={locationName}
              onChangeText={setLocationName}
            />
          </View>

          {/* Description */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>DESCRIPTION</Text>
            <TextInput
              style={[shared.input, shared.textArea]}
              placeholder="Decrivez precisement ce qui se passe..."
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <Text style={shared.hint}>{description.trim().length} / 10 min</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionLabel}>PHOTOS (OPTIONNEL)</Text>
            <Pressable style={styles.gpsBtn} onPress={takePhoto}>
              <Text style={styles.gpsBtnText}>Prendre une photo</Text>
            </Pressable>
            {photos.length > 0 ? (
              <>
                <Text style={shared.hint}>{photos.length} photo(s) ajoutee(s)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                  {photos.map((photo, index) => (
                    <Image key={`security_photo_${index}`} source={{ uri: photo }} style={styles.photoThumb} />
                  ))}
                </ScrollView>
              </>
            ) : null}
          </View>

          {/* Telephone */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>TELEPHONE DE CONTACT</Text>
            <TextInput
              style={shared.input}
              placeholder="Ex: 0700000000"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              maxLength={14}
            />
          </View>

          {/* GPS */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>POSITION GPS</Text>
            {coords ? (
              <View style={styles.coordsBox}>
                <Text style={styles.coordsRow}>📍 Lat: {coords.lat.toFixed(5)}</Text>
                <Text style={styles.coordsRow}>📍 Lon: {coords.lon.toFixed(5)}</Text>
              </View>
            ) : (
              <Text style={shared.hint}>Position non capturee</Text>
            )}
            <Pressable
              style={[styles.gpsBtn, locationLoading && { opacity: 0.6 }]}
              onPress={captureLocation}
              disabled={locationLoading}
            >
              <Text style={styles.gpsBtnText}>
                {locationLoading ? "Localisation..." : coords ? "Actualiser la position" : "📍 Capturer ma position"}
              </Text>
            </Pressable>
          </View>

          {error   ? <Text style={shared.error}>{error}</Text>   : null}
          {success ? <Text style={shared.success}>{success}</Text> : null}

          <Pressable
            style={[styles.submitBtn, (!canSubmit || loading) && { opacity: 0.45 }]}
            onPress={submitAlert}
            disabled={!canSubmit || loading}
          >
            <Text style={styles.submitBtnText}>{loading ? "Envoi en cours..." : "Envoyer l'alerte"}</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>MES SIGNALEMENTS</Text>
          {myAlerts.length === 0 ? (
            <Text style={shared.hint}>Aucun signalement pour l'instant.</Text>
          ) : null}
          {myAlerts.map((alert) => {
            const typeInfo = Object.values(ALERT_TYPES_BY_SERVICE).flat().find((t) => t.key === alert.alertType);
            const svcInfo  = TARGET_SERVICES.find((s) => s.key === alert.targetService);
            return (
              <View key={alert.id} style={styles.alertCard}>
                <View style={styles.alertTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertType}>
                      {typeInfo?.emoji || "🆘"} {typeInfo?.label || alert.alertType || "-"}
                    </Text>
                    {svcInfo ? (
                      <Text style={styles.alertSvc}>{svcInfo.emoji} {svcInfo.label}</Text>
                    ) : null}
                    <Text style={styles.alertLocation}>{alert.locationName}</Text>
                  </View>
                  <StatusBadge status={alert.status} />
                </View>
                <Text style={styles.alertDesc} numberOfLines={3}>{alert.description}</Text>
                {Array.isArray(alert.photos) && alert.photos.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                    {alert.photos.map((photo, index) => (
                      <Image key={`history_photo_${alert.id}_${index}`} source={{ uri: photo }} style={styles.photoThumb} />
                    ))}
                  </ScrollView>
                ) : null}
                <Text style={styles.alertDate}>{new Date(alert.createdAt).toLocaleString()}</Text>
                {alert.handledAt ? (
                  <Text style={styles.alertHandled}>✅ Prise en charge: {new Date(alert.handledAt).toLocaleString()}</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
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
    alignItems: "center", backgroundColor: C.purpleLight,
  },
  tabBtnText: { color: ACCENT, fontWeight: "700", fontSize: 13 },

  card: {
    backgroundColor: C.surface, borderRadius: R.md,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 3, borderLeftColor: ACCENT,
    padding: 14, gap: 10, ...S.sm,
  },
  sectionLabel: { fontSize: 10, fontWeight: "800", color: C.textMuted, letterSpacing: 1 },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeCard: {
    width: "30%", borderRadius: R.sm, borderWidth: 1.5,
    borderColor: ACCENT, backgroundColor: C.purpleLight,
    alignItems: "center", paddingVertical: 10, gap: 4,
  },
  typeEmoji: { fontSize: 20 },
  typeLabel: { fontSize: 11, fontWeight: "700", color: ACCENT, textAlign: "center" },

  coordsBox: {
    backgroundColor: C.greenLight, borderColor: C.green + "50",
    borderWidth: 1, borderRadius: R.sm, padding: 10, gap: 4,
  },
  coordsRow: { color: C.green, fontWeight: "600", fontSize: 13 },
  gpsBtn: {
    backgroundColor: C.tealLight, borderWidth: 1.5,
    borderColor: C.teal, borderRadius: R.sm,
    paddingVertical: 10, alignItems: "center",
  },
  gpsBtnText: { color: C.teal, fontWeight: "700" },
  photoRow: { gap: 8 },
  photoThumb: { width: 88, height: 88, borderRadius: R.sm, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceAlt },

  submitBtn: {
    backgroundColor: ACCENT, borderRadius: R.md,
    paddingVertical: 15, alignItems: "center", ...S.sm,
  },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  alertCard: {
    backgroundColor: C.surfaceAlt, borderRadius: R.sm,
    borderWidth: 1, borderColor: C.border,
    padding: 12, gap: 6, marginTop: 6,
  },
  alertTop:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  alertType:    { fontWeight: "700", color: C.textDark, fontSize: 14 },
  alertSvc:     { color: ACCENT, fontWeight: "600", fontSize: 12, marginTop: 1 },
  alertLocation:{ color: C.textMed, fontWeight: "600", fontSize: 13, marginTop: 2 },
  alertDesc:    { color: C.textMuted, fontSize: 13 },
  alertDate:    { color: C.textMuted, fontSize: 12 },
  alertHandled: { color: C.green, fontSize: 12, fontWeight: "600" },

  badge:     { borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
