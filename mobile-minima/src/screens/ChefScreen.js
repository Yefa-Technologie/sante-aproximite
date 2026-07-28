import * as Location from "expo-location";
import * as Print from "expo-print";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const ACCENT = C.teal;

const ESTABLISHMENT_TYPE_OPTIONS = [
  { label: "Confessionnel", value: "CONFESSIONNEL" },
  { label: "Prive",         value: "PRIVE" },
  { label: "Publique",      value: "PUBLIQUE" }
];
const LEVEL_OPTIONS = [
  { label: "CHU",                     value: "CHU" },
  { label: "CHR",                     value: "CHR" },
  { label: "CH",                      value: "CH" },
  { label: "CHS",                     value: "CHS" },
  { label: "Clinique",                value: "CLINIQUE" },
  { label: "Polyclinique",            value: "POLYCLINIQUE" },
  { label: "Infirmerie",              value: "INFIRMERIE" },
  { label: "CLCC",                    value: "CLCC" },
  { label: "ESPC",                    value: "ESPC" },
  { label: "Centre de sante",         value: "CENTRE_SANTE" },
  { label: "SSR",                     value: "SSR" },
  { label: "EHPAD / USLD",           value: "EHPAD_USLD" },
  { label: "Centre de radiotherapie", value: "CENTRE_RADIOTHERAPIE" },
  { label: "Centre de cardiologie",   value: "CENTRE_CARDIOLOGIE" }
];
const AUTO_REFRESH_MS = 30 * 60 * 1000;

const APPROVAL_CFG = {
  APPROVED: { label: "APPROUVE",    bg: C.greenLight, color: C.green },
  PENDING:  { label: "EN ATTENTE",  bg: C.amberLight, color: C.amber },
  REJECTED: { label: "REJETE",      bg: C.redLight,   color: C.red }
};

