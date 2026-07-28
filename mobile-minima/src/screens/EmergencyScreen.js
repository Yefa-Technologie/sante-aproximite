import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch, trackEvent } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const EMERGENCY_CONTACTS = [
  { id: "SAMU",             label: "SAMU",             subtitle: "Urgence medicale",             number: "15",  color: C.red    },
  { id: "SAPEUR_POMPIER",   label: "Sapeurs-Pompiers", subtitle: "Incendie, secours, accidents",  number: "18",  color: C.orange },
];

const EMERGENCY_TYPES_BY_SERVICE = {
  SAMU: [
    "Malaise",
    "Douleur intense",
    "Detresse respiratoire",
    "Hemorragie",
    "Accouchement / urgence obstetricale",
    "Perte de connaissance",
    "Convulsion",
    "Autre urgence medicale",
  ],
  SAPEUR_POMPIER: [
    "Incendie",
    "Accident de route",
    "Sauvetage / personne bloquee",
    "Effondrement",
    "Inondation",
    "Fuite de gaz",
    "Autre sinistre",
  ],
};
const EMERGENCY_PHONE_KEY = "sante_aproxmite_emergency_phone";
const IDEAL_GPS_RADIUS_METERS = 10;
const TARGET_GPS_RADIUS_METERS = 20;
const MAX_GPS_RADIUS_METERS = 300;
const REPORTS_PREVIEW_LIMIT = 3;

const EMERGENCY_STATUS_LABELS = {
  NEW:         "Nouvelle alerte",
  ACKNOWLEDGED:"Prise en charge",
  EN_ROUTE:    "Equipe en route",
  ON_SITE:     "Equipe sur site",
  COMPLETED:   "Intervention terminee",
  CLOSED:      "Alerte cloturee",
};

function normalizePhone(value) { return String(value || "").replace(/\D/g, ""); }
function formatEmergencyStatus(status) {
  return EMERGENCY_STATUS_LABELS[String(status || "").toUpperCase()] || "Statut inconnu";
}

