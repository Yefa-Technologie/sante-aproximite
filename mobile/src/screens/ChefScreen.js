import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Print from "expo-print";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { apiFetch } from "../api/client";
import { DropdownField } from "../components/DropdownField";
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

export function ChefScreen({ initialSection } = {}) {
  const { token, user } = useAuth();
  const scrollRef = useRef(null);
  const inputRefs = useRef({});
  const centerCacheKey = user?.id ? `sante_aproxmite_chef_center_${user.id}` : null;
  const [centerId, setCenterId]                         = useState("");
  const [centerChecked, setCenterChecked]               = useState(false);
  const [centerApprovalStatus, setCenterApprovalStatus] = useState(null);
  const [error, setError]                               = useState("");
  const [message, setMessage]                           = useState("");
  const [loading, setLoading]                           = useState(false);
  const [complaintsLoading, setComplaintsLoading]       = useState(false);
  const [complaintsList, setComplaintsList]             = useState([]);
  const [complaintSummary, setComplaintSummary]         = useState(null);
  const [complaintNotes, setComplaintNotes]             = useState({});
  const [complaintActionLoadingId, setComplaintActionLoadingId] = useState("");
  const [suggestionsLoading, setSuggestionsLoading]     = useState(false);
  const [suggestionsList, setSuggestionsList]           = useState([]);
  const [suggestionActionLoadingId, setSuggestionActionLoadingId] = useState("");
  const [suggestionNotice, setSuggestionNotice]         = useState("");
  const suggestionsUnreadCountRef = useRef(0);
  const suggestionNoticeTimeoutRef = useRef(null);
  const [regions, setRegions]                           = useState([]);
  const [districts, setDistricts]                       = useState([]);
  const [geoLoading, setGeoLoading]                     = useState(false);
  const [checkinCode, setCheckinCode]                   = useState("");
  const [feedbackUrl, setFeedbackUrl]                   = useState("");
  const [qrFeedbackList, setQrFeedbackList]             = useState([]);
  const [qrFeedbackLoading, setQrFeedbackLoading]       = useState(false);
  const [qrFeedbackFilter, setQrFeedbackFilter]         = useState("ALL");
  const [qrFeedbackActionId, setQrFeedbackActionId]     = useState("");
  // Message affiche en entier dans la fenetre "Detail" : { source: "QR" | "SUGGESTION", item }
  const [messageDetail, setMessageDetail]               = useState(null);
  const [printingQr, setPrintingQr]                     = useState(false);
  const qrRef = useRef(null);
  const [visitPhone, setVisitPhone]                     = useState("");
  const [visitLoading, setVisitLoading]                 = useState(false);
  const [visitMsg, setVisitMsg]                         = useState({ text: "", ok: true });
  const [referralsLoading, setReferralsLoading]         = useState(false);
  const [referralsList, setReferralsList]               = useState([]);
  const [referralActionLoadingId, setReferralActionLoadingId] = useState("");
  const [referralRejectingId, setReferralRejectingId]   = useState("");
  const [referralRejectDrafts, setReferralRejectDrafts] = useState({});
  // Service d'admission choisi a la reception quand l'orientation n'en precise pas.
  const [referralServiceDrafts, setReferralServiceDrafts] = useState({});
  const [referralNotice, setReferralNotice]             = useState(null);
  const [activeSection, setActiveSection]               = useState("info");
  const [skipCodeGate, setSkipCodeGate]                 = useState(false);
  const [claimCode, setClaimCode]                       = useState("");
  const [claimLoading, setClaimLoading]                 = useState(false);
  const [claimError, setClaimError]                     = useState("");
  const [claimNotFound, setClaimNotFound]               = useState(false);
  const [isEditingCenter, setIsEditingCenter]           = useState(false);
  const [openDropdown, setOpenDropdown]                 = useState(null);
  const [centerServices, setCenterServices]             = useState([]);
  const [serviceActionLoadingName, setServiceActionLoadingName] = useState("");
  const [editingServiceName, setEditingServiceName]     = useState("");
  const [serviceEditDraft, setServiceEditDraft]         = useState({ name: "", description: "", bedsAvailable: "" });
  const [serviceError, setServiceError]                 = useState("");
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
      if (!center) {
        setCenterApprovalStatus(null);
        setCenterChecked(true);
        if (centerCacheKey) AsyncStorage.removeItem(centerCacheKey).catch(() => {});
        return;
      }
      setCenterId(center._id);
      setCenterChecked(true);
      if (centerCacheKey) AsyncStorage.setItem(centerCacheKey, String(center._id)).catch(() => {});
      setCenterApprovalStatus(String(center.approvalStatus || "").toUpperCase() || null);
      apiFetch(`/centers/${center._id}/checkin-code`, { token })
        .then((d) => { setCheckinCode(d.checkinCode || ""); setFeedbackUrl(d.feedbackUrl || ""); })
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
      setCenterServices(Array.isArray(center.services) ? center.services : []);
    } catch (err) {
      setCenterChecked(true);
      if (!silent) setError(err.message);
    }
  }

  async function adjustServiceBeds(serviceName, adjust) {
    setServiceError("");
    setServiceActionLoadingName(serviceName);
    try {
      await apiFetch(`/centers/${centerId}/services/${encodeURIComponent(serviceName)}`, {
        token,
        method: "PATCH",
        body: { adjust },
      });
      await loadChefCenter({ silent: true });
    } catch (err) {
      setServiceError(err.message);
    } finally {
      setServiceActionLoadingName("");
    }
  }

  function startEditService(service) {
    setEditingServiceName(service.name);
    setServiceEditDraft({
      name: service.name,
      description: service.description || "",
      bedsAvailable: String(service.bedsAvailable ?? 0),
    });
    setServiceError("");
  }

  async function saveServiceEdit() {
    setServiceError("");
    setServiceActionLoadingName(editingServiceName);
    try {
      await apiFetch(`/centers/${centerId}/services/${encodeURIComponent(editingServiceName)}`, {
        token,
        method: "PATCH",
        body: {
          name: serviceEditDraft.name.trim(),
          description: serviceEditDraft.description.trim(),
          bedsAvailable: Number(serviceEditDraft.bedsAvailable) || 0,
        },
      });
      setEditingServiceName("");
      await loadChefCenter({ silent: true });
    } catch (err) {
      setServiceError(err.message);
    } finally {
      setServiceActionLoadingName("");
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

  function showSuggestionNotice(text) {
    if (suggestionNoticeTimeoutRef.current) clearTimeout(suggestionNoticeTimeoutRef.current);
    setSuggestionNotice(text);
    suggestionNoticeTimeoutRef.current = setTimeout(() => {
      setSuggestionNotice("");
      suggestionNoticeTimeoutRef.current = null;
    }, 6000);
  }

  async function loadSuggestionsData({ silent = false, notifyOnNew = false } = {}) {
    if (!token || !centerId) return;
    if (String(centerApprovalStatus || "").toUpperCase() !== "APPROVED") {
      setSuggestionsList([]); suggestionsUnreadCountRef.current = 0; return;
    }
    try {
      setSuggestionsLoading(true);
      const data = await apiFetch(`/centers/${centerId}/suggestions`, { token });
      const list = Array.isArray(data) ? data : [];
      setSuggestionsList(list);
      const unreadCount = list.filter((item) => !item.isRead).length;
      if (notifyOnNew && unreadCount > suggestionsUnreadCountRef.current) {
        showSuggestionNotice("Nouvelle observation reçue");
      }
      suggestionsUnreadCountRef.current = unreadCount;
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function loadQrFeedbackData({ silent = false, notifyOnNew = false } = {}) {
    if (!token || !centerId || String(centerApprovalStatus || "").toUpperCase() !== "APPROVED") {
      setQrFeedbackList([]); return;
    }
    try {
      if (!silent) setQrFeedbackLoading(true);
      const data = await apiFetch(`/centers/${centerId}/qr-feedback`, { token });
      const list = Array.isArray(data) ? data : [];
      setQrFeedbackList((previous) => {
        const previousUnread = previous.filter((item) => !item.isRead).length;
        const unread = list.filter((item) => !item.isRead).length;
        if (notifyOnNew && unread > previousUnread) showSuggestionNotice("Nouveau message recu via le QR code");
        return list;
      });
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      setQrFeedbackLoading(false);
    }
  }

  async function markQrFeedbackRead(feedbackId) {
    setQrFeedbackActionId(String(feedbackId));
    try {
      const updated = await apiFetch(`/centers/${centerId}/qr-feedback/${feedbackId}/read`, { token, method: "PATCH" });
      setQrFeedbackList((list) => list.map((item) => (item._id === updated._id ? updated : item)));
    } catch (err) {
      setError(err.message);
    } finally {
      setQrFeedbackActionId("");
    }
  }

  async function markSuggestionRead(suggestionId) {
    setSuggestionActionLoadingId(String(suggestionId));
    try {
      await apiFetch(`/suggestions/${suggestionId}/read`, { token, method: "PATCH" });
      await loadSuggestionsData({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSuggestionActionLoadingId("");
    }
  }

  async function loadReferralsData({ silent = false } = {}) {
    if (!token) return;
    if (String(centerApprovalStatus || "").toUpperCase() !== "APPROVED") {
      setReferralsList([]); return;
    }
    try {
      setReferralsLoading(true);
      const data = await apiFetch("/referrals/incoming", { token });
      setReferralsList(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      setReferralsLoading(false);
    }
  }

  async function releaseReferralBed(referralId) {
    setReferralActionLoadingId(String(referralId));
    setReferralNotice(null);
    try {
      const result = await apiFetch(`/referrals/${referralId}/release-bed`, { token, method: "POST" });
      setReferralNotice({ text: result?.message || "Place liberee", ok: true });
      await loadReferralsData({ silent: true });
      refreshAll({ silent: true }).catch(() => {});
    } catch (err) {
      setReferralNotice({ text: err.message, ok: false });
    } finally {
      setReferralActionLoadingId("");
    }
  }

  async function confirmReferralReception(referralId, serviceName) {
    setReferralActionLoadingId(String(referralId));
    setReferralNotice(null);
    try {
      const result = await apiFetch(`/referrals/${referralId}/confirm`, {
        token,
        method: "POST",
        body: serviceName ? { serviceName } : {},
      });
      setReferralNotice(result?.warning
        ? { text: result.warning, ok: false }
        : { text: result?.message || "Reception confirmee", ok: true });
      await loadReferralsData({ silent: true });
      refreshAll({ silent: true }).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setReferralActionLoadingId("");
    }
  }

  async function rejectReferralReception(referralId) {
    const reason = String(referralRejectDrafts[referralId] || "").trim();
    if (!reason) {
      setError("Indiquez un motif de rejet");
      return;
    }
    setReferralActionLoadingId(String(referralId));
    try {
      await apiFetch(`/referrals/${referralId}/reject`, { token, method: "POST", body: { reason } });
      setReferralRejectDrafts((prev) => { const next = { ...prev }; delete next[referralId]; return next; });
      setReferralRejectingId("");
      await loadReferralsData({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setReferralActionLoadingId("");
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
    if (!centerCacheKey) return;
    AsyncStorage.getItem(centerCacheKey)
      .then((cached) => { if (cached) setCenterId(cached); })
      .catch(() => {});
  }, [centerCacheKey]);

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

  useEffect(() => {
    loadSuggestionsData({ silent: true }).catch(() => {});
    loadQrFeedbackData({ silent: true }).catch(() => {});
    const interval = setInterval(() => {
      loadSuggestionsData({ silent: true, notifyOnNew: true }).catch(() => {});
      loadQrFeedbackData({ silent: true, notifyOnNew: true }).catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [token, centerId, centerApprovalStatus]);

  useEffect(() => {
    loadReferralsData({ silent: true }).catch(() => {});
    const interval = setInterval(() => {
      loadReferralsData({ silent: true }).catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [token, centerId, centerApprovalStatus]);

  useEffect(() => {
    return () => {
      if (suggestionNoticeTimeoutRef.current) clearTimeout(suggestionNoticeTimeoutRef.current);
    };
  }, []);

  const isApproved = String(centerApprovalStatus || "").toUpperCase() === "APPROVED";
  const referralsPendingCount = referralsList.filter((item) => item.status === "PENDING").length;
  const suggestionsUnreadCount = suggestionsList.filter((item) => !item.isRead).length;
  const qrFeedbackUnreadCount = qrFeedbackList.filter((item) => !item.isRead).length;
  const filteredQrFeedback = qrFeedbackFilter === "ALL"
    ? qrFeedbackList
    : qrFeedbackFilter === "UNREAD"
      ? qrFeedbackList.filter((item) => !item.isRead)
      : qrFeedbackList.filter((item) => item.kind === qrFeedbackFilter);

  useEffect(() => {
    if (!isApproved && activeSection !== "info") setActiveSection("info");
  }, [isApproved, activeSection]);

  const pendingSectionRef = useRef(initialSection || "");
  useEffect(() => {
    if (isApproved && pendingSectionRef.current) {
      setActiveSection(pendingSectionRef.current);
      pendingSectionRef.current = "";
    }
  }, [isApproved]);

  function openMessageDetail(source, item) {
    setMessageDetail({ source, item });
    // Ouvrir le detail vaut lecture du message.
    if (!item.isRead) {
      if (source === "QR") markQrFeedbackRead(item._id).catch(() => {});
      else markSuggestionRead(item.id).catch(() => {});
    }
  }

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
            <h1 style="margin:18px 0 0;color:#1A56DB;">Votre avis compte</h1>
            <p style="color:#334155;font-size:18px;text-align:center;max-width:420px;">Scannez ce QR code avec l'appareil photo de votre telephone pour nous transmettre une observation ou une suggestion.</p>
            <img src="data:image/png;base64,${dataUrl}" style="width:300px;height:300px;margin:24px 0;" />
            <p style="color:#64748b;">Aucune application ni compte necessaire. Seul le centre lit vos messages.</p>
            <p style="color:#64748b;margin-top:24px;">Code de visite : <b style="letter-spacing:2px;">${checkinCode}</b></p>
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

  async function claimByCode() {
    const code = claimCode.trim();
    if (!code) {
      setClaimError("Entrez le code de votre etablissement");
      return;
    }
    setClaimLoading(true);
    setClaimError("");
    setClaimNotFound(false);
    try {
      await apiFetch("/centers/claim-by-code", { token, method: "POST", body: { code } });
      await refreshAll({ silent: true });
    } catch (err) {
      if (err.status === 404) {
        setClaimNotFound(true);
      } else {
        setClaimError(err.message || "Erreur");
      }
    } finally {
      setClaimLoading(false);
    }
  }

  function createWithClaimCode() {
    setF("establishmentCode", claimCode.trim());
    setSkipCodeGate(true);
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
        setIsEditingCenter(false);
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

  function scrollToField() {
    // no-op: measureLayout against the ScrollView ref is unsupported on the new
    // architecture (logs "ref.measureLayout must be called with a ref to a
    // native component" instead of throwing a catchable error) - disabled.
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

      {!centerChecked && !centerId ? (
        <View style={styles.card}>
          <Text style={styles.visitConfirmHint}>Chargement...</Text>
        </View>
      ) : !centerId && !skipCodeGate ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>CODE DE L'ETABLISSEMENT</Text>
          <Text style={styles.visitConfirmHint}>
            Si votre etablissement existe deja dans la base (import officiel), entrez son code pour recuperer ses informations. Sinon, creez un nouveau centre.
          </Text>
          <TextInput
            placeholderTextColor="#94a3b8"
            style={shared.input}
            value={claimCode}
            onChangeText={(v) => { setClaimCode(v); setClaimError(""); setClaimNotFound(false); }}
            placeholder="Code etablissement"
            autoCapitalize="characters"
          />
          {claimError ? <Text style={shared.error}>{claimError}</Text> : null}
          {claimNotFound ? (
            <View style={{ gap: 8 }}>
              <Text style={shared.error}>Aucun centre trouve avec ce code.</Text>
              <Pressable style={styles.primaryBtn} onPress={createWithClaimCode}>
                <Text style={styles.primaryBtnText}>Creer un nouveau centre avec ce code</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.row}>
            <Pressable style={styles.outlineBtn} onPress={() => setSkipCodeGate(true)}>
              <Text style={styles.outlineBtnText}>Creer sans code</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, { flex: 1 }, claimLoading && { opacity: 0.6 }]}
              onPress={claimByCode}
              disabled={claimLoading}
            >
              <Text style={styles.primaryBtnText}>{claimLoading ? "Verification..." : "Verifier le code"}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
      <>
      {/* Navigation secondaire */}
      <View style={styles.sectionNav}>
        <Pressable
          style={[styles.sectionNavItem, activeSection === "info" && styles.sectionNavItemActive]}
          onPress={() => setActiveSection("info")}
        >
          <Text style={[styles.sectionNavText, activeSection === "info" && styles.sectionNavTextActive]}>Mon centre</Text>
        </Pressable>
        {isApproved ? (
          <Pressable
            style={[styles.sectionNavItem, activeSection === "suivi" && styles.sectionNavItemActive]}
            onPress={() => setActiveSection("suivi")}
          >
            <Text style={[styles.sectionNavText, activeSection === "suivi" && styles.sectionNavTextActive]}>Suivi patients</Text>
            {referralsPendingCount > 0 ? (
              <View style={styles.sectionNavBadge}>
                <Text style={styles.sectionNavBadgeText}>{referralsPendingCount}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {isApproved ? (
          <Pressable
            style={[styles.sectionNavItem, activeSection === "retours" && styles.sectionNavItemActive]}
            onPress={() => setActiveSection("retours")}
          >
            <Text style={[styles.sectionNavText, activeSection === "retours" && styles.sectionNavTextActive]}>Retours usagers</Text>
            {suggestionsUnreadCount > 0 ? (
              <View style={styles.sectionNavBadge}>
                <Text style={styles.sectionNavBadgeText}>{suggestionsUnreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {isApproved ? (
          <Pressable
            style={[styles.sectionNavItem, activeSection === "avis" && styles.sectionNavItemActive]}
            onPress={() => { setActiveSection("avis"); loadQrFeedbackData().catch(() => {}); }}
          >
            <Text style={[styles.sectionNavText, activeSection === "avis" && styles.sectionNavTextActive]}>Observations & suggestions</Text>
            {qrFeedbackUnreadCount > 0 ? (
              <View style={styles.sectionNavBadge}>
                <Text style={styles.sectionNavBadgeText}>{qrFeedbackUnreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      {message ? <Text style={shared.success}>{message}</Text> : null}
      {error   ? <Text style={shared.error}>{error}</Text>     : null}

      {activeSection === "info" ? (
      <>
      {centerId && !isEditingCenter ? (
        <View style={styles.card}>
          <View style={[styles.headerRow, { justifyContent: "space-between" }]}>
            <Text style={styles.sectionLabel}>INFORMATIONS DU CENTRE</Text>
            <Pressable style={styles.outlineBtn} onPress={() => setIsEditingCenter(true)}>
              <Text style={styles.outlineBtnText}>Modifier</Text>
            </Pressable>
          </View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Nom</Text><Text style={styles.summaryValue}>{f.name || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Adresse</Text><Text style={styles.summaryValue}>{f.address || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Code etablissement</Text><Text style={styles.summaryValue}>{f.establishmentCode || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Region</Text><Text style={styles.summaryValue}>{formatGeoOption(regions.find((r) => r.code === f.regionCode)) || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>District</Text><Text style={styles.summaryValue}>{formatGeoOption(districts.find((d) => d.code === f.districtCode)) || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Niveau</Text><Text style={styles.summaryValue}>{LEVEL_OPTIONS.find((o) => o.value === f.level)?.label || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Type</Text><Text style={styles.summaryValue}>{ESTABLISHMENT_TYPE_OPTIONS.find((o) => o.value === f.establishmentType)?.label || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Plateau technique</Text><Text style={styles.summaryValue}>{f.technicalPlatform || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Services</Text><Text style={styles.summaryValue}>{f.servicesCsv || "-"}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>GPS</Text><Text style={styles.summaryValue}>{f.latitude}, {f.longitude}</Text></View>
        </View>
      ) : null}

      {centerId && !isEditingCenter ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PLACES DISPONIBLES</Text>
          {serviceError ? <Text style={shared.error}>{serviceError}</Text> : null}
          {centerServices.length === 0 ? (
            <Text style={shared.hint}>Aucun service enregistre pour ce centre.</Text>
          ) : null}
          {centerServices.map((service) => (
            <View key={service.name} style={styles.serviceCard}>
              {editingServiceName === service.name ? (
                <View style={{ gap: 8 }}>
                  <TextInput
                    placeholderTextColor="#94a3b8"
                    style={shared.input}
                    value={serviceEditDraft.name}
                    onChangeText={(v) => setServiceEditDraft((p) => ({ ...p, name: v }))}
                    placeholder="Nom du service"
                  />
                  <TextInput
                    placeholderTextColor="#94a3b8"
                    style={shared.input}
                    value={serviceEditDraft.description}
                    onChangeText={(v) => setServiceEditDraft((p) => ({ ...p, description: v }))}
                    placeholder="Description (optionnel)"
                  />
                  <TextInput
                    placeholderTextColor="#94a3b8"
                    style={shared.input}
                    value={serviceEditDraft.bedsAvailable}
                    onChangeText={(v) => setServiceEditDraft((p) => ({ ...p, bedsAvailable: v }))}
                    placeholder="Places disponibles"
                    keyboardType="numeric"
                  />
                  <View style={styles.row}>
                    <Pressable style={styles.outlineBtn} onPress={() => setEditingServiceName("")}>
                      <Text style={styles.outlineBtnText}>Annuler</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryBtn, { flex: 1 }, serviceActionLoadingName === service.name && { opacity: 0.6 }]}
                      onPress={saveServiceEdit}
                      disabled={serviceActionLoadingName === service.name}
                    >
                      <Text style={styles.primaryBtnText}>
                        {serviceActionLoadingName === service.name ? "..." : "Enregistrer"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.complaintTop}>
                    <Text style={styles.complaintSubject}>{service.name}</Text>
                    <View style={[styles.badge, { backgroundColor: service.bedsAvailable > 0 ? C.greenLight : C.redLight }]}>
                      <Text style={[styles.badgeText, { color: service.bedsAvailable > 0 ? C.green : C.red }]}>
                        {service.bedsAvailable > 0 ? `${service.bedsAvailable} PLACE(S)` : "COMPLET"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.complaintBody}>
                    Occupees: {service.bedsOccupied} · Hors service: {service.bedsOutOfService}
                  </Text>
                  <View style={styles.row}>
                    <Pressable
                      style={[styles.outlineBtn, (serviceActionLoadingName === service.name || service.bedsAvailable <= 0) && { opacity: 0.5 }]}
                      onPress={() => adjustServiceBeds(service.name, "occupy")}
                      disabled={serviceActionLoadingName === service.name || service.bedsAvailable <= 0}
                    >
                      <Text style={styles.outlineBtnText}>Occuper une place</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.outlineBtn, (serviceActionLoadingName === service.name || service.bedsOccupied <= 0) && { opacity: 0.5 }]}
                      onPress={() => adjustServiceBeds(service.name, "free")}
                      disabled={serviceActionLoadingName === service.name || service.bedsOccupied <= 0}
                    >
                      <Text style={styles.outlineBtnText}>Liberer une place</Text>
                    </Pressable>
                    <Pressable style={styles.outlineBtn} onPress={() => startEditService(service)}>
                      <Text style={styles.outlineBtnText}>Modifier</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {centerId && !isEditingCenter ? null : (
      <>
      {/* Infos generales */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>INFORMATIONS GENERALES</Text>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Nom du centre <Text style={styles.requiredMark}>*</Text></Text>
          <TextInput placeholderTextColor="#94a3b8" ref={(ref) => registerInputRef("name", ref)} onFocus={() => scrollToField("name")} style={shared.input} placeholder="Nom du centre" value={f.name} onChangeText={(v) => setF("name", v)} />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Adresse <Text style={styles.requiredMark}>*</Text></Text>
          <TextInput placeholderTextColor="#94a3b8" ref={(ref) => registerInputRef("address", ref)} onFocus={() => scrollToField("address")} style={shared.input} placeholder="Adresse complete" value={f.address} onChangeText={(v) => setF("address", v)} />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Code etablissement (optionnel)</Text>
          <TextInput placeholderTextColor="#94a3b8" ref={(ref) => registerInputRef("establishmentCode", ref)} onFocus={() => scrollToField("establishmentCode")} style={shared.input} placeholder="Ex: ABIDJAN-001" autoCapitalize="characters" value={f.establishmentCode} onChangeText={(v) => setF("establishmentCode", v)} />
        </View>
      </View>

      {/* Localisation */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>LOCALISATION</Text>
        <DropdownField
          label="Region *"
          placeholder="- Selectionner une region -"
          selectedLabel={formatGeoOption(regions.find((r) => r.code === f.regionCode))}
          options={regions}
          getOptionKey={(option) => option.code}
          renderOption={formatGeoOption}
          isOpen={openDropdown === "region"}
          onToggle={() => setOpenDropdown((prev) => (prev === "region" ? null : "region"))}
          onSelect={(code) => {
            setForm((p) => ({ ...p, regionCode: code, districtCode: "" }));
            setOpenDropdown(null);
          }}
          emptyText="Aucune region disponible."
        />
        {geoLoading ? <Text style={styles.geoLoading}>Chargement...</Text> : null}
      </View>

      {String(f.regionCode || "").trim() ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>DISTRICTS DE LA REGION</Text>
          <DropdownField
            label="District (optionnel)"
            placeholder="- Selectionner un district -"
            selectedLabel={formatGeoOption(districts.find((d) => d.code === f.districtCode))}
            options={districts}
            getOptionKey={(option) => option.code}
            renderOption={formatGeoOption}
            isOpen={openDropdown === "district"}
            onToggle={() => setOpenDropdown((prev) => (prev === "district" ? null : "district"))}
            onSelect={(code) => {
              setF("districtCode", code);
              setOpenDropdown(null);
            }}
            emptyText="Aucun district charge pour cette region."
          />
        </View>
      ) : null}

      {/* Classification */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>CLASSIFICATION</Text>
        <Text style={styles.fieldLabel}>Niveau d'etablissement <Text style={styles.requiredMark}>*</Text></Text>
        <View style={styles.chipGroup}>
          {LEVEL_OPTIONS.map((option) => (
            <Pressable key={option.value} style={[styles.chip, f.level === option.value && styles.chipActive]} onPress={() => setF("level", option.value)}>
              <Text style={[styles.chipText, f.level === option.value && styles.chipTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Type d'etablissement <Text style={styles.requiredMark}>*</Text></Text>
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
          <Text style={styles.fieldLabel}>Plateau technique <Text style={styles.requiredMark}>*</Text></Text>
          <TextInput placeholderTextColor="#94a3b8" ref={(ref) => registerInputRef("technicalPlatform", ref)} onFocus={() => scrollToField("technicalPlatform")} style={[shared.input, shared.textArea]} multiline placeholder={"Ex: Bloc operatoire, imagerie (radio, echographie), laboratoire d'analyses, pharmacie, maternite..."} value={f.technicalPlatform} onChangeText={(v) => setF("technicalPlatform", v)} />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Services (separes par virgule)</Text>
          <TextInput placeholderTextColor="#94a3b8" ref={(ref) => registerInputRef("servicesCsv", ref)} onFocus={() => scrollToField("servicesCsv")} style={shared.input} placeholder="Urgences, Radiologie, Pediatrie..." value={f.servicesCsv} onChangeText={(v) => setF("servicesCsv", v)} />
        </View>
      </View>

      {/* GPS */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>COORDONNEES GPS</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Latitude <Text style={styles.requiredMark}>*</Text></Text>
            <TextInput placeholderTextColor="#94a3b8" ref={(ref) => registerInputRef("latitude", ref)} onFocus={() => scrollToField("latitude")} style={shared.input} keyboardType="numeric" placeholder="5.3600" value={f.latitude} onChangeText={(v) => setF("latitude", v)} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Longitude <Text style={styles.requiredMark}>*</Text></Text>
            <TextInput placeholderTextColor="#94a3b8" ref={(ref) => registerInputRef("longitude", ref)} onFocus={() => scrollToField("longitude")} style={shared.input} keyboardType="numeric" placeholder="-4.0083" value={f.longitude} onChangeText={(v) => setF("longitude", v)} />
          </View>
        </View>
        <Pressable style={styles.outlineBtn} onPress={getCurrentPosition}>
          <Text style={styles.outlineBtnText}>📍 Utiliser ma position GPS</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        {centerId ? (
          <Pressable style={styles.outlineBtn} onPress={() => setIsEditingCenter(false)}>
            <Text style={styles.outlineBtnText}>Annuler</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.outlineBtn} onPress={() => { setError(""); setMessage(""); refreshAll({ silent: false }).catch(() => {}); loadComplaintsData({ silent: true }).catch(() => {}); loadReferralsData({ silent: true }).catch(() => {}); }}>
            <Text style={styles.outlineBtnText}>Actualiser</Text>
          </Pressable>
        )}
        <Pressable style={[styles.primaryBtn, { flex: 1 }, loading && { opacity: 0.6 }]} onPress={createCenter} disabled={loading}>
          <Text style={styles.primaryBtnText}>{loading ? "Enregistrement..." : centerId ? "Mettre a jour" : "Enregistrer le centre"}</Text>
        </Pressable>
      </View>
      </>
      )}
      </>
      ) : null}

      {/* Suivi patients */}
      {activeSection === "suivi" && isApproved ? (
        <View style={styles.complaintsPanel}>
          <Text style={styles.sectionLabel}>SUIVI DES PATIENTS</Text>

          {/* QR code (observations & suggestions du public) + code texte de visite */}
          {checkinCode ? (
            <View style={styles.visitCodeCard}>
              <Text style={styles.visitCodeLabel}>QR CODE DU CENTRE</Text>
              {feedbackUrl && activeSection === "suivi" ? (
                <View style={styles.qrWrapper}>
                  <QRCode
                    value={feedbackUrl}
                    size={180}
                    color={C.primary}
                    backgroundColor="#ffffff"
                    getRef={(ref) => (qrRef.current = ref)}
                  />
                </View>
              ) : null}
              <Text style={styles.visitCodeHint}>
                Affichez ce QR code dans le centre : patients et visiteurs le scannent avec leur telephone pour envoyer une observation ou une suggestion. Les messages arrivent dans l'onglet Observations & suggestions.
              </Text>
              <Text style={[styles.visitCodeLabel, { marginTop: 6 }]}>CODE DE VISITE</Text>
              <Text style={styles.visitCodeValue}>{checkinCode}</Text>
              <Text style={styles.visitCodeHint}>
                Les patients saisissent ce code dans l'application pour enregistrer leur visite.
              </Text>
              {feedbackUrl ? (
                <Pressable style={[styles.outlineBtn, printingQr && { opacity: 0.6 }]} onPress={printQrCode} disabled={printingQr}>
                  <Text style={styles.outlineBtnText}>{printingQr ? "Preparation..." : "🖨️ Imprimer l'affiche QR code"}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={styles.visitConfirmCard}>
            <Text style={styles.sectionLabel}>CONFIRMER UNE VISITE PATIENT</Text>
            <Text style={styles.visitConfirmHint}>Entrez le numero du patient pour confirmer sa visite manuellement.</Text>
            <TextInput
              placeholderTextColor="#94a3b8"
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

          <View style={styles.visitConfirmCard}>
            <Text style={styles.sectionLabel}>ORIENTATIONS DE PATIENTS RECUES</Text>
            <Text style={styles.visitConfirmHint}>
              Patients orientes vers votre centre par un autre professionnel. Confirmez la reception une fois le patient arrive.
            </Text>
            {referralNotice ? (
              <Text style={[styles.visitMsgText, { color: referralNotice.ok ? C.green : C.amber }]}>{referralNotice.text}</Text>
            ) : null}
            {referralsLoading ? <Text style={styles.geoLoading}>Chargement des orientations...</Text> : null}
            {!referralsLoading && referralsList.length === 0 ? (
              <Text style={shared.hint}>Aucune orientation en attente pour votre centre.</Text>
            ) : null}
            {referralsList.map((item) => (
              <View key={item.id} style={[styles.complaintCard, item.status === "PENDING" && styles.referralCardPending]}>
                {item.status === "PENDING" ? (
                  <View style={styles.referralNotifRow}>
                    <View style={styles.referralBellWrap}>
                      <Text style={styles.referralBell}>🔔</Text>
                    </View>
                    <Text style={styles.referralNotifText}>Nouvelle orientation a confirmer</Text>
                  </View>
                ) : null}
                <View style={styles.complaintTop}>
                  <Text style={styles.complaintSubject}>
                    {item.patientName || item.patientPhone} {item.patientName ? `(${item.patientPhone})` : ""}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: item.status === "RECEIVED" ? C.greenLight : item.status === "REJECTED" ? C.redLight : C.amberLight }]}>
                    <Text style={[styles.badgeText, { color: item.status === "RECEIVED" ? C.green : item.status === "REJECTED" ? C.red : C.amber }]}>
                      {item.status === "RECEIVED" ? "RECU" : item.status === "REJECTED" ? "REJETE" : "EN ATTENTE"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.complaintBody}>Oriente par: {item.originUserName || "Professionnel"}</Text>
                {item.serviceName ? <Text style={styles.complaintBody}>Service: {item.serviceName}</Text> : null}
                {item.reason ? <Text style={styles.complaintBody}>Motif: {item.reason}</Text> : null}
                {item.status === "PENDING" ? (
                  referralRejectingId === String(item.id) ? (
                    <View style={{ marginTop: 8, gap: 8 }}>
                      <TextInput
                        placeholderTextColor="#94a3b8"
                        style={shared.input}
                        placeholder="Motif du rejet"
                        value={referralRejectDrafts[item.id] || ""}
                        onChangeText={(v) => setReferralRejectDrafts((prev) => ({ ...prev, [item.id]: v }))}
                        multiline
                      />
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable
                          style={[styles.outlineBtn, { flex: 1 }]}
                          onPress={() => { setReferralRejectingId(""); }}
                        >
                          <Text style={styles.outlineBtnText}>Annuler</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.dangerBtn, { flex: 1 }, referralActionLoadingId === String(item.id) && { opacity: 0.6 }]}
                          onPress={() => rejectReferralReception(item.id)}
                          disabled={referralActionLoadingId === String(item.id)}
                        >
                          <Text style={styles.dangerBtnText}>
                            {referralActionLoadingId === String(item.id) ? "..." : "Confirmer le rejet"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={{ gap: 8, marginTop: 8 }}>
                    {!item.serviceName && centerServices.length > 0 ? (
                      <View style={{ gap: 6 }}>
                        <Text style={styles.visitConfirmHint}>Service d'admission (une place y sera occupee) :</Text>
                        <View style={styles.feedbackFilterRow}>
                          {centerServices.filter((service) => service.isActive !== false).map((service) => {
                            const active = referralServiceDrafts[item.id] === service.name;
                            const beds = Number(service.bedsAvailable) || 0;
                            return (
                              <Pressable
                                key={service.name}
                                style={[styles.feedbackFilterChip, active && styles.feedbackFilterChipActive]}
                                onPress={() => setReferralServiceDrafts((prev) => ({ ...prev, [item.id]: active ? "" : service.name }))}
                              >
                                <Text style={[styles.feedbackFilterText, active && styles.feedbackFilterTextActive]}>
                                  {service.name} · {beds > 0 ? `${beds} libre(s)` : "complet"}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    ) : item.serviceName ? (
                      <Text style={styles.visitConfirmHint}>La confirmation occupera 1 place en {item.serviceName}.</Text>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        style={[styles.primaryBtn, { flex: 1 }, referralActionLoadingId === String(item.id) && { opacity: 0.6 }]}
                        onPress={() => confirmReferralReception(item.id, item.serviceName ? "" : referralServiceDrafts[item.id])}
                        disabled={referralActionLoadingId === String(item.id)}
                      >
                        <Text style={styles.primaryBtnText}>
                          {referralActionLoadingId === String(item.id) ? "..." : "Confirmer la reception"}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.dangerBtn, { flex: 1 }]}
                        onPress={() => setReferralRejectingId(String(item.id))}
                      >
                        <Text style={styles.dangerBtnText}>Rejeter</Text>
                      </Pressable>
                    </View>
                    </View>
                  )
                ) : item.status === "REJECTED" ? (
                  <>
                    <Text style={styles.visitMsgText}>
                      Rejete le {item.receivedAt ? new Date(item.receivedAt).toLocaleString() : "-"}
                    </Text>
                    {item.rejectionReason ? (
                      <Text style={styles.complaintBody}>Motif du rejet: {item.rejectionReason}</Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text style={styles.visitMsgText}>
                      Reçu le {item.receivedAt ? new Date(item.receivedAt).toLocaleString() : "-"}
                    </Text>
                    {item.bedOccupied ? (
                      <View style={styles.bedStatusBox}>
                        <Text style={styles.bedStatusText}>🛏️ Place occupee en {item.bedServiceName}</Text>
                        <Pressable
                          style={[styles.outlineBtn, referralActionLoadingId === String(item.id) && { opacity: 0.6 }]}
                          onPress={() => releaseReferralBed(item.id)}
                          disabled={referralActionLoadingId === String(item.id)}
                        >
                          <Text style={styles.outlineBtnText}>
                            {referralActionLoadingId === String(item.id) ? "..." : "Liberer la place (sortie du patient)"}
                          </Text>
                        </Pressable>
                      </View>
                    ) : item.bedReleasedAt ? (
                      <Text style={shared.hint}>
                        Place liberee en {item.bedServiceName} le {new Date(item.bedReleasedAt).toLocaleString()}
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Retours usagers */}
      {activeSection === "retours" && isApproved ? (
        <View style={styles.complaintsPanel}>
          <Text style={styles.sectionLabel}>RETOURS USAGERS</Text>

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
                placeholderTextColor="#94a3b8"
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

          <Text style={[styles.sectionLabel, { marginTop: 6 }]}>OBSERVATIONS / SUGGESTIONS</Text>

          {suggestionNotice ? (
            <View style={styles.suggestionNoticeBar}>
              <Text style={styles.suggestionNoticeText}>{suggestionNotice}</Text>
            </View>
          ) : null}

          {suggestionsLoading ? <Text style={styles.geoLoading}>Chargement des observations...</Text> : null}
          {!suggestionsLoading && suggestionsList.length === 0 ? <Text style={shared.hint}>Aucune observation pour votre centre.</Text> : null}

          {suggestionsList.map((item) => (
            <View key={item.id} style={styles.complaintCard}>
              <View style={styles.complaintTop}>
                <Text style={styles.complaintSubject}>{item.userFullName || "Usager"}</Text>
                <View style={[styles.badge, { backgroundColor: item.isRead ? C.greenLight : C.amberLight }]}>
                  <Text style={[styles.badgeText, { color: item.isRead ? C.green : C.amber }]}>
                    {item.isRead ? "LUE" : "NON LUE"}
                  </Text>
                </View>
              </View>
              <Text style={styles.complaintBody} numberOfLines={3}>{item.message}</Text>
              <View style={styles.messageActionsRow}>
                <Pressable style={[styles.outlineBtn, { flex: 1 }]} onPress={() => openMessageDetail("SUGGESTION", item)}>
                  <Text style={styles.outlineBtnText}>Detail</Text>
                </Pressable>
                {!item.isRead ? (
                  <Pressable
                    style={[styles.outlineBtn, { flex: 1 }, suggestionActionLoadingId === String(item.id) && { opacity: 0.5 }]}
                    onPress={() => markSuggestionRead(item.id)}
                    disabled={suggestionActionLoadingId === String(item.id)}
                  >
                    <Text style={styles.outlineBtnText}>{suggestionActionLoadingId === String(item.id) ? "..." : "Marquer comme lue"}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Observations & suggestions deposees via le QR code (visibles uniquement par le centre) */}
      {activeSection === "avis" && isApproved ? (
        <View style={styles.complaintsPanel}>
          <Text style={styles.sectionLabel}>OBSERVATIONS & SUGGESTIONS DU PUBLIC</Text>

          <View style={styles.visitCodeCard}>
            <Text style={styles.visitCodeLabel}>QR CODE A AFFICHER DANS LE CENTRE</Text>
            {feedbackUrl ? (
              <View style={styles.qrWrapper}>
                <QRCode
                  value={feedbackUrl}
                  size={200}
                  color={C.primary}
                  backgroundColor="#ffffff"
                  getRef={(ref) => (qrRef.current = ref)}
                />
              </View>
            ) : (
              <Text style={shared.hint}>QR code indisponible pour le moment.</Text>
            )}
            <Text style={styles.visitCodeHint}>
              Patients et visiteurs le scannent avec l'appareil photo de leur telephone pour envoyer une observation ou une suggestion, sans application ni compte. Les messages arrivent ici et ne sont visibles que par votre centre.
            </Text>
            {feedbackUrl ? (
              <Pressable style={[styles.outlineBtn, printingQr && { opacity: 0.6 }]} onPress={printQrCode} disabled={printingQr}>
                <Text style={styles.outlineBtnText}>{printingQr ? "Preparation..." : "🖨️ Imprimer l'affiche QR code"}</Text>
              </Pressable>
            ) : null}
          </View>

          {suggestionNotice ? (
            <View style={styles.suggestionNoticeBar}>
              <Text style={styles.suggestionNoticeText}>{suggestionNotice}</Text>
            </View>
          ) : null}

          <View style={styles.feedbackFilterRow}>
            {[
              { key: "ALL", label: `Tous (${qrFeedbackList.length})` },
              { key: "UNREAD", label: `Non lus (${qrFeedbackUnreadCount})` },
              { key: "OBSERVATION", label: "Observations" },
              { key: "SUGGESTION", label: "Suggestions" },
            ].map((option) => (
              <Pressable
                key={option.key}
                style={[styles.feedbackFilterChip, qrFeedbackFilter === option.key && styles.feedbackFilterChipActive]}
                onPress={() => setQrFeedbackFilter(option.key)}
              >
                <Text style={[styles.feedbackFilterText, qrFeedbackFilter === option.key && styles.feedbackFilterTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>

          {qrFeedbackLoading ? <Text style={styles.geoLoading}>Chargement des messages...</Text> : null}
          {!qrFeedbackLoading && filteredQrFeedback.length === 0 ? (
            <Text style={shared.hint}>
              {qrFeedbackList.length === 0 ? "Aucun message recu pour le moment. Affichez le QR code dans votre centre." : "Aucun message pour ce filtre."}
            </Text>
          ) : null}

          {filteredQrFeedback.map((item) => {
            const isSuggestion = item.kind === "SUGGESTION";
            return (
              <View key={item._id} style={[styles.complaintCard, !item.isRead && { borderLeftWidth: 4, borderLeftColor: C.amber }]}>
                <View style={styles.complaintTop}>
                  <View style={[styles.badge, { backgroundColor: isSuggestion ? C.purpleLight : C.primaryLight }]}>
                    <Text style={[styles.badgeText, { color: isSuggestion ? C.purple : C.primary }]}>
                      {isSuggestion ? "SUGGESTION" : "OBSERVATION"}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: item.isRead ? C.greenLight : C.amberLight }]}>
                    <Text style={[styles.badgeText, { color: item.isRead ? C.green : C.amber }]}>{item.isRead ? "LU" : "NON LU"}</Text>
                  </View>
                </View>
                <Text style={styles.complaintBody} numberOfLines={3}>{item.message}</Text>
                <Text style={shared.hint}>
                  {item.authorName || "Anonyme"}{item.authorPhone ? ` · ${item.authorPhone}` : ""} · {item.createdAt ? new Date(item.createdAt).toLocaleString("fr-FR") : ""}
                </Text>
                <View style={styles.messageActionsRow}>
                  <Pressable style={[styles.outlineBtn, { flex: 1 }]} onPress={() => openMessageDetail("QR", item)}>
                    <Text style={styles.outlineBtnText}>Detail</Text>
                  </Pressable>
                  {!item.isRead ? (
                    <Pressable
                      style={[styles.outlineBtn, { flex: 1 }, qrFeedbackActionId === item._id && { opacity: 0.5 }]}
                      onPress={() => markQrFeedbackRead(item._id)}
                      disabled={qrFeedbackActionId === item._id}
                    >
                      <Text style={styles.outlineBtnText}>{qrFeedbackActionId === item._id ? "..." : "Marquer comme lu"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      </>
      )}

      <Modal visible={!!messageDetail} transparent animationType="fade" onRequestClose={() => setMessageDetail(null)}>
        <Pressable style={styles.detailOverlay} onPress={() => setMessageDetail(null)}>
          <Pressable style={styles.detailCard} onPress={() => {}}>
            {messageDetail ? (() => {
              const { source, item } = messageDetail;
              const isQr = source === "QR";
              const isSuggestion = isQr ? item.kind === "SUGGESTION" : true;
              const author = isQr ? (item.authorName || "Anonyme") : (item.userFullName || "Usager");
              return (
                <>
                  <View style={styles.complaintTop}>
                    <View style={[styles.badge, { backgroundColor: isSuggestion ? C.purpleLight : C.primaryLight }]}>
                      <Text style={[styles.badgeText, { color: isSuggestion ? C.purple : C.primary }]}>
                        {isQr ? (isSuggestion ? "SUGGESTION" : "OBSERVATION") : "OBSERVATION / SUGGESTION"}
                      </Text>
                    </View>
                    <Text style={styles.detailSource}>{isQr ? "Via QR code" : "Via l'application"}</Text>
                  </View>
                  <ScrollView style={styles.detailScroll} contentContainerStyle={{ paddingVertical: 4 }}>
                    <Text selectable style={styles.detailMessage}>{item.message}</Text>
                  </ScrollView>
                  <View style={styles.detailMetaBox}>
                    <Text style={styles.detailMeta}>👤 {author}</Text>
                    {isQr && item.authorPhone ? <Text style={styles.detailMeta}>📞 {item.authorPhone}</Text> : null}
                    {item.createdAt ? <Text style={styles.detailMeta}>🕒 {new Date(item.createdAt).toLocaleString("fr-FR")}</Text> : null}
                  </View>
                  <Pressable style={styles.primaryBtn} onPress={() => setMessageDetail(null)}>
                    <Text style={styles.primaryBtnText}>Fermer</Text>
                  </Pressable>
                </>
              );
            })() : null}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { padding: 16, gap: 14, paddingBottom: 32 },

  suggestionNoticeBar: {
    backgroundColor: C.amberLight,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionNoticeText: { color: C.amber, fontWeight: "700", fontSize: 13 },

  header:      { flexDirection: "row", alignItems: "center", gap: 14 },
  headerIcon:  { width: 52, height: 52, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  headerEmoji: { fontSize: 26 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.textDark },
  headerRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  headerSub:   { fontSize: 13, color: C.textMuted },

  sectionNav: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.lg,
    padding: 4,
  },
  sectionNavItem: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 130,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: R.full,
  },
  sectionNavItemActive: { backgroundColor: ACCENT, ...S.sm },
  sectionNavText: { color: C.textMed, fontWeight: "700", fontSize: 12.5 },
  sectionNavTextActive: { color: "#fff" },
  sectionNavBadge: {
    backgroundColor: C.red,
    borderRadius: R.full,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionNavBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },

  card: {
    backgroundColor: C.surface, borderRadius: R.md,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 3, borderLeftColor: ACCENT,
    padding: 14, gap: 10, ...S.sm,
  },
  sectionLabel: { fontSize: 10, fontWeight: "800", color: C.textMuted, letterSpacing: 1 },
  fieldGroup:   { gap: 4 },
  fieldLabel:   { fontSize: 12, fontWeight: "700", color: C.textMed },
  requiredMark: { color: C.red, fontWeight: "800" },
  geoLoading:   { color: ACCENT, fontWeight: "600", fontSize: 13 },

  chipGroup:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:           { borderWidth: 1.5, borderColor: C.border, borderRadius: R.full, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surfaceAlt },
  chipActive:     { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText:       { color: C.textMed, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#fff" },

  summaryRow:   { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
  summaryLabel: { fontSize: 12, color: C.textMuted, fontWeight: "600", flex: 1 },
  summaryValue: { fontSize: 13, color: C.textDark, fontWeight: "700", flex: 1, textAlign: "right" },

  row:            { flexDirection: "row", gap: 10, alignItems: "center" },
  outlineBtn:     { borderWidth: 1.5, borderColor: ACCENT, borderRadius: R.sm, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
  outlineBtnText: { color: ACCENT, fontWeight: "700", fontSize: 13 },
  primaryBtn:     { backgroundColor: ACCENT, borderRadius: R.sm, paddingVertical: 12, alignItems: "center", ...S.sm },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  dangerBtn:      { backgroundColor: C.red, borderRadius: R.sm, paddingVertical: 12, alignItems: "center", ...S.sm },
  dangerBtnText:  { color: "#fff", fontWeight: "700", fontSize: 14 },

  badge:     { borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },

  bedStatusBox: { gap: 8, backgroundColor: C.orangeLight, borderRadius: R.sm, padding: 10, marginTop: 4 },
  bedStatusText: { fontSize: 13, fontWeight: "800", color: C.orange },
  messageActionsRow: { flexDirection: "row", gap: 8 },
  referralCardPending: { borderLeftWidth: 4, borderLeftColor: C.amber },
  referralNotifRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  referralBellWrap: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.amberLight,
    alignItems: "center", justifyContent: "center",
  },
  referralBell: { fontSize: 15 },
  referralNotifText: { fontSize: 12, fontWeight: "800", color: C.amber },
  detailOverlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  detailCard: { width: "100%", maxWidth: 520, maxHeight: "85%", backgroundColor: C.surface, borderRadius: R.md, padding: 18, gap: 12, ...S.sm },
  detailSource: { fontSize: 12, color: C.textMuted, fontWeight: "600" },
  detailScroll: { maxHeight: 360 },
  detailMessage: { fontSize: 15, lineHeight: 22, color: C.textDark },
  detailMetaBox: { gap: 4, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  detailMeta: { fontSize: 13, color: C.textMed },
  feedbackFilterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  feedbackFilterChip: { borderWidth: 1.5, borderColor: C.border, borderRadius: R.full, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surface },
  feedbackFilterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  feedbackFilterText: { color: C.textMed, fontWeight: "600", fontSize: 12 },
  feedbackFilterTextActive: { color: "#fff" },
  complaintsPanel: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 14, gap: 12 },
  statsRow:  { flexDirection: "row", gap: 10 },
  statCard:  { flex: 1, backgroundColor: ACCENT + "15", borderRadius: R.sm, borderWidth: 1, borderColor: ACCENT + "30", padding: 12, alignItems: "center", gap: 2 },
  statValue: { fontSize: 22, fontWeight: "800", color: ACCENT },
  statLabel: { fontSize: 11, color: C.textMuted, textAlign: "center" },

  complaintCard:    { backgroundColor: C.surfaceAlt, borderRadius: R.sm, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  serviceCard:      { backgroundColor: C.surfaceAlt, borderRadius: R.sm, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
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