function ApprovalBadge({ status }) {
  const s = String(status || "").toUpperCase();
  const cfg = APPROVAL_CFG[s] || { label: s || "NON CREE", bg: C.border, color: C.textMuted };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function parseServices(servicesCsv) {
  return servicesCsv.split(",").map((item) => item.trim()).filter(Boolean).map((name) => ({ name }));
}

function formatGeoOption(option) {
  if (!option) return "";
  const code = String(option.code || "").trim().toUpperCase();
  const name = String(option.name || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code;
}

export function ChefScreen() {
  const { token } = useAuth();
  const scrollRef = useRef(null);
  const inputRefs = useRef({});
  const [centerId, setCenterId]                         = useState("");
  const [centerApprovalStatus, setCenterApprovalStatus] = useState(null);
  const [error, setError]                               = useState("");
  const [message, setMessage]                           = useState("");
  const [loading, setLoading]                           = useState(false);
  const [complaintsLoading, setComplaintsLoading]       = useState(false);
  const [complaintsList, setComplaintsList]             = useState([]);
  const [complaintSummary, setComplaintSummary]         = useState(null);
  const [complaintNotes, setComplaintNotes]             = useState({});
  const [complaintActionLoadingId, setComplaintActionLoadingId] = useState("");
  const [regions, setRegions]                           = useState([]);
  const [districts, setDistricts]                       = useState([]);
  const [geoLoading, setGeoLoading]                     = useState(false);
  const [checkinCode, setCheckinCode]                   = useState("");
  const [printingQr, setPrintingQr]                     = useState(false);
  const qrRef = useRef(null);
  const [visitPhone, setVisitPhone]                     = useState("");
  const [visitLoading, setVisitLoading]                 = useState(false);
  const [visitMsg, setVisitMsg]                         = useState({ text: "", ok: true });
  const [form, setForm] = useState({
    name: "", address: "", establishmentCode: "",
    regionCode: "", districtCode: "",
    level: "CENTRE_SANTE", establishmentType: "PUBLIQUE",
    technicalPlatform: "", servicesCsv: "",
    latitude: "", longitude: ""
  });

  async function loadChefCenter({ silent = false } = {}) {
    try {
      const data = await apiFetch("/centers", { token });
      const center = data?.[0];
      if (!center) { setCenterApprovalStatus(null); return; }
      setCenterId(center._id);
      setCenterApprovalStatus(String(center.approvalStatus || "").toUpperCase() || null);
      apiFetch(`/centers/${center._id}/checkin-code`, { token })
        .then((d) => setCheckinCode(d.checkinCode || ""))
        .catch(() => {});
      setForm({
        name: center.name || "",
        address: center.address || "",
        establishmentCode: center.establishmentCode || "",
        regionCode: center.regionCode || "",
        districtCode: center.districtCode || "",
        level: center.level || "CENTRE_SANTE",
        establishmentType: center.establishmentType || "PUBLIQUE",
        technicalPlatform: center.technicalPlatform || "",
        servicesCsv: Array.isArray(center.services) ? center.services.map((s) => s.name).join(", ") : "",
        latitude: String(center.location?.coordinates?.[1] || ""),
        longitude: String(center.location?.coordinates?.[0] || "")
      });
    } catch (err) {
      if (!silent) setError(err.message);
    }
  }

  async function loadComplaintsData({ silent = false } = {}) {
    if (!token) return;
    if (String(centerApprovalStatus || "").toUpperCase() !== "APPROVED") {
      setComplaintsList([]); setComplaintSummary(null); return;
    }
    try {
      setComplaintsLoading(true);
      const [complaintsData, summaryData] = await Promise.all([
        apiFetch("/complaints", { token }),
        apiFetch("/complaints/summary", { token })
      ]);
      setComplaintsList(Array.isArray(complaintsData) ? complaintsData : []);
      setComplaintSummary(summaryData || null);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      setComplaintsLoading(false);
    }
  }

  async function loadRegions({ silent = false } = {}) {
    if (!token) return;
    try {
      setGeoLoading(true);
      const data = await apiFetch("/geo/regions", { token });
      setRegions(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      setGeoLoading(false);
    }
  }

  async function loadDistricts(regionCode, { silent = false } = {}) {
    if (!token || !regionCode) { setDistricts([]); return; }
    try {
      const data = await apiFetch(`/geo/districts?regionCode=${encodeURIComponent(regionCode)}`, { token });
      setDistricts(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) setError(err.message);
      setDistricts([]);
    }
  }

  async function refreshAll({ silent = false } = {}) {
    const regionCode = String(form.regionCode || "").trim().toUpperCase();
    await Promise.all([loadChefCenter({ silent }), loadRegions({ silent }), loadDistricts(regionCode, { silent })]);
  }

  useEffect(() => {
    refreshAll({ silent: true }).catch(() => {});
    const interval = setInterval(() => refreshAll({ silent: true }).catch(() => {}), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    loadDistricts(String(form.regionCode || "").trim().toUpperCase(), { silent: true }).catch(() => {});
  }, [token, form.regionCode]);

  useEffect(() => {
    loadComplaintsData({ silent: true }).catch(() => {});
  }, [token, centerApprovalStatus]);

  async function confirmPatientVisit() {
    if (!visitPhone.trim()) {
      setVisitMsg({ text: "Entrez le numero de telephone du patient", ok: false });
      return;
    }
    setVisitLoading(true);
    setVisitMsg({ text: "", ok: true });
    try {
      await apiFetch(`/centers/${centerId}/confirm-visit`, {
        token,
        method: "POST",
        body: { patientPhone: visitPhone.trim() },
      });
      setVisitPhone("");
      setVisitMsg({ text: "Visite du patient confirmee", ok: true });
    } catch (err) {
      setVisitMsg({ text: err.message || "Erreur", ok: false });
    } finally {
      setVisitLoading(false);
    }
  }

  async function printQrCode() {
    if (!qrRef.current) return;
    setPrintingQr(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        qrRef.current.toDataURL((data) => (data ? resolve(data) : reject(new Error("QR indisponible"))));
      });
      const html = `
        <html>
          <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;font-family:Helvetica,Arial,sans-serif;">
            <h2 style="margin-bottom:4px;">${f.name || "Centre de sante"}</h2>
            <p style="color:#64748b;margin-top:0;">Scannez ce QR code pour enregistrer votre visite</p>
            <img src="data:image/png;base64,${dataUrl}" style="width:280px;height:280px;margin:24px 0;" />
            <p style="font-size:20px;font-weight:700;letter-spacing:2px;">${checkinCode}</p>
          </body>
        </html>
      `;
      await Print.printAsync({ html });
    } catch (err) {
      setVisitMsg({ text: err.message || "Impression impossible", ok: false });
    } finally {
      setPrintingQr(false);
    }
  }

  async function getCurrentPosition() {
    setError("");
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") { setError("Permission de localisation refusee"); return; }
    const current = await Location.getCurrentPositionAsync({});
    setForm((prev) => ({ ...prev, latitude: String(current.coords.latitude), longitude: String(current.coords.longitude) }));
  }

  async function createCenter() {
    setError(""); setMessage(""); setLoading(true);
    try {
      const result = await apiFetch(centerId ? `/centers/${centerId}` : "/centers", {
        token,
        method: centerId ? "PUT" : "POST",
        body: {
          name: form.name, address: form.address,
          establishmentCode: form.establishmentCode,
          regionCode: String(form.regionCode || "").trim().toUpperCase(),
          districtCode: String(form.districtCode || "").trim().toUpperCase() || null,
          level: form.level, establishmentType: form.establishmentType,
          technicalPlatform: form.technicalPlatform,
          latitude: Number(form.latitude), longitude: Number(form.longitude),
          services: parseServices(form.servicesCsv)
        }
      });
      setMessage(result?.queued ? result.message || "Action enregistree hors ligne." : centerId ? "Centre mis a jour et envoye en validation" : "Centre cree et envoye en validation");
      if (!result?.queued) {
        await refreshAll({ silent: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function addComplaintExplanation(complaintId) {
    const note = String(complaintNotes[complaintId] || "").trim();
    if (!note) { setError("Saisis une explication avant de valider."); return; }
    setError(""); setMessage(""); setComplaintActionLoadingId(String(complaintId));
    try {
      await apiFetch(`/complaints/${complaintId}/explanation`, { token, method: "POST", body: { message: note } });
      setComplaintNotes((prev) => ({ ...prev, [complaintId]: "" }));
      setMessage("Explication enregistree");
      await loadComplaintsData({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setComplaintActionLoadingId("");
    }
  }

  function formatComplaintStatus(status) {
    if (status === "NEW")         return "NOUVELLE";
    if (status === "IN_PROGRESS") return "EN COURS";
    if (status === "RESOLVED")    return "RESOLUE";
    if (status === "REJECTED")    return "REJETEE";
    return status || "-";
  }

  const f = form;
  function setF(key, v) { setForm((p) => ({ ...p, [key]: v })); }
  function registerInputRef(key, ref) {
    if (ref) inputRefs.current[key] = ref;
  }

  function scrollToField(key) {
    const input = inputRefs.current[key];
    const scroll = scrollRef.current;
    if (!input || !scroll || typeof input.measureLayout !== "function") return;
    const target = typeof scroll.getInnerViewNode === "function" ? scroll.getInnerViewNode() : scroll;
    requestAnimationFrame(() => {
      input.measureLayout(
        target,
        (_x, y) => scroll.scrollTo?.({ y: Math.max(0, y - 24), animated: true }),
        () => {}
      );
    });
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 12}
    >
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: ACCENT + "18" }]}>
          <Text style={styles.headerEmoji}>🏥</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{centerId ? "Mon centre de sante" : "Creer un centre"}</Text>
          <View style={styles.headerRow}>
            <Text style={styles.headerSub}>Statut: </Text>
            <ApprovalBadge status={centerApprovalStatus} />
          </View>
        </View>
      </View>

      {/* Infos generales */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>INFORMATIONS GENERALES</Text>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Nom du centre</Text>
          <TextInput ref={(ref) => registerInputRef("name", ref)} onFocus={() => scrollToField("name")} style={shared.input} placeholder="Nom du centre" value={f.name} onChangeText={(v) => setF("name", v)} />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Adresse</Text>
          <TextInput ref={(ref) => registerInputRef("address", ref)} onFocus={() => scrollToField("address")} style={shared.input} placeholder="Adresse complete" value={f.address} onChangeText={(v) => setF("address", v)} />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Code etablissement (optionnel)</Text>
          <TextInput ref={(ref) => registerInputRef("establishmentCode", ref)} onFocus={() => scrollToField("establishmentCode")} style={shared.input} placeholder="Ex: ABIDJAN-001" autoCapitalize="characters" value={f.establishmentCode} onChangeText={(v) => setF("establishmentCode", v)} />
        </View>
      </View>

      {/* Localisation */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>LOCALISATION</Text>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Region</Text>
          <TextInput ref={(ref) => registerInputRef("regionCode", ref)} onFocus={() => scrollToField("regionCode")} style={shared.input} placeholder="Code region (ex: ABIDJAN)" autoCapitalize="characters" value={f.regionCode} onChangeText={(v) => { setF("regionCode", v); setF("districtCode", ""); }} />
        </View>
        {regions.length ? (
          <View>
            <Text style={styles.fieldLabel}>Selection rapide region</Text>
            <View style={styles.chipGroup}>
              {regions.map((region) => (
                <Pressable key={region.code} style={[styles.chip, f.regionCode === region.code && styles.chipActive]} onPress={() => setForm((p) => ({ ...p, regionCode: region.code, districtCode: "" }))}>
                  <Text style={[styles.chipText, f.regionCode === region.code && styles.chipTextActive]}>{formatGeoOption(region)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {geoLoading ? <Text style={styles.geoLoading}>Chargement...</Text> : null}
      </View>

      {String(f.regionCode || "").trim() ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>DISTRICTS DE LA REGION</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>District (optionnel)</Text>
            <TextInput ref={(ref) => registerInputRef("districtCode", ref)} onFocus={() => scrollToField("districtCode")} style={shared.input} placeholder="Code district" autoCapitalize="characters" value={f.districtCode} onChangeText={(v) => setF("districtCode", v)} />
          </View>
          {districts.length ? (
            <View>
              <Text style={styles.fieldLabel}>Selection rapide district</Text>
              <View style={styles.chipGroup}>
                {districts.map((district) => (
                  <Pressable key={district.code} style={[styles.chip, f.districtCode === district.code && styles.chipActive]} onPress={() => setForm((p) => ({ ...p, districtCode: district.code }))}>
                    <Text style={[styles.chipText, f.districtCode === district.code && styles.chipTextActive]}>{formatGeoOption(district)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.geoLoading}>Aucun district charge pour cette region.</Text>
          )}
        </View>
      ) : null}

      {/* Classification */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>CLASSIFICATION</Text>
        <Text style={styles.fieldLabel}>Niveau d'etablissement</Text>
        <View style={styles.chipGroup}>
          {LEVEL_OPTIONS.map((option) => (
            <Pressable key={option.value} style={[styles.chip, f.level === option.value && styles.chipActive]} onPress={() => setF("level", option.value)}>
              <Text style={[styles.chipText, f.level === option.value && styles.chipTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Type d'etablissement</Text>
        <View style={styles.chipGroup}>
          {ESTABLISHMENT_TYPE_OPTIONS.map((option) => (
            <Pressable key={option.value} style={[styles.chip, f.establishmentType === option.value && styles.chipActive]} onPress={() => setF("establishmentType", option.value)}>
              <Text style={[styles.chipText, f.establishmentType === option.value && styles.chipTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Services */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>SERVICES & PLATEAU TECHNIQUE</Text>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Plateau technique</Text>
          <TextInput ref={(ref) => registerInputRef("technicalPlatform", ref)} onFocus={() => scrollToField("technicalPlatform")} style={[shared.input, shared.textArea]} multiline placeholder="Plateau technique" value={f.technicalPlatform} onChangeText={(v) => setF("technicalPlatform", v)} />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Services (separes par virgule)</Text>
          <TextInput ref={(ref) => registerInputRef("servicesCsv", ref)} onFocus={() => scrollToField("servicesCsv")} style={shared.input} placeholder="Urgences, Radiologie, Pediatrie..." value={f.servicesCsv} onChangeText={(v) => setF("servicesCsv", v)} />
        </View>
      </View>

      {/* GPS */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>COORDONNEES GPS</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Latitude</Text>
            <TextInput ref={(ref) => registerInputRef("latitude", ref)} onFocus={() => scrollToField("latitude")} style={shared.input} keyboardType="numeric" placeholder="5.3600" value={f.latitude} onChangeText={(v) => setF("latitude", v)} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Longitude</Text>
            <TextInput ref={(ref) => registerInputRef("longitude", ref)} onFocus={() => scrollToField("longitude")} style={shared.input} keyboardType="numeric" placeholder="-4.0083" value={f.longitude} onChangeText={(v) => setF("longitude", v)} />
          </View>
        </View>
        <Pressable style={styles.outlineBtn} onPress={getCurrentPosition}>
          <Text style={styles.outlineBtnText}>📍 Utiliser ma position GPS</Text>
        </Pressable>
      </View>

      {message ? <Text style={shared.success}>{message}</Text> : null}
      {error   ? <Text style={shared.error}>{error}</Text>     : null}

      <View style={styles.row}>
        <Pressable style={styles.outlineBtn} onPress={() => { setError(""); setMessage(""); refreshAll({ silent: false }).catch(() => {}); loadComplaintsData({ silent: true }).catch(() => {}); }}>
          <Text style={styles.outlineBtnText}>Actualiser</Text>
        </Pressable>
        <Pressable style={[styles.primaryBtn, { flex: 1 }, loading && { opacity: 0.6 }]} onPress={createCenter} disabled={loading}>
          <Text style={styles.primaryBtnText}>{loading ? "Enregistrement..." : centerId ? "Mettre a jour" : "Enregistrer le centre"}</Text>
        </Pressable>
      </View>

      {/* Panel plaintes */}
      {centerApprovalStatus === "APPROVED" ? (
        <View style={styles.complaintsPanel}>
          <Text style={styles.sectionLabel}>SUIVI DU CENTRE APPROUVE</Text>

          {complaintSummary ? (
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{complaintSummary.ratingAverage ?? "-"}</Text>
                <Text style={styles.statLabel}>Note moy.</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{complaintSummary.satisfactionRate == null ? "-" : `${complaintSummary.satisfactionRate}%`}</Text>
                <Text style={styles.statLabel}>Satisfaction</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{complaintSummary.complaints?.total ?? 0}</Text>
                <Text style={styles.statLabel}>Plaintes</Text>
              </View>
            </View>
          ) : null}

          {/* QR code + code texte de visite */}
          {checkinCode ? (
            <View style={styles.visitCodeCard}>
              <Text style={styles.visitCodeLabel}>QR CODE DE VISITE</Text>
              <View style={styles.qrWrapper}>
                <QRCode
                  value={`SANTE:${centerId}:${checkinCode}`}
                  size={180}
                  color={C.primary}
                  backgroundColor="#ffffff"
                  getRef={(ref) => (qrRef.current = ref)}
                />
              </View>
              <Text style={styles.visitCodeValue}>{checkinCode}</Text>
              <Text style={styles.visitCodeHint}>
                Affichez ce QR code a l'accueil. Les patients le scannent ou saisissent le code pour enregistrer leur visite.
              </Text>
              <Pressable style={[styles.outlineBtn, printingQr && { opacity: 0.6 }]} onPress={printQrCode} disabled={printingQr}>
                <Text style={styles.outlineBtnText}>{printingQr ? "Preparation..." : "🖨️ Imprimer le QR code"}</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.visitConfirmCard}>
            <Text style={styles.sectionLabel}>CONFIRMER UNE VISITE PATIENT</Text>
            <Text style={styles.visitConfirmHint}>Entrez le numero du patient pour confirmer sa visite manuellement.</Text>
            <TextInput
              style={shared.input}
              value={visitPhone}
              onChangeText={(v) => { setVisitPhone(v); setVisitMsg({ text: "", ok: true }); }}
              placeholder="Numero de telephone du patient"
              keyboardType="phone-pad"
            />
            {visitMsg.text ? (
              <Text style={[styles.visitMsgText, { color: visitMsg.ok ? C.green : C.red }]}>{visitMsg.text}</Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, visitLoading && { opacity: 0.6 }]}
              onPress={confirmPatientVisit}
              disabled={visitLoading}
            >
              <Text style={styles.primaryBtnText}>{visitLoading ? "Confirmation..." : "Confirmer la visite"}</Text>
            </Pressable>
          </View>

          {complaintsLoading ? <Text style={styles.geoLoading}>Chargement des plaintes...</Text> : null}
          {!complaintsLoading && complaintsList.length === 0 ? <Text style={shared.hint}>Aucune plainte pour votre centre.</Text> : null}

          {complaintsList.map((item) => (
            <View key={item.id} style={styles.complaintCard}>
              <View style={styles.complaintTop}>
                <Text style={styles.complaintSubject}>{item.subject}</Text>
                <View style={[styles.badge, { backgroundColor: item.status === "RESOLVED" ? C.greenLight : C.primaryLight }]}>
                  <Text style={[styles.badgeText, { color: item.status === "RESOLVED" ? C.green : C.primary }]}>
                    {formatComplaintStatus(item.status)}
                  </Text>
                </View>
              </View>
              <Text style={styles.complaintBody}>{item.message}</Text>
              <TextInput
                ref={(ref) => registerInputRef(`complaint-${item.id}`, ref)}
                onFocus={() => scrollToField(`complaint-${item.id}`)}
                style={[shared.input, shared.textArea]}
                multiline
                placeholder="Ajouter une explication..."
                value={complaintNotes[item.id] || ""}
                onChangeText={(value) => setComplaintNotes((prev) => ({ ...prev, [item.id]: value }))}
              />
              <Pressable style={[styles.outlineBtn, complaintActionLoadingId === String(item.id) && { opacity: 0.5 }]} onPress={() => addComplaintExplanation(item.id)} disabled={complaintActionLoadingId === String(item.id)}>
                <Text style={styles.outlineBtnText}>{complaintActionLoadingId === String(item.id) ? "..." : "Ajouter explication"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { padding: 16, gap: 14, paddingBottom: 32 },

  header:      { flexDirection: "row", alignItems: "center", gap: 14 },
  headerIcon:  { width: 52, height: 52, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  headerEmoji: { fontSize: 26 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.textDark },
  headerRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  headerSub:   { fontSize: 13, color: C.textMuted },

  card: {
    backgroundColor: C.surface, borderRadius: R.md,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 3, borderLeftColor: ACCENT,
    padding: 14, gap: 10, ...S.sm,
  },
  sectionLabel: { fontSize: 10, fontWeight: "800", color: C.textMuted, letterSpacing: 1 },
  fieldGroup:   { gap: 4 },
  fieldLabel:   { fontSize: 12, fontWeight: "700", color: C.textMed },
  geoLoading:   { color: ACCENT, fontWeight: "600", fontSize: 13 },

  chipGroup:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:           { borderWidth: 1.5, borderColor: C.border, borderRadius: R.full, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surfaceAlt },
  chipActive:     { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText:       { color: C.textMed, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#fff" },

  row:            { flexDirection: "row", gap: 10, alignItems: "center" },
  outlineBtn:     { borderWidth: 1.5, borderColor: ACCENT, borderRadius: R.sm, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
  outlineBtnText: { color: ACCENT, fontWeight: "700", fontSize: 13 },
  primaryBtn:     { backgroundColor: ACCENT, borderRadius: R.sm, paddingVertical: 12, alignItems: "center", ...S.sm },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  badge:     { borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },

  complaintsPanel: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 14, gap: 12 },
  statsRow:  { flexDirection: "row", gap: 10 },
  statCard:  { flex: 1, backgroundColor: ACCENT + "15", borderRadius: R.sm, borderWidth: 1, borderColor: ACCENT + "30", padding: 12, alignItems: "center", gap: 2 },
  statValue: { fontSize: 22, fontWeight: "800", color: ACCENT },
  statLabel: { fontSize: 11, color: C.textMuted, textAlign: "center" },

  complaintCard:    { backgroundColor: C.surfaceAlt, borderRadius: R.sm, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  complaintTop:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  complaintSubject: { fontWeight: "700", color: C.textDark, flex: 1, marginRight: 8 },
  complaintBody:    { color: C.textMuted, fontSize: 13 },

  visitCodeCard: {
    backgroundColor: C.primaryLight,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.primary + "40",
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  visitCodeLabel: { fontSize: 10, fontWeight: "800", color: C.primary, letterSpacing: 1 },
  qrWrapper: {
    backgroundColor: "#ffffff",
    padding: 12,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.primary + "30",
    ...S.md,
  },
  visitCodeValue: { fontSize: 32, fontWeight: "900", color: C.primary, letterSpacing: 8 },
  visitCodeHint:  { fontSize: 11, color: C.textMed, textAlign: "center", lineHeight: 16 },

  visitConfirmCard: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    borderLeftColor: C.green,
    padding: 14,
    gap: 10,
  },
  visitConfirmHint: { fontSize: 12, color: C.textMuted },
  visitMsgText:     { fontSize: 13, fontWeight: "600" },
});