export function EmergencyScreen() {
  const { token, user } = useAuth();
  const [targetService, setTargetService] = useState("SAMU");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [emergencyType, setEmergencyType] = useState("Malaise");
  const [pickupPointName, setPickupPointName] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState([]);
  const [coords, setCoords] = useState(null);
  const [loadingGps, setLoadingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [myReports, setMyReports] = useState([]);
  const [showAllReports, setShowAllReports] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function callNumber(number) {
    try { await Linking.openURL(`tel:${number}`); } catch {}
  }

  async function loadPosition() {
    setLoadingGps(true);
    setError("");
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") throw new Error("Permission de localisation refusee");
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const accuracyMeters = Number(current?.coords?.accuracy);
      if (!Number.isFinite(accuracyMeters)) throw new Error("Precision GPS indisponible. Reessayez.");
      if (accuracyMeters > MAX_GPS_RADIUS_METERS) {
        throw new Error(`Precision GPS trop faible (${Math.round(accuracyMeters)} m). Rapprochez-vous d'une zone ouverte.`);
      }
      setCoords({ latitude: current.coords.latitude, longitude: current.coords.longitude, accuracyMeters });
    } catch (err) {
      setError(err.message || "Impossible de recuperer la position GPS");
    } finally {
      setLoadingGps(false);
    }
  }

  useEffect(() => { loadPosition().catch(() => {}); }, []);
  useEffect(() => {
    const nextTypes = EMERGENCY_TYPES_BY_SERVICE[targetService] || [];
    if (!nextTypes.includes(emergencyType)) {
      setEmergencyType(nextTypes[0] || "");
    }
  }, [targetService, emergencyType]);
  useEffect(() => {
    if (user?.phoneNumber) setPhoneNumber(String(user.phoneNumber));
  }, [user?.phoneNumber]);
  useEffect(() => {
    if (user?.phoneNumber) return;
    AsyncStorage.getItem(EMERGENCY_PHONE_KEY).then((stored) => { if (stored) setPhoneNumber(stored); }).catch(() => {});
  }, [user?.phoneNumber]);

  const canSubmit = useMemo(() => {
    const normalizedPhone = normalizePhone(phoneNumber);
    return (
      normalizedPhone.length === 10 &&
      String(emergencyType || "").trim().length >= 3 &&
      String(pickupPointName || "").trim().length >= 3 &&
      String(description || "").trim().length >= 10 &&
      !!coords &&
      Number.isFinite(Number(coords.accuracyMeters)) &&
      Number(coords.accuracyMeters) <= MAX_GPS_RADIUS_METERS
    );
  }, [phoneNumber, emergencyType, pickupPointName, description, coords]);

  async function submitEmergencyReport() {
    setError("");
    setSuccess("");
    if (!canSubmit) {
      setError(`Completez le formulaire et utilisez une position GPS acceptable (max ${MAX_GPS_RADIUS_METERS} m).`);
      return;
    }
    setSubmitting(true);
    try {
      const normalizedPhone = normalizePhone(phoneNumber);
      await AsyncStorage.setItem(EMERGENCY_PHONE_KEY, normalizedPhone);
      const result = await apiFetch("/emergency-reports", {
        token,
        method: "POST",
        body: {
          targetService,
          phoneNumber: normalizedPhone,
          emergencyType: emergencyType.trim(),
          pickupPointName: pickupPointName.trim(),
          description: description.trim(),
          photos,
          latitude: coords.latitude,
          longitude: coords.longitude
        }
      });
      if (result?.queued) {
        setSuccess(result.message || "Signalement enregistre hors ligne.");
      } else {
        const reportId = result?.report?.id ? ` #${result.report.id}` : "";
        setSuccess(`Signalement envoye${reportId}.`);
      }
      trackEvent("emergency", "send_emergency", {
        targetService,
        emergencyType: emergencyType.trim(),
        queued: !!result?.queued,
      });
      setPickupPointName("");
      setDescription("");
      setPhotos([]);
    } catch (err) {
      setError(err.message || "Envoi impossible");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMyReports({ silent = false } = {}) {
    if (!silent) setLoadingReports(true);
    try {
      const data = await apiFetch("/emergency-reports/mine", { token });
      setMyReports(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) setError(err.message || "Chargement du suivi impossible");
    } finally {
      if (!silent) setLoadingReports(false);
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
        .map((asset) => { if (!asset?.base64) return ""; const mime = asset.mimeType || "image/jpeg"; return `data:${mime};base64,${asset.base64}`; })
        .filter(Boolean);
      setPhotos((prev) => [...prev, ...nextPhotos].slice(0, 4));
    } catch (err) {
      setError(err.message || "Impossible de prendre une photo");
    }
  }

  useEffect(() => {
    loadMyReports();
    const interval = setInterval(() => { loadMyReports({ silent: true }).catch(() => {}); }, 15000);
    return () => clearInterval(interval);
  }, [token]);

  const trackedReports = useMemo(
    () => myReports.filter((report) => String(report?.status || "").toUpperCase() !== "NEW"),
    [myReports]
  );
  const visibleReports = useMemo(
    () => showAllReports ? trackedReports : trackedReports.slice(0, REPORTS_PREVIEW_LIMIT),
    [trackedReports, showAllReports]
  );

  const activeContact = EMERGENCY_CONTACTS.find((c) => c.id === targetService);
  const availableEmergencyTypes = EMERGENCY_TYPES_BY_SERVICE[targetService] || [];

  function gpsAccuracyInfo() {
    if (!coords) return { label: `Precision cible: ${IDEAL_GPS_RADIUS_METERS}-${TARGET_GPS_RADIUS_METERS} m`, color: C.textMuted };
    const acc = Number(coords.accuracyMeters);
    if (acc <= IDEAL_GPS_RADIUS_METERS) return { label: "GPS excellent", color: C.green };
    if (acc <= TARGET_GPS_RADIUS_METERS) return { label: "GPS correct", color: C.green };
    if (acc <= 50)  return { label: "GPS moyen - envoi autorise", color: C.amber };
    return { label: "GPS faible - envoi autorise", color: C.orange };
  }

  const gpsInfo = gpsAccuracyInfo();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      <View style={styles.header}>
        <Text style={styles.title}>Signaler une urgence</Text>
        <Text style={styles.subtitle}>Votre signalement inclut le service, votre telephone, la position GPS et la description.</Text>
      </View>

      {/* Service selector */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>SERVICE D'URGENCE</Text>
        <View style={styles.serviceRow}>
          {EMERGENCY_CONTACTS.map((contact) => {
            const selected = targetService === contact.id;
            return (
              <Pressable
                key={contact.id}
                style={[styles.serviceCard, { borderColor: contact.color }, selected && { backgroundColor: contact.color }]}
                onPress={() => setTargetService(contact.id)}
              >
                <Text style={[styles.serviceCardLabel, selected && { color: "#fff" }]}>{contact.label}</Text>
                <Text style={[styles.serviceCardSub, selected && { color: "rgba(255,255,255,0.85)" }]}>{contact.subtitle}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Phone */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>VOTRE TELEPHONE</Text>
        <TextInput
          style={shared.input}
          keyboardType="number-pad"
          placeholder="Ex: 0612345678"
          placeholderTextColor={C.textLight}
          value={phoneNumber}
          onChangeText={(value) => setPhoneNumber(normalizePhone(value).slice(0, 10))}
        />
        <Text style={shared.hint}>10 chiffres requis · {normalizePhone(phoneNumber).length}/10</Text>
      </View>

      {/* Type urgence */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>TYPE D'URGENCE</Text>
        <View style={styles.chips}>
          {availableEmergencyTypes.map((item) => (
            <Pressable
              key={item}
              style={[styles.chip, emergencyType === item && styles.chipActive]}
              onPress={() => setEmergencyType(item)}
            >
              <Text style={[styles.chipText, emergencyType === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={shared.input}
          placeholder="Precisez si necessaire..."
          placeholderTextColor={C.textLight}
          value={emergencyType}
          onChangeText={setEmergencyType}
        />
      </View>

      {/* Pickup point */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>POINT DE PRISE EN CHARGE</Text>
        <TextInput
          style={shared.input}
          placeholder="Ex: Carrefour Faya, devant la pharmacie X"
          placeholderTextColor={C.textLight}
          value={pickupPointName}
          onChangeText={setPickupPointName}
        />
      </View>

      {/* Description */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>DESCRIPTION</Text>
        <TextInput
          style={[shared.input, shared.textArea]}
          multiline
          placeholder="Decrivez clairement ce qui se passe..."
          placeholderTextColor={C.textLight}
          value={description}
          onChangeText={setDescription}
        />
      </View>

      {/* Photo */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>PHOTOS (OPTIONNEL)</Text>
        <Pressable style={styles.photoBtn} onPress={takePhoto}>
          <Text style={styles.photoBtnText}>Prendre une photo</Text>
        </Pressable>
        {photos.length > 0 ? (
          <Text style={[shared.hint, { color: C.green }]}>{photos.length} photo(s) ajoutee(s)</Text>
        ) : null}
      </View>

      {/* GPS */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>POSITION GPS</Text>
        {coords ? (
          <View style={styles.coordsBox}>
            <Text style={styles.coordsText}>{coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}</Text>
            <Text style={[styles.coordsAccuracy, { color: gpsInfo.color }]}>
              {gpsInfo.label} (~{Math.round(Number(coords.accuracyMeters))} m)
            </Text>
          </View>
        ) : (
          <Text style={shared.hint}>Position non disponible</Text>
        )}
        <Pressable style={styles.gpsBtn} onPress={loadPosition}>
          <Text style={styles.gpsBtnText}>
            {loadingGps ? "Localisation en cours..." : coords ? "Actualiser la position" : "Obtenir ma position GPS"}
          </Text>
        </Pressable>
      </View>

      {error   ? <Text style={styles.errorMsg}>{error}</Text>   : null}
      {success ? <Text style={styles.successMsg}>{success}</Text> : null}

      {/* Submit */}
      <Pressable
        style={[styles.submitBtn, { backgroundColor: activeContact?.color || C.red }, (!canSubmit || submitting) && styles.submitBtnDisabled]}
        onPress={submitEmergencyReport}
        disabled={!canSubmit || submitting}
      >
        <Text style={styles.submitBtnText}>
          {submitting ? "Envoi en cours..." : `Envoyer au ${activeContact?.label || "service"}`}
        </Text>
      </Pressable>

      {/* Direct call */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>APPEL DIRECT</Text>
        {EMERGENCY_CONTACTS.map((contact) => (
          <Pressable
            key={`${contact.id}_call`}
            style={[styles.callBtn, { borderColor: contact.color }]}
            onPress={() => callNumber(contact.number)}
          >
            <Text style={[styles.callBtnLabel, { color: contact.color }]}>{contact.label}</Text>
            <Text style={[styles.callBtnNumber, { color: contact.color }]}>
              Appeler le {contact.number}
            </Text>
          </Pressable>
        ))}
        <Text style={shared.hint}>En cas de doute, composez le 112.</Text>
      </View>

      {/* Tracking */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>SUIVI DE MES ALERTES</Text>
        {loadingReports ? <Text style={shared.hint}>Chargement...</Text> : (
          <Text style={shared.hint}>{trackedReports.length} alerte(s) suivie(s)</Text>
        )}

        {trackedReports.length > REPORTS_PREVIEW_LIMIT ? (
          <Pressable style={styles.toggleBtn} onPress={() => setShowAllReports((prev) => !prev)}>
            <Text style={styles.toggleBtnText}>
              {showAllReports ? "Voir moins" : `Voir toutes les alertes (${trackedReports.length})`}
            </Text>
          </Pressable>
        ) : null}

        {visibleReports.map((report) => (
          <View key={report.id} style={styles.trackCard}>
            <View style={styles.trackCardHeader}>
              <Text style={styles.trackType}>{report.emergencyType}</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>{formatEmergencyStatus(report.status)}</Text>
              </View>
            </View>
            {report.pickupPointName ? (
              <Text style={styles.trackMeta}>Point: {report.pickupPointName}</Text>
            ) : null}
            {report.userStatusMessage ? (
              <View style={styles.userMsgBox}>
                <Text style={styles.userMsgText}>{report.userStatusMessage}</Text>
              </View>
            ) : null}
            <View style={styles.trackDetails}>
              <Text style={styles.trackDetail}>Service: {report.targetService}</Text>
              {report.handlerBaseName ? <Text style={styles.trackDetail}>Caserne: {report.handlerBaseName}</Text> : null}
              {report.handlerName     ? <Text style={styles.trackDetail}>Equipe: {report.handlerName}</Text>    : null}
              {report.estimatedArrivalLabel ? (
                <Text style={styles.trackDetail}>Arrivee estimee: {report.estimatedArrivalLabel}</Text>
              ) : Number.isFinite(Number(report.estimatedArrivalMinutes)) && Number(report.estimatedArrivalMinutes) > 0 ? (
                <Text style={styles.trackDetail}>Arrivee estimee: {report.estimatedArrivalMinutes} min</Text>
              ) : null}
              {report.teamNote ? <Text style={styles.trackDetail}>Avancement: {report.teamNote}</Text> : null}
            </View>
          </View>
        ))}

        {!loadingReports && visibleReports.length === 0 ? (
          <Text style={shared.hint}>Aucune alerte suivie pour le moment.</Text>
        ) : null}
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

  sectionCard: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
    ...S.sm,
  },
  sectionLabel: shared.sectionLabel,

  serviceRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  serviceCard: {
    width: "47%",
    borderWidth: 2,
    borderRadius: R.sm,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: C.surface,
    gap: 3,
  },
  serviceCardLabel: { fontWeight: "700", color: C.textDark, fontSize: 14 },
  serviceCardSub:   { color: C.textMuted, fontSize: 11 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: C.bg,
  },
  chipActive:    { backgroundColor: C.teal, borderColor: C.teal },
  chipText:      { color: C.textMed, fontWeight: "600", fontSize: 12 },
  chipTextActive:{ color: "#fff" },

  photoBtn: {
    backgroundColor: C.bg,
    borderWidth: 1.5,
    borderColor: C.teal,
    borderRadius: R.sm,
    paddingVertical: 11,
    alignItems: "center",
    borderStyle: "dashed",
  },
  photoBtnText: { color: C.teal, fontWeight: "700", fontSize: 13 },

  coordsBox: {
    backgroundColor: C.greenLight,
    borderRadius: R.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: C.green + "55",
    gap: 3,
  },
  coordsText:     { color: C.green,   fontWeight: "700", fontSize: 13 },
  coordsAccuracy: { fontSize: 12, fontWeight: "600" },
  gpsBtn: {
    backgroundColor: C.teal,
    borderRadius: R.sm,
    paddingVertical: 11,
    alignItems: "center",
  },
  gpsBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  submitBtn: {
    borderRadius: R.md,
    paddingVertical: 16,
    alignItems: "center",
    ...S.md,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  callBtn: {
    borderWidth: 1.5,
    borderRadius: R.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: C.surface,
  },
  callBtnLabel:  { fontWeight: "700", fontSize: 14 },
  callBtnNumber: { fontWeight: "600", fontSize: 13 },

  toggleBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    paddingVertical: 9,
    alignItems: "center",
  },
  toggleBtnText: { color: C.textMed, fontWeight: "600", fontSize: 13 },

  trackCard: {
    backgroundColor: C.bg,
    borderRadius: R.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  trackCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  trackType:       { fontWeight: "700", color: C.textDark, flex: 1, fontSize: 14 },
  statusBadge: {
    backgroundColor: C.redLight,
    borderRadius: R.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: { color: C.red, fontWeight: "700", fontSize: 10 },
  trackMeta:    { color: C.textMuted, fontSize: 12 },
  userMsgBox: {
    backgroundColor: C.primaryLight,
    borderRadius: R.xs,
    padding: 8,
    borderWidth: 1,
    borderColor: C.primary + "44",
  },
  userMsgText: { color: C.primary, fontWeight: "600", fontSize: 12 },
  trackDetails: { gap: 3 },
  trackDetail:  { color: C.textMed, fontSize: 12 },

  errorMsg:   { ...shared.error,   backgroundColor: "#FEF2F2", padding: 10, borderRadius: R.sm },
  successMsg: { ...shared.success, backgroundColor: "#ECFDF5", padding: 10, borderRadius: R.sm },
});
