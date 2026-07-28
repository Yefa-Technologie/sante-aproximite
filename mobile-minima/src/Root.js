import { ActivityIndicator, AppState, Image, Linking, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { apiFetch, clearLocalCache, getPendingRequestsCount, syncPendingRequests, trackEvent } from "./api/client";
import { useAuth } from "./context/AuthContext";
import { C, S } from "./theme";
import { AuthScreen } from "./screens/AuthScreen";
import { ProjectDigitalizationModal } from "./components/ProjectDigitalizationModal";
import { DonationModal } from "./components/DonationModal";
import { fetchModuleSettings, loadCachedModuleSettings } from "./storage/moduleSettings";
import { registerForPushNotifications } from "./notifications";

const APP_VERSION = "1.0.0";

const MODULE_ICONS = {
  centers:   { uri: "https://img.icons8.com/color/96/hospital-3.png" },
  referral:  { uri: "https://img.icons8.com/color/96/ambulance.png" },
  complaints:{ uri: "https://img.icons8.com/color/96/complaint.png" },
  tracking:  { uri: "https://img.icons8.com/color/96/time-machine.png" },
  chef:      { uri: "https://img.icons8.com/color/96/clinic.png" },
  alerts:    { uri: "https://img.icons8.com/color/96/ambulance.png" },
  emergency: { uri: "https://img.icons8.com/color/96/ambulance.png" },
  security:  { uri: "https://img.icons8.com/color/96/police-badge.png" },
  settings:  { uri: "https://img.icons8.com/color/96/settings.png" },
  developer: { uri: "https://img.icons8.com/color/96/filled-topic.png" },
  project:   { uri: "https://img.icons8.com/color/96/rocket--v1.png" },
};

const MODULE_COLORS = {
  nearby:              C.teal,
  referral:            C.red,
  complaints:          C.primary,
  complaints_tracking: C.primary,
  chef:                C.teal,
  alerts:              C.orange,
  emergency:           C.red,
  security_alert:      "#7C3AED",
  security_ops:        C.primary,
  settings:            C.textMuted,
};

export function Root() {
  const { user, token, ready, logout } = useAuth();
  const [currentTab, setCurrentTab] = useState("nearby");
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [donationModalOpen, setDonationModalOpen] = useState(false);
  const [chefCenterApprovalStatus, setChefCenterApprovalStatus] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncNotice, setSyncNotice] = useState(null);
  const [moduleSettings, setModuleSettings] = useState({});
  const autoSelectedResponderTab = useRef(false);
  const autoSelectedChefTab = useRef(false);
  const pendingSyncCountRef = useRef(0);
  const syncNoticeTimeoutRef = useRef(null);

  // Refresh & update state
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState(null);
  const [clearingCache, setClearingCache] = useState(false);

  const normalizeRoleValue = (value) => String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const normalizedRole = normalizeRoleValue(user?.role);
  const normalizedRoles = Array.from(
    new Set(
      [
        ...((Array.isArray(user?.roles) ? user.roles : []).map((entry) => normalizeRoleValue(entry?.role || entry))),
        normalizedRole
      ].filter(Boolean)
    )
  );
  const hasRole = (roleName) => normalizedRoles.includes(roleName);
  const hasAnyRole = (roleNames) => roleNames.some((roleName) => hasRole(roleName));
  const canManageCenters = hasAnyRole(["CHEF_ETABLISSEMENT", "ETABLISSEMENT"]);
  const chefHasPendingOrMissingCenter =
    canManageCenters && (!chefCenterApprovalStatus || chefCenterApprovalStatus === "PENDING");
  const hasStandardMobileRole = hasAnyRole(["USER", "UTILISATEUR", "PATIENT"]);

  const userRoleGroups = [
    ...(hasStandardMobileRole ? ["USER"] : []),
    ...(canManageCenters ? ["ETABLISSEMENT"] : []),
    ...(hasRole("SAMU") ? ["SAMU"] : []),
    ...(hasAnyRole(["SAPEUR_POMPIER", "SAPPEUR_POMPIER"]) ? ["SAPEUR_POMPIER"] : []),
    ...(hasRole("POLICE") ? ["POLICE"] : []),
    ...(hasRole("GENDARMERIE") ? ["GENDARMERIE"] : []),
    ...(hasRole("PROTECTION_CIVILE") ? ["PROTECTION_CIVILE"] : []),
  ];

  function isModuleEnabled(moduleKey) {
    const roleMap = moduleSettings?.[moduleKey];
    if (!roleMap || userRoleGroups.length === 0) return true;
    return userRoleGroups.some((rg) => roleMap[rg] !== false);
  }

  const canSeeNearby          = isModuleEnabled("nearby");
  const canPostComplaint      = isModuleEnabled("complaints");
  const canTrackComplaints    = isModuleEnabled("complaints_tracking");
  const canUseSuggestions     = isModuleEnabled("suggestions");
  const canSendEmergencyRequest = isModuleEnabled("emergency");
  const canSendSecurityAlert  = isModuleEnabled("security_alert");
  const canUseReferralModule = isModuleEnabled("referral");
  const canSeeChefSpace       = isModuleEnabled("chef");
  const canSeeEmergencyAlerts = isModuleEnabled("alerts");
  const canSeeSecurityOps     = isModuleEnabled("security_ops");
  const canSeeCenterSettings  = isModuleEnabled("settings");
  const canSeeDonation        = isModuleEnabled("donation");
  const canSeeContactDeveloper = isModuleEnabled("contact_developer");
  const canSeeProject         = isModuleEnabled("project");
  const canSeeClearCache      = isModuleEnabled("clear_cache");

  const emergencyAlertsLabel = hasRole("SAMU") && hasAnyRole(["SAPEUR_POMPIER", "SAPPEUR_POMPIER"])
    ? "Urgences sanitaires SAMU & Pompiers"
    : hasRole("SAMU")
      ? "Urgences sanitaires SAMU"
      : hasRole("PROTECTION_CIVILE")
        ? "Urgences sanitaires Protection Civile"
        : "Urgences sanitaires Pompiers";

  useEffect(() => {
    function showSyncNotice(message, tone = "info") {
      if (syncNoticeTimeoutRef.current) clearTimeout(syncNoticeTimeoutRef.current);
      setSyncNotice({ message, tone });
      syncNoticeTimeoutRef.current = setTimeout(() => {
        setSyncNotice(null);
        syncNoticeTimeoutRef.current = null;
      }, 4500);
    }

    const runSync = async () => {
      try {
        await syncPendingRequests();
      } finally {
        const nextCount = await getPendingRequestsCount().catch(() => 0);
        const previousCount = pendingSyncCountRef.current;
        if (previousCount === 0 && nextCount > 0) {
          showSyncNotice("Vous etes hors ligne. Les actions seront synchronisees automatiquement.", "warning");
        } else if (previousCount > 0 && nextCount === 0) {
          showSyncNotice("Synchronisation terminee.", "success");
        }
        pendingSyncCountRef.current = nextCount;
        setPendingSyncCount(nextCount);
      }
    };
    runSync();
    const interval = setInterval(runSync, 30000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") runSync();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
      if (syncNoticeTimeoutRef.current) clearTimeout(syncNoticeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadChefCenterStatus() {
      if (!user || !token || !canManageCenters) {
        if (!cancelled) setChefCenterApprovalStatus(null);
        return;
      }
      try {
        const centers = await apiFetch("/centers", { token });
        const first = Array.isArray(centers) ? centers[0] : null;
        if (!cancelled) setChefCenterApprovalStatus(first?.approvalStatus || null);
      } catch {
        if (!cancelled) setChefCenterApprovalStatus(null);
      }
    }
    loadChefCenterStatus();
    const interval = setInterval(() => { loadChefCenterStatus().catch(() => {}); }, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user, token, canManageCenters]);

  // Track tab changes
  useEffect(() => {
    if (user) trackEvent(currentTab, "screen_view");
  }, [currentTab]);

  // Track login
  useEffect(() => {
    if (user) trackEvent("app", "login");
  }, [user?.id]);

  // Check for app update on mount
  useEffect(() => {
    async function checkForUpdate() {
      try {
        const data = await apiFetch("/version", { token: null });
        if (data?.version && data.version !== APP_VERSION) {
          setUpdateAvailable(true);
          setUpdateVersion(data.version);
        }
      } catch {
        // ignore — offline or endpoint not available
      }
    }
    checkForUpdate();
  }, []);

  useEffect(() => {
    if (!token) return;
    registerForPushNotifications(token).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    async function refreshModuleSettings() {
      try {
        const fresh = await fetchModuleSettings(token);
        if (mounted) setModuleSettings(fresh);
      } catch {
        // hors ligne : on garde les reglages en cache
      }
    }
    (async () => {
      const cached = await loadCachedModuleSettings();
      if (mounted && Object.keys(cached).length > 0) setModuleSettings(cached);
      await refreshModuleSettings();
    })();
    const interval = setInterval(refreshModuleSettings, 60000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshModuleSettings();
    });
    return () => {
      mounted = false;
      clearInterval(interval);
      sub.remove();
    };
  }, [token]);

  useEffect(() => {
    if (canSeeChefSpace && !chefHasPendingOrMissingCenter && !autoSelectedChefTab.current) {
      setCurrentTab("chef");
      autoSelectedChefTab.current = true;
      return;
    }
    if (canSeeSecurityOps && !autoSelectedResponderTab.current) {
      setCurrentTab("security_ops");
      autoSelectedResponderTab.current = true;
      return;
    }
    if (canSeeEmergencyAlerts && !autoSelectedResponderTab.current) {
      setCurrentTab("alerts");
      autoSelectedResponderTab.current = true;
      return;
    }
    if (!canSeeNearby && currentTab === "nearby") {
      setCurrentTab("complaints");
      return;
    }
    if (!canPostComplaint && !canTrackComplaints && ["complaints", "complaints_tracking"].includes(currentTab)) {
      setCurrentTab("nearby");
    }
  }, [
    canSeeChefSpace, chefHasPendingOrMissingCenter, canSeeEmergencyAlerts, canSeeSecurityOps,
    canSeeNearby, canPostComplaint, canTrackComplaints, currentTab
  ]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    await new Promise((r) => setTimeout(r, 900));
    setRefreshing(false);
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    await clearLocalCache();
    await new Promise((r) => setTimeout(r, 600));
    setClearingCache(false);
    setRefreshKey((k) => k + 1);
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
      </SafeAreaView>
    );
  }

  if (!user) return <AuthScreen />;

  function renderCurrentScreen() {
    if (canSeeNearby && currentTab === "nearby") {
      const { NearbyScreen } = require("./screens/NearbyScreen");
      return <NearbyScreen key={refreshKey} />;
    }
    if (canUseReferralModule && currentTab === "referral") {
      const { ReferralCenterScreen } = require("./screens/ReferralCenterScreen");
      return <ReferralCenterScreen key={refreshKey} />;
    }
    if (canPostComplaint && currentTab === "complaints") {
      const { ComplaintScreen } = require("./screens/ComplaintScreen");
      return <ComplaintScreen key={refreshKey} hideHistory />;
    }
    if (canTrackComplaints && currentTab === "complaints_tracking") {
      const { ComplaintScreen } = require("./screens/ComplaintScreen");
      return <ComplaintScreen key={refreshKey} hideForm />;
    }
    if (canUseSuggestions && currentTab === "suggestions") {
      const { SuggestionScreen } = require("./screens/SuggestionScreen");
      return <SuggestionScreen key={refreshKey} />;
    }
    if (canSeeChefSpace && currentTab === "chef") {
      const { ChefScreen } = require("./screens/ChefScreen");
      return <ChefScreen key={refreshKey} />;
    }
    if (canSeeEmergencyAlerts && currentTab === "alerts") {
      const { EmergencyOpsScreen } = require("./screens/EmergencyOpsScreen");
      return <EmergencyOpsScreen key={refreshKey} />;
    }
    if (canSeeSecurityOps && currentTab === "security_ops") {
      const { SecurityAlertOpsScreen } = require("./screens/SecurityAlertOpsScreen");
      return <SecurityAlertOpsScreen key={refreshKey} />;
    }
    if (canSendEmergencyRequest && currentTab === "emergency") {
      const { EmergencyScreen } = require("./screens/EmergencyScreen");
      return <EmergencyScreen key={refreshKey} />;
    }
    if (canSendSecurityAlert && currentTab === "security_alert") {
      const { SecurityAlertScreen } = require("./screens/SecurityAlertScreen");
      return <SecurityAlertScreen key={refreshKey} />;
    }
    if (canSeeCenterSettings && currentTab === "settings") {
      const { CenterSettingsScreen } = require("./screens/CenterSettingsScreen");
      return <CenterSettingsScreen key={refreshKey} />;
    }
    if (canSeeContactDeveloper && currentTab === "contact_developer") {
      const { ContactDeveloperScreen } = require("./screens/ContactDeveloperScreen");
      return <ContactDeveloperScreen key={refreshKey} />;
    }
    return null;
  }

  const tabs = [
    ...(canSeeNearby           ? [{ key: "nearby",              label: "Centres de sante",       icon: MODULE_ICONS.centers   }] : []),
    ...(canUseReferralModule   ? [{ key: "referral",            label: "Reference malade",       icon: MODULE_ICONS.referral  }] : []),
    ...(canPostComplaint        ? [{ key: "complaints",          label: "Poser une plainte",      icon: MODULE_ICONS.complaints }] : []),
    ...(canTrackComplaints      ? [{ key: "complaints_tracking", label: "Suivi des plaintes",     icon: MODULE_ICONS.tracking   }] : []),
    ...(canUseSuggestions       ? [{ key: "suggestions",         label: "Observation/Suggestion", icon: MODULE_ICONS.complaints }] : []),
    ...(canSeeChefSpace         ? [{ key: "chef",                label: "Espace chef",            icon: MODULE_ICONS.chef       }] : []),
    ...(canSeeEmergencyAlerts   ? [{ key: "alerts",              label: emergencyAlertsLabel,     icon: MODULE_ICONS.alerts     }] : []),
    ...(canSeeSecurityOps       ? [{ key: "security_ops",        label: "Urgences securitaires",   icon: MODULE_ICONS.security   }] : []),
    ...(canSendEmergencyRequest ? [{ key: "emergency",           label: "Urgence sanitaire",      icon: MODULE_ICONS.emergency  }] : []),
    ...(canSendSecurityAlert    ? [{ key: "security_alert",      label: "Urgence securitaire",    icon: MODULE_ICONS.security   }] : []),
    ...(canSeeCenterSettings    ? [{ key: "settings",            label: "Parametres centres",     icon: MODULE_ICONS.settings   }] : []),
  ];

  const activeTab = tabs.find((t) => t.key === currentTab);

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.logoWrap}>
            <Image source={require("../assets/logo-sante.png")} style={styles.logo} />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.appName} numberOfLines={1}>Sante Aproximite</Text>
            <Text style={styles.userName} numberOfLines={1}>{user.fullName}</Text>
          </View>
        </View>
        <View style={styles.topBarRight}>
          {activeTab ? (
            <View style={[styles.moduleLabel, { backgroundColor: MODULE_COLORS[currentTab] || C.primary }]}>
              <Text style={styles.moduleLabelText} numberOfLines={1}>{activeTab.label}</Text>
            </View>
          ) : null}
          {/* Refresh button */}
          <Pressable
            style={styles.refreshBtn}
            onPress={handleRefresh}
            accessibilityLabel="Actualiser"
          >
            <Text style={[styles.refreshBtnText, refreshing && styles.refreshBtnTextSpinning]}>↻</Text>
          </Pressable>
          <Pressable style={styles.menuBtn} onPress={() => setMenuOpen(true)} accessibilityLabel="Menu">
            <View style={styles.hamburger}>
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
            </View>
          </Pressable>
        </View>
      </View>

      {/* Full-screen menu overlay */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.drawer} onPress={() => {}}>
            {/* Fixed header — never scrolls */}
            <View style={styles.drawerHeader}>
              <View style={styles.drawerUserRow}>
                <View style={styles.drawerAvatar}>
                  <Text style={styles.drawerAvatarText}>{String(user.fullName || "?")[0].toUpperCase()}</Text>
                </View>
                <View style={styles.drawerUserInfo}>
                  <Text style={styles.drawerUserName}>{user.fullName}</Text>
                  <Text style={styles.drawerUserRole}>{normalizedRole || "Utilisateur"}</Text>
                </View>
              </View>
              <Pressable style={styles.drawerCloseBtn} onPress={() => setMenuOpen(false)}>
                <Text style={styles.drawerCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.drawerDivider} />

            {/* Scrollable body */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
              keyboardShouldPersistTaps="handled"
            >

            <View style={styles.moduleGrid}>
              <Pressable
                style={[styles.moduleCard, currentTab === "nearby" && { borderColor: C.teal, borderWidth: 2 }]}
                onPress={() => { setCurrentTab("nearby"); setMenuOpen(false); }}
              >
                {currentTab === "nearby" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.teal }]} /> : null}
                <Image source={MODULE_ICONS.centers} style={styles.moduleCardIcon} />
                <Text style={[styles.moduleCardText, currentTab === "nearby" && { color: C.teal }]}>Centre de santé</Text>
              </Pressable>

              {canSeeContactDeveloper ? (
              <Pressable
                style={[styles.moduleCard, currentTab === "contact_developer" && { borderColor: C.amber, borderWidth: 2 }]}
                onPress={() => {
                  setCurrentTab("contact_developer");
                  setMenuOpen(false);
                }}
              >
                {currentTab === "contact_developer" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.amber }]} /> : null}
                <Image source={MODULE_ICONS.developer} style={styles.moduleCardIcon} />
                <Text style={[styles.moduleCardText, currentTab === "contact_developer" && { color: C.amber }]}>Support</Text>
              </Pressable>
              ) : null}

              {canSeeProject ? (
              <Pressable
                style={[styles.moduleCard, projectModalOpen && { borderColor: C.red, borderWidth: 2 }]}
                onPress={() => {
                  setProjectModalOpen(true);
                  setMenuOpen(false);
                }}
              >
                {projectModalOpen ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.red }]} /> : null}
                <Image source={MODULE_ICONS.project} style={styles.moduleCardIcon} />
                <Text style={[styles.moduleCardText, projectModalOpen && { color: C.red }]}>Projet</Text>
              </Pressable>
              ) : null}

              {canSeeDonation ? (
              <Pressable
                style={[styles.moduleCard, donationModalOpen && { borderColor: "#00A3E0", borderWidth: 2 }]}
                onPress={() => {
                  setDonationModalOpen(true);
                  setMenuOpen(false);
                }}
              >
                {donationModalOpen ? <View style={[styles.moduleCardActiveBar, { backgroundColor: "#00A3E0" }]} /> : null}
                <Text style={[styles.moduleCardIcon, { fontSize: 32, textAlign: "center" }]}>💙</Text>
                <Text style={[styles.moduleCardText, donationModalOpen && { color: "#00A3E0" }]}>Faire un don</Text>
              </Pressable>
              ) : null}

              {canSeeClearCache ? (
              <Pressable
                style={[styles.moduleCard, clearingCache && { opacity: 0.6 }]}
                onPress={handleClearCache}
                disabled={clearingCache}
              >
                <Text style={[styles.moduleCardIcon, { fontSize: 32, textAlign: "center" }]}>🗑️</Text>
                <Text style={styles.moduleCardText}>{clearingCache ? "Nettoyage..." : "Vider le cache"}</Text>
              </Pressable>
              ) : null}

              {canUseSuggestions ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "suggestions" && { borderColor: C.amber, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("suggestions"); setMenuOpen(false); }}
                >
                  {currentTab === "suggestions" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.amber }]} /> : null}
                  <Text style={[styles.moduleCardIcon, { fontSize: 32, textAlign: "center" }]}>💡</Text>
                  <Text style={[styles.moduleCardText, currentTab === "suggestions" && { color: C.amber }]}>Observation/Suggestion</Text>
                </Pressable>
              ) : null}

              {canSeeChefSpace ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "chef" && { borderColor: C.teal, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("chef"); setMenuOpen(false); }}
                >
                  {currentTab === "chef" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.teal }]} /> : null}
                  <Image source={MODULE_ICONS.chef} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "chef" && { color: C.teal }]}>Espace chef</Text>
                </Pressable>
              ) : null}

              {canUseReferralModule ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "referral" && { borderColor: C.red, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("referral"); setMenuOpen(false); }}
                >
                  {currentTab === "referral" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.red }]} /> : null}
                  <Image source={MODULE_ICONS.referral} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "referral" && { color: C.red }]}>Reference malade</Text>
                </Pressable>
              ) : null}

              {canPostComplaint ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "complaints" && { borderColor: C.primary, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("complaints"); setMenuOpen(false); }}
                >
                  {currentTab === "complaints" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.primary }]} /> : null}
                  <Image source={MODULE_ICONS.complaints} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "complaints" && { color: C.primary }]}>Poser une plainte</Text>
                </Pressable>
              ) : null}

              {canTrackComplaints ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "complaints_tracking" && { borderColor: C.primary, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("complaints_tracking"); setMenuOpen(false); }}
                >
                  {currentTab === "complaints_tracking" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.primary }]} /> : null}
                  <Image source={MODULE_ICONS.tracking} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "complaints_tracking" && { color: C.primary }]}>Suivi des plaintes</Text>
                </Pressable>
              ) : null}

              {canSendEmergencyRequest ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "emergency" && { borderColor: C.red, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("emergency"); setMenuOpen(false); }}
                >
                  {currentTab === "emergency" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.red }]} /> : null}
                  <Image source={MODULE_ICONS.emergency} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "emergency" && { color: C.red }]}>Urgence sanitaire</Text>
                </Pressable>
              ) : null}

              {canSendSecurityAlert ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "security_alert" && { borderColor: "#7C3AED", borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("security_alert"); setMenuOpen(false); }}
                >
                  {currentTab === "security_alert" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: "#7C3AED" }]} /> : null}
                  <Image source={MODULE_ICONS.security} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "security_alert" && { color: "#7C3AED" }]}>Urgence securitaire</Text>
                </Pressable>
              ) : null}

              {canSeeEmergencyAlerts ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "alerts" && { borderColor: C.orange, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("alerts"); setMenuOpen(false); }}
                >
                  {currentTab === "alerts" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.orange }]} /> : null}
                  <Image source={MODULE_ICONS.alerts} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "alerts" && { color: C.orange }]}>{emergencyAlertsLabel}</Text>
                </Pressable>
              ) : null}

              {canSeeSecurityOps ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "security_ops" && { borderColor: C.primary, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("security_ops"); setMenuOpen(false); }}
                >
                  {currentTab === "security_ops" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.primary }]} /> : null}
                  <Image source={MODULE_ICONS.security} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "security_ops" && { color: C.primary }]}>Urgences securitaires</Text>
                </Pressable>
              ) : null}

              {canSeeCenterSettings ? (
                <Pressable
                  style={[styles.moduleCard, currentTab === "settings" && { borderColor: C.textMuted, borderWidth: 2 }]}
                  onPress={() => { setCurrentTab("settings"); setMenuOpen(false); }}
                >
                  {currentTab === "settings" ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.textMuted }]} /> : null}
                  <Image source={MODULE_ICONS.settings} style={styles.moduleCardIcon} />
                  <Text style={[styles.moduleCardText, currentTab === "settings" && { color: C.textMuted }]}>Parametres centres</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.drawerDivider} />

            </ScrollView>

            {/* Fixed footer — always visible */}
            <Pressable
              style={styles.logoutBtn}
              onPress={() => { setMenuOpen(false); logout(); }}
            >
              <Text style={styles.logoutBtnText}>Se deconnecter</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <ProjectDigitalizationModal visible={projectModalOpen} onClose={() => setProjectModalOpen(false)} />
      <DonationModal visible={donationModalOpen} onClose={() => setDonationModalOpen(false)} />

      {/* Content */}
      <View style={styles.content}>
        {/* Update banner */}
        {updateAvailable ? (
          <Pressable
            style={styles.updateBanner}
            onPress={() => Linking.openURL("https://play.google.com/store/apps/details?id=com.yefa.sante")}
          >
            <Text style={styles.updateBannerText}>
              🚀 Mise a jour disponible (v{updateVersion}) — Appuyez pour mettre a jour
            </Text>
          </Pressable>
        ) : null}

        {syncNotice ? (
          <View
            style={[
              styles.syncNotice,
              syncNotice.tone === "success" ? styles.syncNoticeSuccess : styles.syncNoticeWarning
            ]}
          >
            <Text
              style={[
                styles.syncNoticeText,
                syncNotice.tone === "success" ? styles.syncNoticeTextSuccess : styles.syncNoticeTextWarning
              ]}
            >
              {syncNotice.message}
            </Text>
          </View>
        ) : null}

        <View style={{ flex: 1 }}>
          {renderCurrentScreen()}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Powered by YEFA TECHNOLOGIE</Text>
       <Text
    style={[styles.footerText, { color: '#2563eb' }]}
    onPress={() => Linking.openURL('mailto:yefa.technologie@gmail.com')}
  >
    yefa.technologie@gmail.com
  </Text>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centered:  { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },

  // Top bar
  topBar: {
    marginTop: 10,
    marginHorizontal: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    ...S.md,
  },
  brandRow:    { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  logoWrap:    { borderRadius: 12, overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,255,255,0.3)" },
  logo:        { width: 36, height: 36 },
  brandText:   { flex: 1, minWidth: 0 },
  appName:     { fontSize: 16, fontWeight: "800", color: "#FFFFFF" },
  userName:    { fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: "500", marginTop: 1 },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  moduleLabel: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 120,
  },
  moduleLabelText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  refreshBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  refreshBtnText: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  refreshBtnTextSpinning: { opacity: 0.5 },
  menuBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  hamburger:   { gap: 5, alignItems: "center" },
  hamburgerLine: { width: 18, height: 2, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.9)" },

  // Modal overlay
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  drawer: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    maxHeight: "85%",
  },
  drawerHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  drawerUserRow:   { flexDirection: "row", alignItems: "center", gap: 12 },
  drawerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  drawerAvatarText: { color: "#fff", fontWeight: "800", fontSize: 20 },
  drawerUserInfo:   { gap: 2 },
  drawerUserName:   { fontWeight: "700", fontSize: 16, color: C.textDark },
  drawerUserRole:   { fontSize: 12, color: C.textMuted, fontWeight: "600" },
  drawerCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  drawerCloseBtnText: { color: C.textMuted, fontWeight: "700", fontSize: 14 },
  drawerDivider:  { height: 1, backgroundColor: C.border, marginVertical: 14 },

  moduleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  moduleCard: {
    width: "47%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 8,
    overflow: "hidden",
    ...S.sm,
  },
  moduleCardActiveBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  moduleCardIcon: { width: 32, height: 32 },
  moduleCardText: {
    color: C.textMed,
    fontWeight: "700",
    fontSize: 12,
    textAlign: "center",
  },
  supportModuleCard: {
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 14,
    gap: 12,
    ...S.sm,
  },
  supportModuleHeader: { gap: 4 },
  supportModuleTitle: {
    color: C.textDark,
    fontSize: 14,
    fontWeight: "800",
  },
  supportModuleHint: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  supportModuleBody: { gap: 10 },
  supportActionBtn: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    ...S.sm,
  },
  supportActionBtnYellow: { backgroundColor: "#FACC15" },
  supportActionBtnRed:    { backgroundColor: "#DC2626" },
  supportActionIcon:      { width: 28, height: 28 },
  supportActionIconText:  { fontSize: 24 },
  supportActionTextWrap:  { flex: 1, minWidth: 0 },
  supportActionTitleDark: { color: "#1F2937", fontWeight: "900", fontSize: 16 },
  supportActionSubDark:   { color: "#4B5563", fontSize: 12, marginTop: 3, fontWeight: "600" },
  supportActionTitleLight: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  supportActionSubLight:   { color: "rgba(255,255,255,0.88)", fontSize: 12, marginTop: 3, fontWeight: "600" },

  logoutBtn: {
    backgroundColor: C.redLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.red + "50",
  },
  logoutBtnText: { color: C.red, fontWeight: "700", fontSize: 15 },

  content: { flex: 1, marginTop: 10 },

  // Update banner
  updateBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: C.primaryDark,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    ...S.sm,
  },
  updateBannerText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },

  syncNotice: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  syncNoticeWarning: { backgroundColor: C.amberLight, borderColor: C.amber },
  syncNoticeSuccess: { backgroundColor: C.greenLight, borderColor: C.green },
  syncNoticeText:    { fontSize: 12, fontWeight: "700", textAlign: "center" },
  syncNoticeTextWarning: { color: C.amber },
  syncNoticeTextSuccess: { color: C.green },

  footer: {
    paddingVertical: 10,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.surface,
  },
  footerText: { color: C.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },

  // Generic modal sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: "800", color: C.textDark },

  // About — hero
  aboutHero: {
    alignItems: "center",
    backgroundColor: C.primaryDark,
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
  },
  aboutHeroLogoWrap: {
    width: 80, height: 80,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  aboutHeroLogo:    { width: 58, height: 58 },
  aboutHeroName:    { fontSize: 20, fontWeight: "900", color: "#FFFFFF", textAlign: "center", lineHeight: 27 },
  aboutVersionBadge: {
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  aboutVersionBadgeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  aboutHeroTagline: { marginTop: 10, color: "rgba(255,255,255,0.75)", fontSize: 13, textAlign: "center", lineHeight: 19 },

  // About chips
  aboutChipsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 16 },
  aboutChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  aboutChipIcon:  { fontSize: 14 },
  aboutChipLabel: { fontSize: 12, fontWeight: "700", color: C.textMed },

  // About blocks
  aboutBlock: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12,
  },
  aboutBlockTitle: { fontSize: 13, fontWeight: "800", color: C.textDark, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  aboutBlockText:  { fontSize: 13.5, color: C.textMed, lineHeight: 21 },

  // About features grid
  aboutFeatGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  aboutFeatCard: {
    width: "48%",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    alignItems: "flex-start",
    gap: 3,
  },
  aboutFeatIcon:  { fontSize: 22, marginBottom: 4 },
  aboutFeatLabel: { fontSize: 13, fontWeight: "800", color: C.textDark },
  aboutFeatSub:   { fontSize: 11, color: C.textMuted },

  // About developer card
  aboutDevCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  aboutDevBadge: {
    width: 46, height: 46,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  aboutDevBadgeText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
  aboutDevName:  { fontSize: 14, fontWeight: "800", color: C.textDark },
  aboutDevEmail: { fontSize: 13, color: C.primary, fontWeight: "700", marginTop: 3 },

  // About version
  aboutDivider:    { height: 1, backgroundColor: C.border, marginVertical: 16 },
  aboutVersionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  aboutVersionLabel: { fontSize: 13, color: C.textMuted, fontWeight: "600" },
  aboutVersionValue: { fontSize: 13, color: C.textDark, fontWeight: "800" },
  aboutUpdateBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    ...S.sm,
  },
  aboutUpdateBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  aboutUpToDateRow: { alignItems: "center", paddingVertical: 8 },
  aboutUpToDateText: { color: C.green, fontWeight: "700", fontSize: 14 },

  // About cache
  aboutCacheBtn: {
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F59E0B50",
    marginBottom: 6,
    ...S.sm,
  },
  aboutCacheBtnText: { color: "#92400E", fontWeight: "800", fontSize: 14 },
  aboutCacheHint: { fontSize: 12, color: C.textMuted, textAlign: "center", lineHeight: 18 },

  // Help
  helpIntro: {
    backgroundColor: C.primaryLight,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.primary + "30",
  },
  helpIntroText: { fontSize: 13, color: C.primaryDark, lineHeight: 20, fontWeight: "600", textAlign: "center" },
  helpTipsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  helpTip: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 6,
    gap: 5,
  },
  helpTipIcon:  { fontSize: 20 },
  helpTipLabel: { fontSize: 11, fontWeight: "700", color: C.textMed, textAlign: "center", lineHeight: 16 },
  helpFaqTitle: { fontSize: 13, fontWeight: "800", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },

  // FAQ accordion
  faqItem: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
    overflow: "hidden",
  },
  faqItemOpen: {
    borderColor: C.primary + "60",
    backgroundColor: C.primaryLight,
  },
  faqRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13 },
  faqItemIcon:  { fontSize: 18, flexShrink: 0 },
  faqQuestion:  { flex: 1, fontSize: 13.5, fontWeight: "700", color: C.textDark, lineHeight: 19 },
  faqQuestionOpen: { color: C.primaryDark },
  faqArrow:     { fontSize: 18, color: C.textMuted, fontWeight: "700" },
  faqArrowOpen: { color: C.primary },
  faqAnswerWrap: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: C.primary + "25",
  },
  faqAnswer: { fontSize: 13, color: C.textMed, lineHeight: 21, marginTop: 10 },

  // Help contact card
  helpContactCard: {
    marginTop: 14,
    backgroundColor: C.primaryDark,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    gap: 12,
  },
  helpContactTitle: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "700", textAlign: "center" },
  helpContactBtn: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 11,
    ...S.sm,
  },
  helpContactBtnText: { color: C.primaryDark, fontWeight: "800", fontSize: 14 },
  helpContact: { fontSize: 13, color: C.textMuted, textAlign: "center", lineHeight: 22 },
});
