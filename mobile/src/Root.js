import { ActivityIndicator, AppState, Image, Linking, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
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
  suggestion:{ uri: "https://img.icons8.com/color/96/idea.png" },
};

const MODULE_COLORS = {
  nearby:              C.teal,
  referral:            C.primary,
  complaints:          C.primary,
  complaints_tracking: C.primary,
  chef:                C.teal,
  alerts:              C.orange,
  emergency:           C.red,
  security_alert:      "#7C3AED",
  security_ops:        C.primary,
  settings:            C.textMuted,
  suggestions:         C.amber,
  support:             C.amber,
};

const ROLE_LABELS = {
  USER: "Utilisateur",
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

const MODULE_DESCRIPTIONS = {
  profile:             "Vos informations et votre mot de passe",
  nearby:              "Carte et liste des centres proches",
  referral:            "Orienter un patient vers un centre",
  complaints:          "Signaler un probleme de service",
  complaints_tracking: "Suivre le traitement des plaintes",
  suggestions:         "Partager une idee ou une remarque",
  chef:                "Gerer votre etablissement",
  alerts:              "Recevoir et traiter les alertes",
  security_ops:        "Traiter les alertes de securite",
  emergency:           "Demander une aide medicale",
  security_alert:      "Alerter la police ou la gendarmerie",
  settings:            "Configurer les centres de sante",
  support:             "Contacter l'equipe, soutenir le projet",
};

export function Root() {
  const { user, token, ready, logout } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const [currentTab, setCurrentTab] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [donationModalOpen, setDonationModalOpen] = useState(false);
  const [supportActionsOpen, setSupportActionsOpen] = useState(false);
  const [chefCenterApprovalStatus, setChefCenterApprovalStatus] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncNotice, setSyncNotice] = useState(null);
  const [moduleSettings, setModuleSettings] = useState({});
  const [pendingReferralsCount, setPendingReferralsCount] = useState(0);
  const [chefInitialSection, setChefInitialSection] = useState("");
  const pendingSyncCountRef = useRef(0);
  const syncNoticeTimeoutRef = useRef(null);

  // Refresh & update state
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [openFaqIdx, setOpenFaqIdx] = useState(null);
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
        // ignore - offline or endpoint not available
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
    setCurrentTab("home");
  }, [user?.id]);

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

  // Orientations de patients en attente : alimente la cloche de notification.
  const canReceiveReferrals = canSeeChefSpace && hasAnyRole(["ETABLISSEMENT", "CHEF_ETABLISSEMENT"]);
  useEffect(() => {
    if (!token || !canReceiveReferrals) { setPendingReferralsCount(0); return undefined; }
    let active = true;
    const load = () => apiFetch("/referrals/incoming", { token })
      .then((data) => {
        if (active) setPendingReferralsCount((Array.isArray(data) ? data : []).filter((item) => item.status === "PENDING").length);
      })
      .catch(() => {});
    load();
    const interval = setInterval(load, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [token, canReceiveReferrals, currentTab]);

  useEffect(() => {
    if (currentTab !== "chef") setChefInitialSection("");
  }, [currentTab]);

  function openReferralNotifications() {
    setChefInitialSection("suivi");
    setCurrentTab("chef");
    setRefreshKey((k) => k + 1);
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
      </SafeAreaView>
    );
  }

  if (!user) return <AuthScreen />;

  function renderCurrentScreen() {
    if (currentTab === "profile") {
      const { ProfileScreen } = require("./screens/ProfileScreen");
      return <ProfileScreen key={refreshKey} />;
    }
    if (currentTab === "home") {
      const homeColumns = windowWidth >= 600 ? 4 : 3;
      const homeGap = windowWidth >= 600 ? 16 : 10;
      const homePadding = windowWidth >= 600 ? 24 : 14;
      const tileWidth = Math.floor((windowWidth - homePadding * 2 - homeGap * (homeColumns - 1)) / homeColumns);
      // "Mon profil" reste accessible depuis le menu, pas depuis l'accueil.
      const homeTiles = [
        ...tabs.filter((tab) => tab.key !== "profile"),
        { key: "support", label: "Support & projet", icon: MODULE_ICONS.developer }
      ];
      return (
        <View style={{ flex: 1 }}>
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="homeBg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#CFE0FA" />
                <Stop offset="1" stopColor="#D5F1EC" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#homeBg)" />
          </Svg>
          <View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFillObject, { alignItems: "center", justifyContent: "center" }]}>
            <Image
              source={require("../assets/logo-yefa.png")}
              resizeMode="contain"
              accessible={false}
              style={{ width: "88%", height: "75%", maxWidth: 560, opacity: 0.06 }}
            />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: homePadding, paddingTop: 20, paddingBottom: 28 }}>
            <View style={styles.homeHero}>
              <Text style={styles.homeHeroTitle}>Bienvenue</Text>
              <Text style={styles.homeHeroName} numberOfLines={2}>{user.fullName}</Text>
              <Text style={styles.homeHeroHint}>Choisissez un module</Text>
            </View>
            <View style={[styles.homeGrid, { gap: homeGap }]}>
              {homeTiles.map((tab) => {
                const accent = MODULE_COLORS[tab.key] || C.primary;
                const onPress = tab.key === "support"
                  ? () => { setSupportActionsOpen(true); setMenuOpen(true); }
                  : () => setCurrentTab(tab.key);
                return (
                  <Pressable
                    key={tab.key}
                    style={({ pressed }) => [{ width: tileWidth, paddingTop: 5, paddingRight: 5 }, pressed && { opacity: 0.85 }]}
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityLabel={`${tab.label}. ${MODULE_DESCRIPTIONS[tab.key] || ""}`}
                  >
                    <View style={styles.homeTileBack} />
                    {tab.key === "chef" && pendingReferralsCount > 0 ? (
                      <View style={styles.homeTileBadge}>
                        <Text style={styles.homeTileBadgeText}>🔔 {pendingReferralsCount}</Text>
                      </View>
                    ) : null}
                    <View style={styles.homeTile}>
                      <View style={[styles.homeTileArt, { backgroundColor: `${accent}14`, height: Math.round(tileWidth * 0.52) }]}>
                        <Image source={tab.icon} style={{ width: Math.round(tileWidth * 0.4), height: Math.round(tileWidth * 0.4) }} />
                      </View>
                      <Text style={styles.homeTileLabel} numberOfLines={2}>{tab.label}</Text>
                      {MODULE_DESCRIPTIONS[tab.key] ? (
                        <Text style={styles.homeTileDesc} numberOfLines={3}>{MODULE_DESCRIPTIONS[tab.key]}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      );
    }
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
      return <ChefScreen key={refreshKey} initialSection={chefInitialSection} />;
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
    { key: "profile", label: "Mon profil", icon: MODULE_ICONS.settings },
    ...(canSeeNearby           ? [{ key: "nearby",              label: "Centres de sante",       icon: MODULE_ICONS.centers   }] : []),
    ...(canUseReferralModule   ? [{ key: "referral",            label: "Reference malade",       icon: MODULE_ICONS.referral  }] : []),
    ...(canPostComplaint        ? [{ key: "complaints",          label: "Poser une plainte",      icon: MODULE_ICONS.complaints }] : []),
    ...(canTrackComplaints      ? [{ key: "complaints_tracking", label: "Suivi des plaintes",     icon: MODULE_ICONS.tracking   }] : []),
    ...(canUseSuggestions       ? [{ key: "suggestions",         label: "Observation/Suggestion", icon: MODULE_ICONS.suggestion }] : []),
    ...(canSeeChefSpace         ? [{ key: "chef",                label: "Espace chef",            icon: MODULE_ICONS.chef       }] : []),
    ...(canSeeEmergencyAlerts   ? [{ key: "alerts",              label: emergencyAlertsLabel,     icon: MODULE_ICONS.alerts     }] : []),
    ...(canSeeSecurityOps       ? [{ key: "security_ops",        label: "Urgences securitaires",   icon: MODULE_ICONS.security   }] : []),
    ...(canSendEmergencyRequest ? [{ key: "emergency",           label: "Urgence sanitaire",      icon: MODULE_ICONS.emergency  }] : []),
    ...(canSendSecurityAlert    ? [{ key: "security_alert",      label: "Urgence securitaire",    icon: MODULE_ICONS.security   }] : []),
    ...(canSeeCenterSettings    ? [{ key: "settings",            label: "Parametres centres",     icon: MODULE_ICONS.settings   }] : []),
  ];

  const activeTab = tabs.find((t) => t.key === currentTab);
  const supportCardActive = currentTab === "contact_developer" || projectModalOpen || supportActionsOpen;
  const menuTabs = tabs;

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
          {canReceiveReferrals ? (
            <Pressable
              style={styles.bellBtn}
              onPress={openReferralNotifications}
              accessibilityLabel={`Orientations de patients : ${pendingReferralsCount} en attente`}
            >
              <Text style={styles.bellIcon}>🔔</Text>
              {pendingReferralsCount > 0 ? (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{pendingReferralsCount > 99 ? "99+" : pendingReferralsCount}</Text>
                </View>
              ) : null}
            </Pressable>
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
            {/* Fixed header - never scrolls */}
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
              {menuTabs.map((tab) => {
                const accent = MODULE_COLORS[tab.key] || C.primary;
                const isActive = currentTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    style={[styles.moduleCard, isActive && { borderColor: accent, borderWidth: 2 }]}
                    onPress={() => { setCurrentTab(tab.key); setMenuOpen(false); }}
                  >
                    {isActive ? <View style={[styles.moduleCardActiveBar, { backgroundColor: accent }]} /> : null}
                    <Image source={tab.icon} style={styles.moduleCardIcon} />
                    <Text style={[styles.moduleCardText, isActive && { color: accent }]}>{tab.label}</Text>
                  </Pressable>
                );
              })}

              <Pressable
                style={[styles.moduleCard, supportCardActive && { borderColor: C.amber, borderWidth: 2 }]}
                onPress={() => setSupportActionsOpen((value) => !value)}
              >
                {supportCardActive ? <View style={[styles.moduleCardActiveBar, { backgroundColor: C.amber }]} /> : null}
                <Image source={MODULE_ICONS.developer} style={styles.moduleCardIcon} />
                <Text style={[styles.moduleCardText, supportCardActive && { color: C.amber }]}>Support & projet</Text>
              </Pressable>
            </View>

            {supportActionsOpen ? (
              <>
                <View style={styles.drawerDivider} />

                <View style={styles.supportModuleCard}>
                  <View style={styles.supportModuleHeader}>
                    <Text style={styles.supportModuleTitle}>Support & projet</Text>
                    <Text style={styles.supportModuleHint}>
                      Choisissez l'action que vous voulez lancer
                    </Text>
                  </View>

                  <View style={styles.supportModuleBody}>
                    {canSeeContactDeveloper ? (
                    <Pressable
                      style={[styles.supportActionBtn, styles.supportActionBtnYellow]}
                      onPress={() => {
                        setCurrentTab("contact_developer");
                        setSupportActionsOpen(false);
                        setMenuOpen(false);
                      }}
                    >
                      <Image source={MODULE_ICONS.developer} style={styles.supportActionIcon} />
                      <View style={styles.supportActionTextWrap}>
                        <Text style={styles.supportActionTitleDark}>Contacter le developpeur</Text>
                        <Text style={styles.supportActionSubDark}>Message direct a YEFA Technologie</Text>
                      </View>
                    </Pressable>
                    ) : null}

                    {canSeeProject ? (
                    <Pressable
                      style={[styles.supportActionBtn, styles.supportActionBtnRed]}
                      onPress={() => {
                        setSupportActionsOpen(false);
                        setMenuOpen(false);
                        setProjectModalOpen(true);
                      }}
                    >
                      <Image source={MODULE_ICONS.project} style={styles.supportActionIcon} />
                      <View style={styles.supportActionTextWrap}>
                        <Text style={styles.supportActionTitleLight}>Vous avez un projet de digitalisation ?</Text>
                        <Text style={styles.supportActionSubLight}>Cliquez ici et parlez-en a YEFA</Text>
                      </View>
                    </Pressable>
                    ) : null}

                    {canSeeDonation ? (
                    <Pressable
                      style={[styles.supportActionBtn, { backgroundColor: "#00A3E0" }]}
                      onPress={() => {
                        setSupportActionsOpen(false);
                        setMenuOpen(false);
                        setDonationModalOpen(true);
                      }}
                    >
                      <Text style={styles.supportActionIconText}>💙</Text>
                      <View style={styles.supportActionTextWrap}>
                        <Text style={styles.supportActionTitleLight}>Faire un don</Text>
                        <Text style={styles.supportActionSubLight}>Soutenez le projet via Wave</Text>
                      </View>
                    </Pressable>
                    ) : null}

                    <Pressable
                      style={[styles.supportActionBtn, { backgroundColor: C.primaryLight }]}
                      onPress={() => {
                        setSupportActionsOpen(false);
                        setMenuOpen(false);
                        setShowAbout(true);
                      }}
                    >
                      <Text style={styles.supportActionIconText}>ℹ️</Text>
                      <View style={styles.supportActionTextWrap}>
                        <Text style={[styles.supportActionTitleDark, { color: C.primaryDark }]}>A propos de l'application</Text>
                        <Text style={[styles.supportActionSubDark, { color: C.primary }]}>Version {APP_VERSION} - Sante et Securite a Proximite</Text>
                      </View>
                    </Pressable>

                    <Pressable
                      style={[styles.supportActionBtn, { backgroundColor: C.tealLight }]}
                      onPress={() => {
                        setSupportActionsOpen(false);
                        setMenuOpen(false);
                        setShowHelp(true);
                      }}
                    >
                      <Text style={styles.supportActionIconText}>❓</Text>
                      <View style={styles.supportActionTextWrap}>
                        <Text style={[styles.supportActionTitleDark, { color: C.teal }]}>Aide & FAQ</Text>
                        <Text style={[styles.supportActionSubDark, { color: C.teal }]}>Comment utiliser l'application</Text>
                      </View>
                    </Pressable>

                    {canSeeClearCache ? (
                    <Pressable
                      style={[styles.supportActionBtn, { backgroundColor: C.amberLight, opacity: clearingCache ? 0.6 : 1 }]}
                      onPress={async () => {
                        setSupportActionsOpen(false);
                        setMenuOpen(false);
                        await handleClearCache();
                      }}
                      disabled={clearingCache}
                    >
                      <Text style={styles.supportActionIconText}>🗑️</Text>
                      <View style={styles.supportActionTextWrap}>
                        <Text style={[styles.supportActionTitleDark, { color: C.amber }]}>
                          {clearingCache ? "Nettoyage en cours..." : "Vider le cache local"}
                        </Text>
                        <Text style={[styles.supportActionSubDark, { color: C.amber }]}>
                          Libere l'espace si l'appli est lente ou bloquee
                        </Text>
                      </View>
                    </Pressable>
                    ) : null}
                  </View>
                </View>

                <View style={styles.drawerDivider} />
              </>
            ) : (
              <View style={styles.drawerDivider} />
            )}

            </ScrollView>

            {/* Fixed footer - always visible */}
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
              🚀 Mise a jour disponible (v{updateVersion}) - Appuyez pour mettre a jour
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
          <View style={styles.sessionBar}>
            {currentTab !== "home" ? (
              <Pressable onPress={() => setCurrentTab("home")} accessibilityRole="button" style={styles.sessionBack}>
                <Text style={styles.sessionBackText}>‹ Accueil</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.sessionUser, (pressed || currentTab === "profile") && styles.sessionUserActive]}
              onPress={() => setCurrentTab("profile")}
              accessibilityRole="button"
              accessibilityLabel="Gerer mon profil"
            >
              <View style={styles.sessionAvatar}>
                <Text style={styles.sessionAvatarText}>{String(user.fullName || "?").trim().charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.sessionLabel}>Connecte · Mon profil</Text>
                <Text style={styles.sessionName} numberOfLines={1}>
                  {user.fullName}
                  <Text style={styles.sessionRole}> · {ROLE_LABELS[normalizedRole] || normalizedRole || "Utilisateur"}</Text>
                </Text>
              </View>
              <Text style={styles.sessionChevron}>›</Text>
            </Pressable>
          </View>
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

      {/* A propos modal */}
      <Modal visible={showAbout} transparent animationType="slide" onRequestClose={() => setShowAbout(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>A propos</Text>
              <Pressable style={styles.drawerCloseBtn} onPress={() => setShowAbout(false)}>
                <Text style={styles.drawerCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>

              {/* Hero */}
              <View style={styles.aboutHero}>
                <View style={styles.aboutHeroLogoWrap}>
                  <Image source={require("../assets/logo-sante.png")} style={styles.aboutHeroLogo} resizeMode="contain" />
                </View>
                <Text style={styles.aboutHeroName}>Sante et Securite{"\n"}a Proximite</Text>
                <View style={styles.aboutVersionBadge}>
                  <Text style={styles.aboutVersionBadgeText}>v{APP_VERSION}</Text>
                </View>
                <Text style={styles.aboutHeroTagline}>
                  Plateforme nationale de gestion sanitaire et d'urgences
                </Text>
              </View>

              {/* Stats chips */}
              <View style={styles.aboutChipsRow}>
                {[
                  { icon: "📱", label: "Mobile" },
                  { icon: "🌐", label: "Web" },
                  { icon: "📡", label: "Hors ligne" },
                  { icon: "🔐", label: "RBAC" },
                ].map((chip) => (
                  <View key={chip.label} style={styles.aboutChip}>
                    <Text style={styles.aboutChipIcon}>{chip.icon}</Text>
                    <Text style={styles.aboutChipLabel}>{chip.label}</Text>
                  </View>
                ))}
              </View>

              {/* Mission */}
              <View style={styles.aboutBlock}>
                <Text style={styles.aboutBlockTitle}>🎯  Mission</Text>
                <Text style={styles.aboutBlockText}>
                  Rapprocher les citoyens des services de sante en localisant les centres, coordonnant les urgences et garantissant la transparence des soins a travers tout le territoire national.
                </Text>
              </View>

              {/* Features grid */}
              <View style={styles.aboutBlock}>
                <Text style={styles.aboutBlockTitle}>⚡  Fonctionnalites</Text>
                <View style={styles.aboutFeatGrid}>
                  {[
                    { icon: "📍", label: "Carte des centres", sub: "Localisation en temps reel" },
                    { icon: "📝", label: "Plaintes", sub: "Soumission et suivi" },
                    { icon: "🚨", label: "Urgences sanitaires", sub: "SAMU et Pompiers" },
                    { icon: "🛡", label: "Urgences securitaires", sub: "Police et Gendarmerie" },
                    { icon: "🏥", label: "Espace chef", sub: "Gestion de centre" },
                    { icon: "📡", label: "Mode hors ligne", sub: "Synchronisation auto" },
                  ].map((f) => (
                    <View key={f.label} style={styles.aboutFeatCard}>
                      <Text style={styles.aboutFeatIcon}>{f.icon}</Text>
                      <Text style={styles.aboutFeatLabel}>{f.label}</Text>
                      <Text style={styles.aboutFeatSub}>{f.sub}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Developer */}
              <View style={styles.aboutBlock}>
                <Text style={styles.aboutBlockTitle}>🏢  Developpeur</Text>
                <View style={styles.aboutDevCard}>
                  <View style={styles.aboutDevBadge}>
                    <Text style={styles.aboutDevBadgeText}>YT</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.aboutDevName}>YEFA TECHNOLOGIE</Text>
                    <Pressable onPress={() => Linking.openURL("mailto:yefa.technologie@gmail.com")}>
                      <Text style={styles.aboutDevEmail}>yefa.technologie@gmail.com</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              {/* Version & update */}
              <View style={styles.aboutBlock}>
                <Text style={styles.aboutBlockTitle}>🔖  Version</Text>
                <View style={styles.aboutVersionRow}>
                  <Text style={styles.aboutVersionLabel}>Version installee</Text>
                  <Text style={styles.aboutVersionValue}>{APP_VERSION}</Text>
                </View>
                {updateAvailable ? (
                  <Pressable
                    style={styles.aboutUpdateBtn}
                    onPress={() => Linking.openURL("https://play.google.com/store/apps/details?id=com.yefa.sante")}
                  >
                    <Text style={styles.aboutUpdateBtnText}>🚀  Mise a jour v{updateVersion} disponible</Text>
                  </Pressable>
                ) : (
                  <View style={styles.aboutUpToDateRow}>
                    <Text style={styles.aboutUpToDateText}>✓  Application a jour</Text>
                  </View>
                )}
              </View>

              {/* Cache */}
              {canSeeClearCache ? (
              <>
              <Pressable
                style={[styles.aboutCacheBtn, clearingCache && { opacity: 0.6 }]}
                onPress={async () => { await handleClearCache(); setShowAbout(false); }}
                disabled={clearingCache}
              >
                <Text style={styles.aboutCacheBtnText}>
                  {clearingCache ? "Nettoyage..." : "🗑️  Vider le cache local"}
                </Text>
              </Pressable>
              <Text style={styles.aboutCacheHint}>
                A utiliser si l'appli est lente ou affiche des erreurs de stockage.
              </Text>
              </>
              ) : null}

            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Aide modal */}
      <Modal visible={showHelp} transparent animationType="slide" onRequestClose={() => setShowHelp(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Aide & FAQ</Text>
              <Pressable style={styles.drawerCloseBtn} onPress={() => setShowHelp(false)}>
                <Text style={styles.drawerCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>

              {/* Intro */}
              <View style={styles.helpIntro}>
                <Text style={styles.helpIntroText}>
                  Trouvez rapidement les reponses a vos questions sur l'utilisation de l'application.
                </Text>
              </View>

              {/* Quick tips */}
              <View style={styles.helpTipsRow}>
                {[
                  { icon: "↻",  label: "Bouton ↻\npour actualiser" },
                  { icon: "☰",  label: "Menu\nen haut a droite" },
                  { icon: "📡", label: "Hors ligne\nsupporte" },
                ].map((tip) => (
                  <View key={tip.label} style={styles.helpTip}>
                    <Text style={styles.helpTipIcon}>{tip.icon}</Text>
                    <Text style={styles.helpTipLabel}>{tip.label}</Text>
                  </View>
                ))}
              </View>

              {/* FAQ accordeon */}
              <Text style={styles.helpFaqTitle}>Questions frequentes</Text>
              {[
                {
                  icon: "📍",
                  q: "Comment trouver un centre de sante proche ?",
                  a: "Depuis l'ecran principal, l'application detecte votre position et affiche les centres les plus proches sur la carte interactive. Vous pouvez filtrer par type ou distance.",
                },
                {
                  icon: "📝",
                  q: "Comment soumettre une plainte ?",
                  a: "Allez dans 'Poser une plainte', selectionnez le centre concerne, decrivez le probleme et soumettez. Suivez l'etat de vos plaintes dans 'Suivi des plaintes'.",
                },
                {
                  icon: "🚨",
                  q: "Comment signaler une urgence sanitaire ?",
                  a: "Appuyez sur 'Urgence sanitaire' dans le menu. Remplissez le formulaire avec votre localisation et la description. Le SAMU ou les pompiers seront alertes immediatement.",
                },
                {
                  icon: "🛡",
                  q: "Comment signaler une urgence securitaire ?",
                  a: "Appuyez sur 'Urgence securitaire'. Decrivez la situation et soumettez. La police ou la gendarmerie recevra l'alerte.",
                },
                {
                  icon: "📡",
                  q: "L'application fonctionne-t-elle sans connexion ?",
                  a: "Oui. Les actions hors ligne sont enregistrees localement et synchronisees automatiquement a la reconnexion. Une notification vous informe de l'etat de la synchronisation.",
                },
                {
                  icon: "🏥",
                  q: "Je suis chef d'etablissement, comment gerer mon centre ?",
                  a: "Connectez-vous avec votre compte chef. L'appli vous redirige automatiquement vers 'Espace chef' pour gerer les infos, les plaintes et les services de votre etablissement.",
                },
                {
                  icon: "🔄",
                  q: "Comment mettre a jour l'application ?",
                  a: "Une banniere s'affiche en haut si une mise a jour est disponible. Appuyez dessus pour aller sur le store. Vous pouvez aussi verifier dans 'Support & projet > A propos'.",
                },
                {
                  icon: "🗑️",
                  q: "A quoi sert le cache local ?",
                  a: "Le cache stocke temporairement les donnees pour accelerer l'affichage. Si l'appli est lente ou bloquee, videz le cache depuis 'Support & projet > Vider le cache'.",
                },
                {
                  icon: "🔑",
                  q: "J'ai oublie mon mot de passe, que faire ?",
                  a: "Contactez l'administrateur de votre structure (region, district ou etablissement). Il peut reinitialiser votre mot de passe depuis le tableau de bord web.",
                },
                {
                  icon: "📞",
                  q: "Comment contacter le support technique ?",
                  a: "Dans le menu hamburger, allez dans 'Support & projet' puis 'Contacter le developpeur'. Vous pouvez aussi ecrire directement a yefa.technologie@gmail.com.",
                },
              ].map((item, i) => {
                const isOpen = openFaqIdx === i;
                return (
                  <Pressable
                    key={i}
                    style={[styles.faqItem, isOpen && styles.faqItemOpen]}
                    onPress={() => setOpenFaqIdx(isOpen ? null : i)}
                  >
                    <View style={styles.faqRow}>
                      <Text style={styles.faqItemIcon}>{item.icon}</Text>
                      <Text style={[styles.faqQuestion, isOpen && styles.faqQuestionOpen]}>{item.q}</Text>
                      <Text style={[styles.faqArrow, isOpen && styles.faqArrowOpen]}>{isOpen ? "▾" : "›"}</Text>
                    </View>
                    {isOpen ? (
                      <View style={styles.faqAnswerWrap}>
                        <Text style={styles.faqAnswer}>{item.a}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}

              {/* Contact */}
              <View style={styles.helpContactCard}>
                <Text style={styles.helpContactTitle}>Pas de reponse a votre question ?</Text>
                <Pressable
                  style={styles.helpContactBtn}
                  onPress={() => Linking.openURL("mailto:yefa.technologie@gmail.com")}
                >
                  <Text style={styles.helpContactBtnText}>📧  Contacter le support</Text>
                </Pressable>
              </View>

            </ScrollView>
          </View>
        </View>
      </Modal>
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
    backgroundColor: "#3B82F6",
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
  bellBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  bellIcon: { fontSize: 20 },
  bellBadge: {
    position: "absolute", top: -2, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4, backgroundColor: C.red, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#fff",
  },
  bellBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  sessionBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  sessionBack: { paddingVertical: 4, paddingRight: 8 },
  sessionBackText: { color: C.primary, fontWeight: "700" },
  sessionUser: {
    flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 1,
    backgroundColor: C.primaryLight, borderRadius: 999, paddingVertical: 4, paddingLeft: 4, paddingRight: 12,
  },
  sessionUserActive: { backgroundColor: "#D6E4FF" },
  sessionChevron: { fontSize: 18, fontWeight: "800", color: C.primary, marginLeft: 2 },
  sessionAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  sessionAvatarText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  sessionLabel: { fontSize: 9, fontWeight: "800", color: C.textMuted, letterSpacing: 0.6, textTransform: "uppercase" },
  sessionName: { fontSize: 13, fontWeight: "800", color: C.primaryDark },
  sessionRole: { fontSize: 12, fontWeight: "600", color: C.textMed },
  homeTileBadge: {
    position: "absolute", top: 0, right: 0, zIndex: 2, backgroundColor: C.red, borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3, borderWidth: 2, borderColor: "#fff",
  },
  homeTileBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
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

  homeHero: { alignItems: "center", marginBottom: 20, gap: 2 },
  homeHeroTitle: { fontSize: 14, fontWeight: "600", color: C.primaryDark, letterSpacing: 0.5 },
  homeHeroName: { fontSize: 22, fontWeight: "800", color: C.textDark, textAlign: "center" },
  homeHeroHint: { fontSize: 13, color: C.textMuted, fontWeight: "600", marginTop: 4 },
  homeGrid: { flexDirection: "row", flexWrap: "wrap" },
  homeTileBack: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 5,
    left: 5,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
  },
  homeTile: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 6,
    paddingBottom: 10,
    alignItems: "center",
    ...S.sm,
  },
  homeTileArt: {
    alignSelf: "stretch",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  homeTileLabel: { fontSize: 12, fontWeight: "800", color: C.textDark, textAlign: "center", paddingHorizontal: 2 },
  homeTileDesc: { fontSize: 10, lineHeight: 13, color: C.textMuted, textAlign: "center", marginTop: 3, paddingHorizontal: 2 },

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

  // About - hero
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
