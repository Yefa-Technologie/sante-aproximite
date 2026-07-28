import { computed, reactive, ref, watch } from "vue";
import { apiFetch } from "../api/client";
import { useAuthStore } from "./auth";

// Singleton state - shared across all component instances (like a Pinia store)
const _store = (() => {
  const auth = useAuthStore();

  // ─── Permission helpers ─────────────────────────────────────────────────────
  const permissions = computed(() => new Set(Array.isArray(auth.state.user?.permissions) ? auth.state.user.permissions : []));
  const hasPermission = (key) => permissions.value.has(key);

  // ─── Role helpers ───────────────────────────────────────────────────────────
  const normalizeRole = (value) =>
    String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");

  const authRoles = computed(() => {
    const combined = [
      ...(Array.isArray(auth.state.user?.roles) ? auth.state.user.roles : []),
      auth.state.user?.role,
    ]
      .map((v) => normalizeRole(v))
      .filter(Boolean);
    return [...new Set(combined)];
  });

  const isDeveloper = computed(() => authRoles.value.includes("DEVELOPER"));

  const hasAnyRole = (values) =>
    isDeveloper.value || values.some((v) => authRoles.value.includes(normalizeRole(v)));

  const hasStrictRole = (values) =>
    values.some((v) => authRoles.value.includes(normalizeRole(v)));

  const isChef = computed(() =>
    hasStrictRole(["ETABLISSEMENT", "CHEF_ETABLISSEMENT"])
  );
  const isRegulator = computed(() =>
    isDeveloper.value || hasStrictRole(["REGULATOR", "NATIONAL", "REGION", "DISTRICT"])
  );
  const isEmergencyResponder = computed(() =>
    hasStrictRole(["SAMU", "SAPEUR_POMPIER"])
  );
  const isSecurityResponder = computed(() =>
    hasStrictRole(["POLICE", "GENDARMERIE", "PROTECTION_CIVILE"])
  );
  const canManageUsers = computed(() =>
    isDeveloper.value || hasAnyRole([
      "NATIONAL", "REGULATOR", "REGION", "DISTRICT",
      "ETABLISSEMENT", "CHEF_ETABLISSEMENT", "SAMU", "SAPEUR_POMPIER",
      "POLICE", "GENDARMERIE", "PROTECTION_CIVILE",
    ])
  );
  const isNational = computed(() => hasStrictRole(["NATIONAL"]));
  const isHealthAdmin = computed(() =>
    isDeveloper.value || hasStrictRole(["NATIONAL", "REGULATOR", "REGION", "DISTRICT"])
  );

  // ─── Tab ────────────────────────────────────────────────────────────────────
  const tab = ref("overview");

  function resolveTab(tabCandidate) {
    const requested = String(tabCandidate || "").trim();
    // DEVELOPER accède à tous les onglets sans restriction
    if (isDeveloper.value) {
      const allTabs = ["overview", "nearby", "emergency-alerts", "security-alerts", "complaints", "suggestions", "evaluations", "my-center", "referrals", "settings", "imports", "roles", "analytics"];
      return allTabs.includes(requested) ? requested : "overview";
    }
    if (isChef.value) {
      if (requested === "evaluations" && hasApprovedChefCenter.value)
        return "evaluations";
      if (requested === "complaints" && hasApprovedChefCenter.value)
        return "complaints";
      if (requested === "suggestions" && hasApprovedChefCenter.value)
        return "suggestions";
      if (requested === "referrals" && hasApprovedChefCenter.value)
        return "referrals";
      return "my-center";
    }
    const allowed = ["overview", "nearby"];
    if (isEmergencyResponder.value) allowed.push("emergency-alerts");
    if (isSecurityResponder.value) allowed.push("security-alerts");
    if (isRegulator.value)
      allowed.push("complaints", "suggestions", "evaluations", "settings", "imports", "roles", "analytics");
    if (hasAnyRole(["NATIONAL", "REGULATOR"])) allowed.push("roles");
    if (canManageUsers.value) allowed.push("settings");
    if (allowed.includes(requested)) return requested;
    if (isEmergencyResponder.value) return "emergency-alerts";
    if (isSecurityResponder.value) return "security-alerts";
    return "overview";
  }

  // ─── Common ─────────────────────────────────────────────────────────────────
  const error = ref("");
  const info = ref("");

  // ─── Centers ─────────────────────────────────────────────────────────────────
  const radiusKm = ref(20);
  const nearbySearch = ref("");
  const coords = ref(null);
  const nearbyCenters = ref([]);
  const allCenters = ref([]);
  const selectedCenter = ref(null);
  const nearbyBootstrapped = ref(false);

  const approvedChefCenters = computed(() =>
    isChef.value
      ? allCenters.value.filter(
          (c) => String(c?.approvalStatus || "").toUpperCase() === "APPROVED"
        )
      : []
  );
  const hasApprovedChefCenter = computed(
    () => approvedChefCenters.value.length > 0
  );
  const canSeeComplaintsPanel = computed(
    () => isDeveloper.value || isRegulator.value || (isChef.value && hasApprovedChefCenter.value)
  );
  const canHandleComplaintActions = computed(
    () => isDeveloper.value || isRegulator.value || (isChef.value && hasApprovedChefCenter.value)
  );

  const filteredNearbyCenters = computed(() => {
    const q = String(nearbySearch.value || "").trim().toLowerCase();
    if (!q) return nearbyCenters.value;
    return nearbyCenters.value.filter((c) => {
      const name = String(c?.name || "").toLowerCase();
      const type = String(formatType(c?.establishmentType) || "").toLowerCase();
      const platform = String(c?.technicalPlatform || "").toLowerCase();
      const services = Array.isArray(c?.services)
        ? c.services.map((s) => String(s?.name || "").toLowerCase()).join(" ")
        : "";
      return (
        name.includes(q) ||
        type.includes(q) ||
        platform.includes(q) ||
        services.includes(q)
      );
    });
  });

  // ─── Complaints ──────────────────────────────────────────────────────────────
  const complaintStatusFilter = ref("");
  const evaluationSearch = ref("");
  const complaintsList = ref([]);
  const complaintSummary = ref(null);
  const complaintStepNotes = reactive({});
  const complaintAdminError = ref("");
  const complaintSuccess = ref("");

  // ─── Suggestions ─────────────────────────────────────────────────────────────
  const suggestionsList = ref([]);
  const suggestionSummary = ref(null);
  const suggestionError = ref("");
  const suggestionSuccess = ref("");
  const suggestionActionLoadingId = ref("");
  let suggestionRefreshTimer = null;

  // ─── App settings (developer) ────────────────────────────────────────────────
  const appSettings = ref({ centerReviewsEnabled: true });
  const appSettingsLoading = ref(false);
  const appSettingsError = ref("");
  const appSettingsSuccess = ref("");

  // ─── Module access per role (developer) ──────────────────────────────────────
  const moduleDefinitions = ref([]);
  const roleDefinitions = ref([]);
  const appDefinitions = ref([]);
  const moduleSettingsApp = ref("mobile");
  const moduleSettingsMatrix = ref({});
  const moduleSettingsLoading = ref(false);
  const moduleSettingsError = ref("");

  const PAGE_SIZE = 5;
  const complaintsPage = ref(1);
  const evaluationPage = ref(1);

  const complaintsPageCount = computed(() =>
    Math.max(1, Math.ceil(complaintsList.value.length / PAGE_SIZE))
  );
  const paginatedComplaintsList = computed(() => {
    const start = (complaintsPage.value - 1) * PAGE_SIZE;
    return complaintsList.value.slice(start, start + PAGE_SIZE);
  });

  const filteredEvaluationCenters = computed(() => {
    const q = String(evaluationSearch.value || "").trim().toLowerCase();
    const centers = allCenters.value
      .map((c) => ({
        ...c,
        ratingAverage: c?.ratingAverage == null ? null : Number(c.ratingAverage),
        satisfactionRate:
          c?.satisfactionRate == null ? null : Number(c.satisfactionRate),
        ratingCount: Number(c?.ratingCount || 0),
      }))
      .sort((a, b) => {
        const aS = a.ratingAverage == null ? -1 : a.ratingAverage;
        const bS = b.ratingAverage == null ? -1 : b.ratingAverage;
        return bS - aS;
      });
    if (!q) return centers;
    return centers.filter((c) => {
      const name = String(c?.name || "").toLowerCase();
      const code = String(c?.establishmentCode || "").toLowerCase();
      const address = String(c?.address || "").toLowerCase();
      return name.includes(q) || code.includes(q) || address.includes(q);
    });
  });

  const evaluationPageCount = computed(() =>
    Math.max(1, Math.ceil(filteredEvaluationCenters.value.length / PAGE_SIZE))
  );
  const paginatedEvaluationCenters = computed(() => {
    const start = (evaluationPage.value - 1) * PAGE_SIZE;
    return filteredEvaluationCenters.value.slice(start, start + PAGE_SIZE);
  });

  const evaluationCoverage = computed(() => {
    const totalCenters = Number(
      complaintSummary.value?.centerCount ||
        filteredEvaluationCenters.value.length ||
        0
    );
    const withoutEvaluations = Number(
      complaintSummary.value?.centersWithoutEvaluation || 0
    );
    const withEvaluations = Math.max(totalCenters - withoutEvaluations, 0);
    const percent =
      totalCenters > 0
        ? Math.round((withEvaluations * 100) / totalCenters)
        : 0;
    return { totalCenters, withEvaluations, withoutEvaluations, percent };
  });

  const satisfactionBreakdown = computed(() => {
    const satisfied =
      complaintSummary.value?.satisfactionRate == null
        ? 0
        : Math.max(
            0,
            Math.min(100, Number(complaintSummary.value.satisfactionRate))
          );
    return {
      satisfied: Math.round(satisfied),
      unsatisfied: Math.round(100 - satisfied),
    };
  });

  const topRatedCenters = computed(() =>
    filteredEvaluationCenters.value
      .filter((c) => c.ratingAverage != null)
      .slice(0, 5)
  );

  // ─── Emergency ───────────────────────────────────────────────────────────────
  const emergencyAlerts = ref([]);
  const emergencyGeoDetails = reactive({});
  const emergencyGeoCache = new Map();
  const emergencyCategory = ref("IN_PROGRESS");
  const emergencyPeriodTo = ref(new Date().toISOString().slice(0, 10));
  const emergencyPeriodFrom = ref(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const emergencyStepNotes = reactive({});
  const emergencyAlertsError = ref("");
  const emergencyAlertsSuccess = ref("");
  const emergencyCategoryMenu = [
    { key: "UNHANDLED", label: "Non traite" },
    { key: "IN_PROGRESS", label: "En cours" },
    { key: "REJECTED", label: "Rejete" },
    { key: "COMPLETED", label: "Traite" },
    { key: "ALL", label: "Tous" },
  ];
  let emergencyRefreshTimer = null;

  const filteredEmergencyAlerts = computed(() => {
    if (emergencyCategory.value === "ALL") return emergencyAlerts.value;
    if (emergencyCategory.value === "UNHANDLED")
      return emergencyAlerts.value.filter((i) => i.status === "NEW");
    if (emergencyCategory.value === "IN_PROGRESS")
      return emergencyAlerts.value.filter((i) =>
        ["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(i.status)
      );
    if (emergencyCategory.value === "REJECTED")
      return emergencyAlerts.value.filter((i) => i.status === "CLOSED");
    if (emergencyCategory.value === "COMPLETED")
      return emergencyAlerts.value.filter((i) => i.status === "COMPLETED");
    return emergencyAlerts.value;
  });

  const emergencyStats = computed(() => ({
    nonTraite: emergencyAlerts.value.filter((i) => i.status === "NEW").length,
    enCours: emergencyAlerts.value.filter((i) =>
      ["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(i.status)
    ).length,
    traite: emergencyAlerts.value.filter((i) => i.status === "COMPLETED")
      .length,
    rejete: emergencyAlerts.value.filter((i) => i.status === "CLOSED").length,
  }));

  // ─── Security Alerts ─────────────────────────────────────────────────────────
  const securityAlerts = ref([]);
  const securityAlertsError = ref("");
  const securityAlertsSuccess = ref("");
  const securityCategory = ref("ALL");
  const securityCategoryMenu = [
    { key: "ALL",        label: "Toutes" },
    { key: "UNHANDLED",  label: "Non traite" },
    { key: "IN_PROGRESS",label: "En cours" },
    { key: "RESOLVED",   label: "Resolues" },
    { key: "CLOSED",     label: "Cloturees" },
  ];

  const filteredSecurityAlerts = computed(() => {
    if (securityCategory.value === "ALL")         return securityAlerts.value;
    if (securityCategory.value === "UNHANDLED")   return securityAlerts.value.filter((a) => a.status === "NEW");
    if (securityCategory.value === "IN_PROGRESS") return securityAlerts.value.filter((a) => a.status === "ACKNOWLEDGED");
    if (securityCategory.value === "RESOLVED")    return securityAlerts.value.filter((a) => a.status === "RESOLVED");
    if (securityCategory.value === "CLOSED")      return securityAlerts.value.filter((a) => a.status === "CLOSED");
    return securityAlerts.value;
  });

  const securityAlertStats = computed(() => ({
    nonTraite: securityAlerts.value.filter((a) => a.status === "NEW").length,
    enCours:   securityAlerts.value.filter((a) => a.status === "ACKNOWLEDGED").length,
    resolu:    securityAlerts.value.filter((a) => a.status === "RESOLVED").length,
    cloture:   securityAlerts.value.filter((a) => a.status === "CLOSED").length,
  }));

  async function fetchSecurityAlerts() {
    securityAlertsError.value = "";
    securityAlertsSuccess.value = "";
    try {
      securityAlerts.value = await apiFetch("/security-alerts", { token: auth.state.token });
    } catch (err) {
      securityAlertsError.value = err.message;
    }
  }

  async function takeSecurityAlertInCharge(item) {
    securityAlertsError.value = "";
    securityAlertsSuccess.value = "";
    try {
      await apiFetch(`/security-alerts/${item.id}`, {
        token: auth.state.token,
        method: "PATCH",
        body: { status: "ACKNOWLEDGED" },
      });
      securityAlertsSuccess.value = "Alerte prise en compte";
      await fetchSecurityAlerts();
    } catch (err) {
      securityAlertsError.value = err.message;
    }
  }

  async function resolveSecurityAlert(item) {
    securityAlertsError.value = "";
    securityAlertsSuccess.value = "";
    try {
      await apiFetch(`/security-alerts/${item.id}`, {
        token: auth.state.token,
        method: "PATCH",
        body: { status: "RESOLVED" },
      });
      securityAlertsSuccess.value = "Alerte resolue";
      await fetchSecurityAlerts();
    } catch (err) {
      securityAlertsError.value = err.message;
    }
  }

  async function closeSecurityAlert(item) {
    securityAlertsError.value = "";
    securityAlertsSuccess.value = "";
    try {
      await apiFetch(`/security-alerts/${item.id}`, {
        token: auth.state.token,
        method: "PATCH",
        body: { status: "CLOSED" },
      });
      securityAlertsSuccess.value = "Alerte cloturee";
      await fetchSecurityAlerts();
    } catch (err) {
      securityAlertsError.value = err.message;
    }
  }

  function formatSecurityAlertType(type) {
    const map = { AGRESSION: "Agression", ACCIDENT: "Accident", INCENDIE: "Incendie", INTRUSION: "Intrusion", AUTRE: "Autre" };
    return map[String(type || "").toUpperCase()] || type || "-";
  }

  function formatSecurityStatus(status) {
    const map = { NEW: "Nouveau", ACKNOWLEDGED: "Pris en charge", RESOLVED: "Resolu", CLOSED: "Cloture" };
    return map[String(status || "").toUpperCase()] || status || "-";
  }

  function getSecurityStatusClass(status) {
    const s = String(status || "").toUpperCase();
    if (s === "NEW")          return "badge-new";
    if (s === "ACKNOWLEDGED") return "badge-in-progress";
    if (s === "RESOLVED")     return "badge-success";
    if (s === "CLOSED")       return "badge-closed";
    return "";
  }

  function getSecurityAlertCardClass(status) {
    const s = String(status || "").toUpperCase();
    if (s === "NEW")          return "card-new";
    if (s === "ACKNOWLEDGED") return "card-in-progress";
    if (s === "RESOLVED")     return "card-resolved";
    if (s === "CLOSED")       return "card-closed";
    return "";
  }

  function navigateToSecurityAlert(item) {
    const lat = Number(item?.latitude);
    const lon = Number(item?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      securityAlertsError.value = "Coordonnees invalides pour cette alerte.";
      return;
    }
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, "_blank");
  }

  function buildSecurityMapEmbedUrl(lat, lon) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return "";
    return `https://maps.google.com/maps?q=${lat},${lon}&z=15&output=embed`;
  }

  // ─── Referrals (orientations de patients) ──────────────────────────────────
  const incomingReferrals = ref([]);
  const referralsError = ref("");
  const referralsSuccess = ref("");
  const referralActionLoadingId = ref("");
  let referralsRefreshTimer = null;

  const pendingReferrals = computed(() =>
    incomingReferrals.value.filter((r) => r.status === "PENDING")
  );
  const receivedReferrals = computed(() =>
    incomingReferrals.value.filter((r) => r.status === "RECEIVED")
  );
  const rejectedReferrals = computed(() =>
    incomingReferrals.value.filter((r) => r.status === "REJECTED")
  );

  async function fetchIncomingReferrals() {
    referralsError.value = "";
    try {
      incomingReferrals.value = await apiFetch("/referrals/incoming", { token: auth.state.token });
    } catch (err) {
      referralsError.value = err.message;
    }
  }

  async function confirmReferralReception(item) {
    referralsError.value = "";
    referralsSuccess.value = "";
    referralActionLoadingId.value = String(item.id);
    try {
      await apiFetch(`/referrals/${item.id}/confirm`, {
        token: auth.state.token,
        method: "POST",
      });
      referralsSuccess.value = "Reception du patient confirmee";
      await fetchIncomingReferrals();
    } catch (err) {
      referralsError.value = err.message;
    } finally {
      referralActionLoadingId.value = "";
    }
  }

  async function rejectReferralReception(item, reason) {
    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) {
      referralsError.value = "Indiquez un motif de rejet";
      return;
    }
    referralsError.value = "";
    referralsSuccess.value = "";
    referralActionLoadingId.value = String(item.id);
    try {
      await apiFetch(`/referrals/${item.id}/reject`, {
        token: auth.state.token,
        method: "POST",
        body: { reason: trimmedReason },
      });
      referralsSuccess.value = "Orientation rejetee";
      await fetchIncomingReferrals();
    } catch (err) {
      referralsError.value = err.message;
    } finally {
      referralActionLoadingId.value = "";
    }
  }

  function startReferralsAutoRefresh() {
    if (referralsRefreshTimer) return;
    referralsRefreshTimer = setInterval(() => {
      fetchIncomingReferrals().catch(() => {});
    }, 20000);
  }

  function stopReferralsAutoRefresh() {
    if (!referralsRefreshTimer) return;
    clearInterval(referralsRefreshTimer);
    referralsRefreshTimer = null;
  }

  // ─── Chef center ─────────────────────────────────────────────────────────────
  const myCenterId = ref("");
  const chefForm = reactive({
    name: "",
    address: "",
    establishmentCode: "",
    level: "CENTRE_SANTE",
    establishmentType: "PUBLIQUE",
    regionCode: "",
    districtCode: "",
    technicalPlatform: "",
    services: [],
    latitude: "",
    longitude: "",
  });
  const chefError = ref("");
  const chefSuccess = ref("");

  const availableDistrictsForChef = computed(() => {
    const r = String(chefForm.regionCode || "").trim().toUpperCase();
    if (!r) return [];
    return districts.value.filter(
      (d) => String(d.regionCode || "").trim().toUpperCase() === r
    );
  });

  // ─── Regulator center ────────────────────────────────────────────────────────
  const regulatorCenterForm = reactive({
    name: "",
    address: "",
    establishmentCode: "",
    level: "CENTRE_SANTE",
    establishmentType: "PUBLIQUE",
    regionCode: "",
    districtCode: "",
    technicalPlatform: "",
    services: [],
    latitude: "",
    longitude: "",
  });
  const regulatorCenterError = ref("");
  const regulatorCenterSuccess = ref("");

  // ─── Users & settings ────────────────────────────────────────────────────────
  const users = ref([]);
  const usersSearch = ref("");
  const userCategory = ref("ALL");
  const usersError = ref("");
  const usersSuccess = ref("");
  const settingsSection = ref("users");
  const editingUserId = ref("");

  const userRoleOptions = [
    "USER", "NATIONAL", "REGION", "DISTRICT", "ETABLISSEMENT",
    "SAPEUR_POMPIER", "SAMU", "POLICE", "GENDARMERIE", "PROTECTION_CIVILE", "REGULATOR",
  ];
  const userCategoryMenu = [
    { key: "ALL", label: "Tous" },
    { key: "SIMPLE", label: "Utilisateur du public" },
    { key: "CENTER", label: "Centre" },
    { key: "SAMU", label: "SAMU" },
    { key: "FIREFIGHTER", label: "Pompier" },
    { key: "POLICE", label: "Police" },
    { key: "GENDARMERIE", label: "Gendarmerie" },
    { key: "PROTECTION_CIVILE", label: "Protection Civile" },
  ];
  const userForm = reactive({
    fullName: "",
    email: "",
    password: "",
    primaryRole: "USER",
    roles: ["USER"],
    establishmentCode: "",
    regionCode: "",
    districtCode: "",
    centerId: "",
  });
  const requiresEstablishmentCode = computed(
    () =>
      userForm.primaryRole === "ETABLISSEMENT" ||
      userForm.roles.includes("ETABLISSEMENT")
  );

  const usersPage = ref(1);

  function getNormalizedUserRoles(user) {
    const combined = [
      ...(Array.isArray(user?.roles) ? user.roles : []),
      user?.role,
    ]
      .map((v) => normalizeRole(v))
      .filter(Boolean);
    return [...new Set(combined)];
  }

  function userHasRole(user, roleName) {
    return getNormalizedUserRoles(user).includes(normalizeRole(roleName));
  }

  function isSimpleUserRole(user) {
    const roles = getNormalizedUserRoles(user);
    const scoped = [
      "NATIONAL", "REGION", "DISTRICT", "REGULATOR",
      "ETABLISSEMENT", "CHEF_ETABLISSEMENT",
      "SAMU", "SAPEUR_POMPIER", "SAPPEUR_POMPIER",
      "POLICE", "GENDARMERIE", "PROTECTION_CIVILE",
    ];
    return roles.includes("USER") && !roles.some((r) => scoped.includes(r));
  }

  function matchesUserCategory(user, category) {
    if (category === "SIMPLE") return isSimpleUserRole(user);
    if (category === "CENTER")
      return userHasRole(user, "ETABLISSEMENT") || userHasRole(user, "CHEF_ETABLISSEMENT");
    if (category === "SAMU") return userHasRole(user, "SAMU");
    if (category === "FIREFIGHTER")
      return userHasRole(user, "SAPEUR_POMPIER") || userHasRole(user, "SAPPEUR_POMPIER");
    if (category === "POLICE") return userHasRole(user, "POLICE");
    if (category === "GENDARMERIE") return userHasRole(user, "GENDARMERIE");
    if (category === "PROTECTION_CIVILE") return userHasRole(user, "PROTECTION_CIVILE");
    return true;
  }

  const userCategoryCounts = computed(() => ({
    ALL: users.value.length,
    SIMPLE: users.value.filter((u) => matchesUserCategory(u, "SIMPLE")).length,
    CENTER: users.value.filter((u) => matchesUserCategory(u, "CENTER")).length,
    SAMU: users.value.filter((u) => matchesUserCategory(u, "SAMU")).length,
    FIREFIGHTER: users.value.filter((u) => matchesUserCategory(u, "FIREFIGHTER")).length,
    POLICE: users.value.filter((u) => matchesUserCategory(u, "POLICE")).length,
    GENDARMERIE: users.value.filter((u) => matchesUserCategory(u, "GENDARMERIE")).length,
    PROTECTION_CIVILE: users.value.filter((u) => matchesUserCategory(u, "PROTECTION_CIVILE")).length,
  }));

  const filteredUsers = computed(() => {
    const q = String(usersSearch.value || "").trim().toLowerCase();
    return users.value.filter((u) => {
      if (!matchesUserCategory(u, userCategory.value)) return false;
      if (!q) return true;
      const name = String(u?.fullName || "").toLowerCase();
      const email = String(u?.email || "").toLowerCase();
      const roles = getNormalizedUserRoles(u).join(" ").toLowerCase();
      const scope = String(formatUserScope(u) || "").toLowerCase();
      return name.includes(q) || email.includes(q) || roles.includes(q) || scope.includes(q);
    });
  });

  const usersPageCount = computed(() =>
    Math.max(1, Math.ceil(filteredUsers.value.length / PAGE_SIZE))
  );
  const paginatedUsers = computed(() => {
    const start = (usersPage.value - 1) * PAGE_SIZE;
    return filteredUsers.value.slice(start, start + PAGE_SIZE);
  });

  // ─── Centers admin ───────────────────────────────────────────────────────────
  const pendingCenters = ref([]);
  const pendingCenterSearch = ref("");
  const centersAdminSearch = ref("");
  const centersAdminRegionFilter = ref("");
  const centersAdminDistrictFilter = ref("");
  const centersAdminActionLoading = ref(false);
  const centersAdminLoading = ref(false);
  const centersAdminError = ref("");
  const centersAdminSuccess = ref("");
  const expandedCenterAdminId = ref("");
  const editingCenterAdminId = ref("");
  const centerAdminForm = reactive({
    name: "",
    address: "",
    establishmentCode: "",
    level: "CENTRE_SANTE",
    establishmentType: "PUBLIQUE",
    regionCode: "",
    districtCode: "",
    technicalPlatform: "",
    services: [],
    latitude: "",
    longitude: "",
  });

  const pendingChefsCount = computed(
    () =>
      users.value.filter((u) => {
        const r = String(u?.role || "").toUpperCase();
        return (
          (r === "ETABLISSEMENT" || r === "CHEF_ETABLISSEMENT") &&
          String(u?.approvalStatus || "").toUpperCase() === "PENDING"
        );
      }).length
  );
  const disabledUsersCount = computed(
    () => users.value.filter((u) => u?.isActive === false).length
  );

  const filteredPendingCenters = computed(() => {
    const q = pendingCenterSearch.value.trim().toLowerCase();
    if (!q) return pendingCenters.value;
    return pendingCenters.value.filter((c) => {
      return (
        String(c.name || "").toLowerCase().includes(q) ||
        String(c.establishmentCode || "").toLowerCase().includes(q)
      );
    });
  });

  const pendingCentersPage = ref(1);
  const pendingCentersPageCount = computed(() =>
    Math.max(1, Math.ceil(filteredPendingCenters.value.length / PAGE_SIZE))
  );
  const paginatedPendingCenters = computed(() => {
    const start = (pendingCentersPage.value - 1) * PAGE_SIZE;
    return filteredPendingCenters.value.slice(start, start + PAGE_SIZE);
  });

  const filteredCentersForAdmin = computed(() => {
    const q = String(centersAdminSearch.value || "").trim().toLowerCase();
    const region = String(centersAdminRegionFilter.value || "").trim().toUpperCase();
    const district = String(centersAdminDistrictFilter.value || "").trim().toUpperCase();
    return allCenters.value.filter((c) => {
      if (region && String(c?.regionCode || "").trim().toUpperCase() !== region) return false;
      if (district && String(c?.districtCode || "").trim().toUpperCase() !== district) return false;
      if (!q) return true;
      return (
        String(c?.name || "").toLowerCase().includes(q) ||
        String(c?.establishmentCode || "").toLowerCase().includes(q) ||
        String(c?.address || "").toLowerCase().includes(q)
      );
    });
  });

  const adminCentersPage = ref(1);
  const adminCentersPageCount = computed(() =>
    Math.max(1, Math.ceil(filteredCentersForAdmin.value.length / PAGE_SIZE))
  );
  const paginatedCentersForAdmin = computed(() => {
    const start = (adminCentersPage.value - 1) * PAGE_SIZE;
    return filteredCentersForAdmin.value.slice(start, start + PAGE_SIZE);
  });

  // ─── Geo ─────────────────────────────────────────────────────────────────────
  const regions = ref([]);
  const districts = ref([]);
  const regionForm = reactive({ code: "", name: "" });
  const districtForm = reactive({ code: "", name: "", regionCode: "" });
  const geoError = ref("");
  const geoSuccess = ref("");
  const parsedRegions = ref([]);
  const parsedDistricts = ref([]);
  const regionImportPreviewCount = ref(0);
  const districtImportPreviewCount = ref(0);
  const regionImportError = ref("");
  const districtImportError = ref("");
  const regionImportSuccess = ref("");
  const districtImportSuccess = ref("");
  const regionImportLoading = ref(false);
  const districtImportLoading = ref(false);

  const availableDistrictsForRegulatorCenter = computed(() => {
    const r = String(regulatorCenterForm.regionCode || "").trim().toUpperCase();
    if (!r) return [];
    return districts.value.filter(
      (d) => String(d.regionCode || "").trim().toUpperCase() === r
    );
  });
  const availableDistrictsForCenterAdminFilter = computed(() => {
    const r = String(centersAdminRegionFilter.value || "").trim().toUpperCase();
    if (!r) return districts.value;
    return districts.value.filter(
      (d) => String(d.regionCode || "").trim().toUpperCase() === r
    );
  });
  const availableDistrictsForCenterAdminForm = computed(() => {
    const r = String(centerAdminForm.regionCode || "").trim().toUpperCase();
    if (!r) return districts.value;
    return districts.value.filter(
      (d) => String(d.regionCode || "").trim().toUpperCase() === r
    );
  });
  const availableDistrictsForUserAssignment = computed(() => {
    const r = String(userForm.regionCode || "").trim().toUpperCase();
    if (!r) return districts.value;
    return districts.value.filter(
      (d) => String(d.regionCode || "").trim().toUpperCase() === r
    );
  });
  const assignableCentersForUser = computed(() => {
    const region = String(userForm.regionCode || "").trim().toUpperCase();
    const district = String(userForm.districtCode || "").trim().toUpperCase();
    return allCenters.value
      .filter((c) => {
        const cr = String(c.regionCode || "").trim().toUpperCase();
        const cd = String(c.districtCode || "").trim().toUpperCase();
        if (district) return cd === district;
        if (region) return cr === region;
        return true;
      })
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  });

  // ─── RBAC ────────────────────────────────────────────────────────────────────
  const rbacRoles = ref([]);
  const rbacPermissions = ref([]);
  const rbacError = ref("");
  const rbacSuccess = ref("");

  async function fetchRbacRoles() {
    rbacError.value = "";
    try {
      rbacRoles.value = await apiFetch("/rbac/roles", { token: auth.state.token });
    } catch (err) {
      rbacError.value = err.message;
    }
  }

  async function fetchRbacPermissions() {
    try {
      rbacPermissions.value = await apiFetch("/rbac/permissions", { token: auth.state.token });
    } catch {
      // silent
    }
  }

  async function createRbacRole(name, description, perms) {
    rbacError.value = "";
    rbacSuccess.value = "";
    try {
      await apiFetch("/rbac/roles", {
        token: auth.state.token,
        method: "POST",
        body: { name, description, permissions: perms },
      });
      rbacSuccess.value = "Rôle créé";
      await fetchRbacRoles();
    } catch (err) {
      rbacError.value = err.message;
    }
  }

  async function updateRbacRole(id, name, description, perms) {
    rbacError.value = "";
    rbacSuccess.value = "";
    try {
      await apiFetch(`/rbac/roles/${id}`, {
        token: auth.state.token,
        method: "PUT",
        body: { name, description, permissions: perms },
      });
      rbacSuccess.value = "Rôle mis à jour";
      await fetchRbacRoles();
    } catch (err) {
      rbacError.value = err.message;
    }
  }

  async function deleteRbacRole(id) {
    rbacError.value = "";
    rbacSuccess.value = "";
    try {
      await apiFetch(`/rbac/roles/${id}`, { token: auth.state.token, method: "DELETE" });
      rbacSuccess.value = "Rôle supprimé";
      await fetchRbacRoles();
    } catch (err) {
      rbacError.value = err.message;
    }
  }

  async function assignRbacUsers(roleId, userIds) {
    rbacError.value = "";
    rbacSuccess.value = "";
    try {
      await apiFetch(`/rbac/roles/${roleId}/users`, {
        token: auth.state.token,
        method: "PUT",
        body: { userIds },
      });
      rbacSuccess.value = "Utilisateurs assignés";
      await fetchRbacRoles();
    } catch (err) {
      rbacError.value = err.message;
    }
  }

  // ─── Imports ─────────────────────────────────────────────────────────────────
  let XLSXModule = null;
  const parsedCenters = ref([]);
  const importPreviewCount = ref(0);
  const importError = ref("");
  const importSuccess = ref("");
  const importLoading = ref(false);
  const deleteCentersConfirm = ref("");
  const deleteCentersLoading = ref(false);
  const deleteCentersError = ref("");
  const deleteCentersSuccess = ref("");

  // ─── Format helpers ──────────────────────────────────────────────────────────
  function formatType(type) {
    if (type === "CONFESSIONNEL") return "Confessionnel";
    if (type === "PRIVE") return "Prive";
    if (type === "PUBLIQUE") return "Publique";
    return type || "-";
  }

  function formatLevel(level) {
    if (level === "CLINIQUE") return "Clinique";
    if (level === "POLYCLINIQUE") return "Polyclinique";
    if (level === "INFIRMERIE") return "Infirmerie";
    if (level === "CENTRE_SANTE") return "Centre de sante";
    if (level === "EHPAD_USLD") return "EHPAD / USLD";
    if (level === "CENTRE_RADIOTHERAPIE") return "Centre de radiotherapie";
    if (level === "CENTRE_CARDIOLOGIE") return "Centre de cardiologie";
    return level || "-";
  }

  function formatDate(value) {
    return new Date(value).toLocaleString();
  }

  function formatComplaintStatus(status) {
    if (status === "NEW") return "NOUVELLE";
    if (status === "IN_PROGRESS") return "EN COURS";
    if (status === "RESOLVED") return "RESOLUE";
    if (status === "REJECTED") return "REJETEE";
    return status || "-";
  }

  function formatEmergencyStatus(status) {
    if (status === "NEW") return "NOUVELLE";
    if (status === "ACKNOWLEDGED") return "PRISE EN CHARGE";
    if (status === "EN_ROUTE") return "EN ROUTE";
    if (status === "ON_SITE") return "SUR SITE";
    if (status === "COMPLETED") return "TERMINEE";
    if (status === "CLOSED") return "CLOTUREE";
    return status || "-";
  }

  function formatUserRoleLabel(role) {
    const labels = {
      USER: "Utilisateur",
      NATIONAL: "National",
      REGION: "Region",
      DISTRICT: "District",
      ETABLISSEMENT: "Etablissement",
      SAPEUR_POMPIER: "SAPEUR-POMPIER",
      SAMU: "SAMU",
      POLICE: "Police",
      GENDARMERIE: "Gendarmerie",
      PROTECTION_CIVILE: "Protection Civile",
      REGULATOR: "Regulateur",
    };
    return labels[role] || role;
  }

  function formatUserScope(user) {
    if (user.centerName || user.centerId)
      return user.centerName ? `Centre: ${user.centerName}` : `Centre #${user.centerId}`;
    if (user.districtCode) return `District: ${user.districtCode}`;
    if (user.regionCode) return `Region: ${user.regionCode}`;
    if (user.establishmentCode) return `Code: ${user.establishmentCode}`;
    return "-";
  }

  function getDistrictName(code) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return "-";
    const found = districts.value.find(
      (d) => String(d.code || "").trim().toUpperCase() === normalized
    );
    return found?.name || normalized;
  }

  // ─── Geolocation ─────────────────────────────────────────────────────────────
  function mapGeolocationError(err) {
    const code = Number(err?.code);
    if (code === 1) return "Permission de localisation refusee. Autorisez la localisation pour ce site.";
    if (code === 2) return "Position indisponible. Verifiez le service de localisation de votre appareil.";
    if (code === 3) return "Delai de localisation depasse. Reessayez dans une zone avec meilleure precision reseau/GPS.";
    return "Impossible de recuperer votre position.";
  }

  function getCurrentPositionDetailed() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocalisation non supportee par ce navigateur"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (geoErr) => reject(new Error(mapGeolocationError(geoErr))),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  }

  // ─── Emergency geo helpers ───────────────────────────────────────────────────
  function emergencyGeoKey(item) {
    const lat = Number(item?.latitude);
    const lon = Number(item?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
    return `${lat.toFixed(5)},${lon.toFixed(5)}:v3`;
  }

  function emergencyGeoState(item) {
    const key = emergencyGeoKey(item);
    if (!key) return null;
    return emergencyGeoDetails[key] || null;
  }

  function getEmergencyCountry(item) {
    const s = emergencyGeoState(item);
    if (!s) return "-";
    if (s.loading) return "Recherche...";
    return s.country || "-";
  }

  function getEmergencyPlaceName(item) {
    const explicit = String(item?.pickupPointName || "").trim();
    if (explicit) return explicit;
    const s = emergencyGeoState(item);
    if (!s) return "-";
    if (s.loading) return "Recherche...";
    return s.placeName || "-";
  }

  function getEmergencyCity(item) {
    const s = emergencyGeoState(item);
    if (!s) return "-";
    if (s.loading) return "Recherche...";
    return s.city || "-";
  }

  function getEmergencyLocality(item) {
    const s = emergencyGeoState(item);
    if (!s) return "-";
    if (s.loading) return "Recherche...";
    return s.locality || "-";
  }

  function normalizeAdminLabel(v) {
    return String(v || "").trim();
  }

  function includesAbidjan(v) {
    return /abidjan/i.test(String(v || ""));
  }

  function isCoteDivoire(address = {}) {
    return String(address.country_code || "").toLowerCase() === "ci";
  }

  function pickBestCity(address = {}, payload = {}) {
    const displayName = String(payload?.display_name || "");
    const inAbidjanDistrict =
      includesAbidjan(address.state) ||
      includesAbidjan(address.region) ||
      includesAbidjan(address.county) ||
      includesAbidjan(address.state_district) ||
      includesAbidjan(displayName);
    if (isCoteDivoire(address) && inAbidjanDistrict) return "Abidjan";
    return (
      normalizeAdminLabel(address.city) ||
      normalizeAdminLabel(address.town) ||
      normalizeAdminLabel(address.municipality) ||
      normalizeAdminLabel(address.state_district) ||
      normalizeAdminLabel(address.village) ||
      normalizeAdminLabel(address.suburb) ||
      normalizeAdminLabel(address.county) ||
      normalizeAdminLabel(address.state) ||
      ""
    );
  }

  function pickBestLocality(address = {}) {
    return (
      normalizeAdminLabel(address.city_district) ||
      normalizeAdminLabel(address.suburb) ||
      normalizeAdminLabel(address.neighbourhood) ||
      normalizeAdminLabel(address.residential) ||
      normalizeAdminLabel(address.allotments) ||
      normalizeAdminLabel(address.block) ||
      normalizeAdminLabel(address.road) ||
      normalizeAdminLabel(address.village) ||
      normalizeAdminLabel(address.hamlet) ||
      normalizeAdminLabel(address.quarter) ||
      normalizeAdminLabel(address.city) ||
      ""
    );
  }

  async function reverseGeocodeEmergency(lat, lon) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(
        String(lat)
      )}&lon=${encodeURIComponent(String(lon))}`
    );
    if (!res.ok) throw new Error(`Geocodage inverse impossible (${res.status})`);
    const payload = await res.json();
    const address = payload?.address || {};
    const displayName = String(payload?.display_name || "").trim();
    const road = String(address.road || address.pedestrian || address.footway || "").trim();
    const amenity = String(address.amenity || address.tourism || address.shop || "").trim();
    const placeName = amenity || road || displayName.split(",")[0] || "";
    return {
      placeName,
      country: String(address.country || "").trim(),
      city: String(pickBestCity(address, payload) || "").trim(),
      locality: String(pickBestLocality(address) || "").trim(),
    };
  }

  async function hydrateEmergencyGeoDetails() {
    const seen = new Set();
    const unique = [];
    for (const item of emergencyAlerts.value.slice(0, 80)) {
      const key = emergencyGeoKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    for (const item of unique) {
      const key = emergencyGeoKey(item);
      if (!key) continue;
      if (emergencyGeoCache.has(key)) {
        emergencyGeoDetails[key] = emergencyGeoCache.get(key);
        continue;
      }
      if (emergencyGeoDetails[key]?.loading) continue;
      emergencyGeoDetails[key] = { placeName: "", country: "", city: "", locality: "", loading: true };
      try {
        const details = await reverseGeocodeEmergency(item.latitude, item.longitude);
        const resolved = { ...details, loading: false };
        emergencyGeoCache.set(key, resolved);
        emergencyGeoDetails[key] = resolved;
      } catch {
        emergencyGeoDetails[key] = { placeName: "", country: "", city: "", locality: "", loading: false };
      }
    }
  }

  function buildEmergencyMapEmbedUrl(latitude, longitude) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
    const delta = 0.01;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${lon - delta}%2C${lat - delta}%2C${lon + delta}%2C${lat + delta}&layer=mapnik&marker=${lat}%2C${lon}`;
  }

  function getEmergencyStatusClass(status) {
    if (status === "NEW") return "is-new";
    if (["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(status)) return "is-progress";
    if (status === "COMPLETED") return "is-completed";
    if (status === "CLOSED") return "is-rejected";
    return "is-default";
  }

  function getEmergencyAlertCardClass(status) {
    if (status === "NEW") return "emergency-card-new";
    if (["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE"].includes(status)) return "emergency-card-progress";
    if (status === "COMPLETED") return "emergency-card-completed";
    if (status === "CLOSED") return "emergency-card-rejected";
    return "";
  }

  // ─── Parse helpers ───────────────────────────────────────────────────────────
  function parseServicesCsv(csv) {
    if (typeof csv !== "string") return [];
    return csv.split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
  }

  function createEmptyServiceRow() {
    return { name: "", description: "", bedsAvailable: 0, bedsOccupied: 0, bedsOutOfService: 0 };
  }

  function servicesFromCenter(center) {
    return Array.isArray(center?.services)
      ? center.services.map((s) => ({
          name: s.name || "",
          description: s.description || "",
          bedsAvailable: Number(s.bedsAvailable) || 0,
          bedsOccupied: Number(s.bedsOccupied) || 0,
          bedsOutOfService: Number(s.bedsOutOfService) || 0,
        }))
      : [];
  }

  function servicesToPayload(services) {
    return (Array.isArray(services) ? services : [])
      .filter((s) => String(s.name || "").trim())
      .map((s) => ({
        name: String(s.name || "").trim(),
        description: String(s.description || "").trim() || null,
        bedsAvailable: Number(s.bedsAvailable) || 0,
        bedsOccupied: Number(s.bedsOccupied) || 0,
        bedsOutOfService: Number(s.bedsOutOfService) || 0,
      }));
  }

  function parseCsvLine(line, delimiter) {
    const cells = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = "";
        continue;
      }

      current += char;
    }

    cells.push(current.trim());
    return cells;
  }

  function detectCsvDelimiter(headerLine) {
    const commaCount = (headerLine.match(/,/g) || []).length;
    const semicolonCount = (headerLine.match(/;/g) || []).length;
    return semicolonCount > commaCount ? ";" : ",";
  }

  function parseNumeric(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const n = Number(value.replace(",", ".").trim());
    return Number.isFinite(n) ? n : null;
  }

  function normalizeGeoCode(value) {
    return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  }

  function normalizeImportType(value) {
    const s = String(value || "").trim().toUpperCase();
    if (!s) return "PUBLIQUE";
    if (s === "CONFESSIONNEL") return "CONFESSIONNEL";
    if (s === "PRIVE") return "PRIVE";
    if (s === "PUBLIC" || s === "PUBLIQUE") return "PUBLIQUE";
    if (s === "ONG" || s === "COMMUNAUTAIRE") return "PUBLIQUE";
    return "PUBLIQUE";
  }

  function normalizeImportLevel(value) {
    const s = String(value || "").trim().toUpperCase();
    if (!s) return "CENTRE_SANTE";
    if (s === "CHU") return "CHU";
    if (s === "CHR") return "CHR";
    if (s === "CH") return "CH";
    if (s === "CHS") return "CHS";
    if (s === "HG") return "CH";
    if (s === "ESPC" || s.includes("PREMIER CONTACT")) return "ESPC";
    if (s === "CENTRE_SANTE" || s === "CENTRE DE SANTE" || s === "CENTRES DE SANTE") return "CENTRE_SANTE";
    if (s === "CLCC" || s.includes("LUTTE CONTRE LE CANCER")) return "CLCC";
    if (s === "SSR" || s.includes("READAPTATION")) return "SSR";
    if (s.includes("EHPAD") || s.includes("USLD")) return "EHPAD_USLD";
    if (s.includes("RADIOTHERAPIE")) return "CENTRE_RADIOTHERAPIE";
    if (s.includes("CARDIOLOGIE")) return "CENTRE_CARDIOLOGIE";
    if (s === "POLYCLINIQUE") return "POLYCLINIQUE";
    if (s === "INFIRMERIE") return "INFIRMERIE";
    if (
      ["CLINIQUE", "CABINET DENTAIRE", "CABINET OPTIQUE",
       "CABINET MEDICAL", "LABORATOIRE", "INSTITUT SPECIALISE"].includes(s)
    ) return "CLINIQUE";
    return "CENTRE_SANTE";
  }

  function getAny(row, keys) {
    for (const key of keys) {
      if (row[key] != null && String(row[key]).trim() !== "") return row[key];
    }
    return "";
  }

  function mapExcelRow(row) {
    const name = String(getAny(row, ["name", "Name", "nom", "Nom"])).trim();
    const addressRaw = String(getAny(row, ["address", "Address", "adresse", "Adresse"])).trim();
    const address = addressRaw || "Adresse non renseignee";
    const technicalPlatformRaw = String(
      getAny(row, ["technicalPlatform", "TechnicalPlatform", "plateau", "plateauTechnique"])
    ).trim();
    const technicalPlatform = technicalPlatformRaw || "Non renseigne";
    const latitude = parseNumeric(getAny(row, ["latitude", "Latitude", "lat", "Lat"]));
    const longitude = parseNumeric(getAny(row, ["longitude", "Longitude", "lon", "lng", "Long"]));
    const level = normalizeImportLevel(getAny(row, ["level", "Level", "niveau", "Niveau"]));
    const establishmentType = normalizeImportType(getAny(row, ["establishmentType", "type", "Type"]));
    const establishmentCode = String(getAny(row, ["establishmentCode", "codeEtablissement", "code", "Code"])).trim();
    const regionCode = normalizeGeoCode(getAny(row, ["regionCode", "region", "region_code", "Region"]));
    const districtCode = normalizeGeoCode(getAny(row, ["districtCode", "district", "district_code", "District"]));
    const services = parseServicesCsv(String(getAny(row, ["services", "Services"])));
    if (!name || latitude == null || longitude == null) return null;
    return {
      name, address, technicalPlatform, latitude, longitude, level, establishmentType,
      ...(regionCode ? { regionCode } : {}),
      ...(districtCode ? { districtCode } : {}),
      ...(establishmentCode ? { establishmentCode } : {}),
      services,
    };
  }

  function mapRegionExcelRow(row) {
    const code = normalizeGeoCode(getAny(row, ["code", "Code", "regionCode", "region_code"]));
    const name = String(getAny(row, ["name", "Name", "regionName", "region_name"])).trim();
    if (!code || !name) return null;
    return { code, name };
  }

  function mapDistrictExcelRow(row) {
    const code = normalizeGeoCode(getAny(row, ["code", "Code", "districtCode", "district_code"]));
    const name = String(getAny(row, ["name", "Name", "districtName", "district_name"])).trim();
    const regionCode = normalizeGeoCode(getAny(row, ["regionCode", "region_code", "region", "Region"]));
    if (!code || !name || !regionCode) return null;
    return { code, name, regionCode };
  }

  async function readFileRows(file) {
    const ext = String(file?.name || "").toLowerCase();
    if (ext.endsWith(".csv")) {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return [];
      const delimiter = detectCsvDelimiter(lines[0]);
      const headers = parseCsvLine(lines[0], delimiter);
      return lines.slice(1).map((line) => {
        const values = parseCsvLine(line, delimiter);
        const row = {};
        headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
        return row;
      });
    }
    if (!XLSXModule) XLSXModule = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const wb = XLSXModule.read(buffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    return XLSXModule.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  }

  // ─── API actions ─────────────────────────────────────────────────────────────
  async function fetchAllCenters() {
    centersAdminError.value = "";
    centersAdminLoading.value = true;
    try {
      const endpoint = isRegulator.value ? "/centers?includeInactive=1" : "/centers";
      try {
        allCenters.value = await apiFetch(endpoint, { token: auth.state.token });
      } catch (firstErr) {
        if (!isRegulator.value) throw firstErr;
        allCenters.value = await apiFetch("/centers", { token: auth.state.token });
      }
      loadChefCenterFromList();
    } catch (err) {
      error.value = err.message;
      centersAdminError.value = err.message;
      allCenters.value = [];
    } finally {
      centersAdminLoading.value = false;
    }
  }

  async function fetchNearby({ expandIfEmpty = true } = {}) {
    if (!coords.value) {
      error.value = "Position indisponible. Cliquez sur 'Utiliser ma position actuelle'.";
      info.value = "";
      nearbyCenters.value = [];
      return;
    }
    error.value = "";
    info.value = "";
    try {
      const baseRadius = Number(radiusKm.value) || 20;
      if (!Number.isFinite(baseRadius) || baseRadius < 1 || baseRadius > 700) {
        throw new Error("Rayon de recherche trop grand. Entrez une valeur comprise entre 1 et 700 km.");
      }
      nearbyCenters.value = await apiFetch(
        `/centers/nearby?latitude=${coords.value.lat}&longitude=${coords.value.lon}&radiusKm=${baseRadius}`,
        { token: auth.state.token }
      );
      if (expandIfEmpty && nearbyCenters.value.length === 0) {
        for (const r of [50, 100, 200, 500, 700]) {
          if (r <= baseRadius) continue;
          const widened = await apiFetch(
            `/centers/nearby?latitude=${coords.value.lat}&longitude=${coords.value.lon}&radiusKm=${r}`,
            { token: auth.state.token }
          );
          if (Array.isArray(widened) && widened.length > 0) {
            nearbyCenters.value = widened;
            info.value = `Aucun centre dans ${baseRadius} km. Resultats elargis a ${r} km.`;
            break;
          }
        }
      }
      if (nearbyCenters.value.length === 0)
        info.value = `Aucun centre trouve dans ${baseRadius} km.`;
      if (!selectedCenter.value || !nearbyCenters.value.some((c) => c._id === selectedCenter.value._id))
        selectedCenter.value = null;
    } catch (err) {
      error.value = err.message;
      info.value = "";
      nearbyCenters.value = [];
    }
  }

  async function refreshCurrentPosition() {
    error.value = "";
    info.value = "";
    try {
      coords.value = await getCurrentPositionDetailed();
      await fetchNearby({ expandIfEmpty: true });
    } catch (err) {
      error.value = err.message;
      nearbyCenters.value = [];
    }
    return coords.value;
  }

  async function fetchEmergencyAlerts() {
    emergencyAlertsError.value = "";
    emergencyAlertsSuccess.value = "";
    try {
      const params = new URLSearchParams();
      if (emergencyPeriodFrom.value) params.set("dateFrom", emergencyPeriodFrom.value);
      if (emergencyPeriodTo.value) params.set("dateTo", emergencyPeriodTo.value);
      const q = params.toString() ? `?${params.toString()}` : "";
      emergencyAlerts.value = await apiFetch(`/emergency-reports${q}`, { token: auth.state.token });
      await hydrateEmergencyGeoDetails();
    } catch (err) {
      emergencyAlertsError.value = err.message;
    }
  }

  function startEmergencyAutoRefresh() {
    if (emergencyRefreshTimer || !isEmergencyResponder.value) return;
    emergencyRefreshTimer = setInterval(() => {
      fetchEmergencyAlerts().catch(() => {});
    }, 15000);
  }

  function stopEmergencyAutoRefresh() {
    if (!emergencyRefreshTimer) return;
    clearInterval(emergencyRefreshTimer);
    emergencyRefreshTimer = null;
  }

  async function openUnhandledEmergencyAlerts() {
    emergencyCategory.value = "UNHANDLED";
    tab.value = "emergency-alerts";
    await fetchEmergencyAlerts();
  }

  async function takeEmergencyInCharge(item) {
    emergencyAlertsError.value = "";
    emergencyAlertsSuccess.value = "";
    try {
      let position = null;
      try { position = await getCurrentPositionDetailed(); } catch { position = null; }
      await apiFetch(`/emergency-reports/${item.id}/acknowledge`, {
        token: auth.state.token,
        method: "POST",
        body: { ...(position ? { teamLatitude: position.lat, teamLongitude: position.lon } : {}) },
      });
      emergencyAlertsSuccess.value = "Alerte prise en compte";
      await fetchEmergencyAlerts();
    } catch (err) {
      emergencyAlertsError.value = err.message;
    }
  }

  async function setEmergencyProgress(item, status) {
    emergencyAlertsError.value = "";
    emergencyAlertsSuccess.value = "";
    try {
      const note = String(emergencyStepNotes[item.id] || "").trim();
      let position = null;
      try { position = await getCurrentPositionDetailed(); } catch { position = null; }
      await apiFetch(`/emergency-reports/${item.id}/progress`, {
        token: auth.state.token,
        method: "PATCH",
        body: {
          status,
          ...(note ? { teamNote: note } : {}),
          ...(position ? { teamLatitude: position.lat, teamLongitude: position.lon } : {}),
        },
      });
      emergencyAlertsSuccess.value = `Statut mis a jour: ${formatEmergencyStatus(status)}`;
      await fetchEmergencyAlerts();
    } catch (err) {
      emergencyAlertsError.value = err.message;
    }
  }

  function navigateToEmergency(item) {
    const lat = Number(item?.latitude);
    const lon = Number(item?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      emergencyAlertsError.value = "Coordonnees invalides pour cette alerte.";
      return;
    }
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, "_blank");
  }

  async function fetchComplaints() {
    complaintAdminError.value = "";
    try {
      const q = complaintStatusFilter.value ? `?status=${complaintStatusFilter.value}` : "";
      complaintsList.value = await apiFetch(`/complaints${q}`, { token: auth.state.token });
    } catch (err) {
      complaintAdminError.value = err.message;
    }
  }

  async function fetchComplaintSummary() {
    complaintAdminError.value = "";
    try {
      complaintSummary.value = await apiFetch("/complaints/summary", { token: auth.state.token });
    } catch (err) {
      complaintAdminError.value = err.message;
    }
  }

  async function setComplaintStatus(item, status) {
    complaintAdminError.value = "";
    complaintSuccess.value = "";
    try {
      const note = String(complaintStepNotes[item.id] || "").trim();
      await apiFetch(`/complaints/${item.id}/status`, {
        token: auth.state.token,
        method: "PATCH",
        body: { status, ...(note ? { message: note } : {}) },
      });
      complaintStepNotes[item.id] = "";
      complaintSuccess.value =
        status === "IN_PROGRESS"
          ? "Plainte prise en compte"
          : status === "RESOLVED"
          ? "Plainte marquee resolue"
          : "Plainte rejetee";
      await fetchComplaints();
    } catch (err) {
      complaintAdminError.value = err.message;
    }
  }

  async function addComplaintExplanation(item) {
    complaintAdminError.value = "";
    complaintSuccess.value = "";
    try {
      const note = String(complaintStepNotes[item.id] || "").trim();
      if (!note) {
        complaintAdminError.value = "Saisis une explication avant de valider.";
        return;
      }
      await apiFetch(`/complaints/${item.id}/explanation`, {
        token: auth.state.token,
        method: "POST",
        body: { message: note },
      });
      complaintStepNotes[item.id] = "";
      complaintSuccess.value = "Explication enregistree";
      await fetchComplaints();
    } catch (err) {
      complaintAdminError.value = err.message;
    }
  }

  async function fetchSuggestions() {
    suggestionError.value = "";
    try {
      suggestionsList.value = await apiFetch("/suggestions", { token: auth.state.token });
    } catch (err) {
      suggestionError.value = err.message;
    }
  }

  async function fetchSuggestionSummary() {
    suggestionError.value = "";
    try {
      suggestionSummary.value = await apiFetch("/suggestions/summary", { token: auth.state.token });
    } catch (err) {
      suggestionError.value = err.message;
    }
  }

  async function markSuggestionRead(item) {
    suggestionError.value = "";
    suggestionSuccess.value = "";
    suggestionActionLoadingId.value = String(item.id);
    try {
      await apiFetch(`/suggestions/${item.id}/read`, {
        token: auth.state.token,
        method: "PATCH",
      });
      suggestionSuccess.value = "Observation marquee comme lue";
      await Promise.all([fetchSuggestions(), fetchSuggestionSummary()]);
    } catch (err) {
      suggestionError.value = err.message;
    } finally {
      suggestionActionLoadingId.value = "";
    }
  }

  function startSuggestionAutoRefresh() {
    if (suggestionRefreshTimer || !canSeeComplaintsPanel.value) return;
    suggestionRefreshTimer = setInterval(() => {
      fetchSuggestions().catch(() => {});
      fetchSuggestionSummary().catch(() => {});
    }, 15000);
  }

  function stopSuggestionAutoRefresh() {
    if (!suggestionRefreshTimer) return;
    clearInterval(suggestionRefreshTimer);
    suggestionRefreshTimer = null;
  }

  async function fetchAppSettings() {
    appSettingsError.value = "";
    try {
      appSettings.value = await apiFetch("/settings", { token: auth.state.token });
    } catch (err) {
      appSettingsError.value = err.message;
    }
  }

  async function updateAppSetting(key, value) {
    appSettingsError.value = "";
    appSettingsSuccess.value = "";
    appSettingsLoading.value = true;
    try {
      await apiFetch(`/settings/${key}`, {
        token: auth.state.token,
        method: "PATCH",
        body: { value },
      });
      appSettings.value = { ...appSettings.value, [key]: value };
      appSettingsSuccess.value = "Reglage mis a jour";
    } catch (err) {
      appSettingsError.value = err.message;
    } finally {
      appSettingsLoading.value = false;
    }
  }

  async function fetchModuleSettings(appKey = moduleSettingsApp.value) {
    moduleSettingsError.value = "";
    try {
      const data = await apiFetch(`/settings/modules?appKey=${encodeURIComponent(appKey)}`, { token: auth.state.token });
      moduleDefinitions.value = data.modules || [];
      roleDefinitions.value = data.roles || [];
      appDefinitions.value = data.apps || [];
      moduleSettingsApp.value = data.appKey || appKey;
      moduleSettingsMatrix.value = data.matrix || {};
    } catch (err) {
      moduleSettingsError.value = err.message;
    }
  }

  async function setModuleSettingsApp(appKey) {
    moduleSettingsApp.value = appKey;
    await fetchModuleSettings(appKey);
  }

  async function updateModuleSetting(moduleKey, role, enabled) {
    moduleSettingsError.value = "";
    moduleSettingsLoading.value = true;
    try {
      await apiFetch("/settings/modules", {
        token: auth.state.token,
        method: "PATCH",
        body: { moduleKey, role, enabled, appKey: moduleSettingsApp.value },
      });
      if (!moduleSettingsMatrix.value[moduleKey]) moduleSettingsMatrix.value[moduleKey] = {};
      moduleSettingsMatrix.value[moduleKey][role] = enabled;
    } catch (err) {
      moduleSettingsError.value = err.message;
    } finally {
      moduleSettingsLoading.value = false;
    }
  }

  // Chef center
  function loadChefCenterFromList() {
    if (!isChef.value) return;
    const center = allCenters.value[0];
    if (!center) return;
    myCenterId.value = center._id;
    chefForm.name = center.name || "";
    chefForm.address = center.address || "";
    chefForm.establishmentCode = center.establishmentCode || "";
    chefForm.level = center.level || "CENTRE_SANTE";
    chefForm.establishmentType = center.establishmentType || "PUBLIQUE";
    chefForm.regionCode = center.regionCode || "";
    chefForm.districtCode = center.districtCode || "";
    chefForm.technicalPlatform = center.technicalPlatform || "";
    chefForm.services = servicesFromCenter(center);
    chefForm.latitude = Number(center.location?.coordinates?.[1]) || "";
    chefForm.longitude = Number(center.location?.coordinates?.[0]) || "";
  }

  const claimCodeInput = ref("");
  const claimLoading = ref(false);
  const claimError = ref("");
  const claimNotFound = ref(false);

  async function claimCenterByCode() {
    const code = String(claimCodeInput.value || "").trim();
    if (!code) {
      claimError.value = "Entrez le code de votre etablissement";
      return;
    }
    claimLoading.value = true;
    claimError.value = "";
    claimNotFound.value = false;
    try {
      await apiFetch("/centers/claim-by-code", { token: auth.state.token, method: "POST", body: { code } });
      await fetchAllCenters();
    } catch (err) {
      if (err.status === 404) {
        claimNotFound.value = true;
      } else {
        claimError.value = err.message;
      }
    } finally {
      claimLoading.value = false;
    }
  }

  function createWithClaimCode() {
    chefForm.establishmentCode = String(claimCodeInput.value || "").trim();
  }

  const serviceActionLoadingName = ref("");
  const serviceError = ref("");

  async function adjustServiceBeds(serviceName, adjust) {
    if (!myCenterId.value) return;
    serviceError.value = "";
    serviceActionLoadingName.value = serviceName;
    try {
      await apiFetch(`/centers/${myCenterId.value}/services/${encodeURIComponent(serviceName)}`, {
        token: auth.state.token,
        method: "PATCH",
        body: { adjust },
      });
      await fetchAllCenters();
    } catch (err) {
      serviceError.value = err.message;
    } finally {
      serviceActionLoadingName.value = "";
    }
  }

  async function updateServiceDetails(serviceName, fields) {
    if (!myCenterId.value) return;
    serviceError.value = "";
    serviceActionLoadingName.value = serviceName;
    try {
      await apiFetch(`/centers/${myCenterId.value}/services/${encodeURIComponent(serviceName)}`, {
        token: auth.state.token,
        method: "PATCH",
        body: fields,
      });
      await fetchAllCenters();
    } catch (err) {
      serviceError.value = err.message;
    } finally {
      serviceActionLoadingName.value = "";
    }
  }

  function onChefRegionChange() {
    chefForm.districtCode = "";
  }

  function addChefServiceRow() {
    chefForm.services.push(createEmptyServiceRow());
  }

  function removeChefServiceRow(index) {
    chefForm.services.splice(index, 1);
  }

  function setCurrentPosition() {
    chefError.value = "";
    if (!navigator.geolocation) {
      chefError.value = "Geolocalisation non supportee";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        chefForm.latitude = Number(pos.coords.latitude);
        chefForm.longitude = Number(pos.coords.longitude);
      },
      () => { chefError.value = "Impossible de recuperer votre position"; }
    );
  }

  async function saveMyCenter() {
    chefError.value = "";
    chefSuccess.value = "";
    try {
      const body = {
        name: chefForm.name,
        address: chefForm.address,
        establishmentCode: chefForm.establishmentCode || null,
        level: chefForm.level,
        establishmentType: chefForm.establishmentType,
        regionCode: String(chefForm.regionCode || "").trim().toUpperCase(),
        districtCode: String(chefForm.districtCode || "").trim().toUpperCase() || null,
        technicalPlatform: chefForm.technicalPlatform,
        latitude: Number(chefForm.latitude),
        longitude: Number(chefForm.longitude),
        services: servicesToPayload(chefForm.services),
      };
      if (myCenterId.value) {
        await apiFetch(`/centers/${myCenterId.value}`, { token: auth.state.token, method: "PUT", body });
        chefSuccess.value = "Centre mis a jour et envoye en validation";
      } else {
        const created = await apiFetch("/centers", { token: auth.state.token, method: "POST", body });
        myCenterId.value = created._id;
        chefSuccess.value = "Centre cree et envoye en validation";
      }
      await fetchAllCenters();
      await fetchNearby();
    } catch (err) {
      chefError.value = err.message;
    }
  }

  // Regulator center
  function resetRegulatorCenterForm() {
    regulatorCenterForm.name = "";
    regulatorCenterForm.address = "";
    regulatorCenterForm.establishmentCode = "";
    regulatorCenterForm.level = "CENTRE_SANTE";
    regulatorCenterForm.establishmentType = "PUBLIQUE";
    regulatorCenterForm.regionCode = "";
    regulatorCenterForm.districtCode = "";
    regulatorCenterForm.technicalPlatform = "";
    regulatorCenterForm.services = [];
    regulatorCenterForm.latitude = "";
    regulatorCenterForm.longitude = "";
  }

  function addRegulatorServiceRow() {
    regulatorCenterForm.services.push(createEmptyServiceRow());
  }

  function removeRegulatorServiceRow(index) {
    regulatorCenterForm.services.splice(index, 1);
  }

  async function setRegulatorCurrentPosition() {
    regulatorCenterError.value = "";
    try {
      const pos = await getCurrentPositionDetailed();
      regulatorCenterForm.latitude = Number(pos.lat);
      regulatorCenterForm.longitude = Number(pos.lon);
    } catch (err) {
      regulatorCenterError.value = err.message;
    }
  }

  async function createCenterByRegulator() {
    regulatorCenterError.value = "";
    regulatorCenterSuccess.value = "";
    try {
      await apiFetch("/centers", {
        token: auth.state.token,
        method: "POST",
        body: {
          name: regulatorCenterForm.name,
          address: regulatorCenterForm.address,
          establishmentCode: regulatorCenterForm.establishmentCode || null,
          level: regulatorCenterForm.level,
          establishmentType: regulatorCenterForm.establishmentType,
          regionCode: normalizeGeoCode(regulatorCenterForm.regionCode),
          districtCode: normalizeGeoCode(regulatorCenterForm.districtCode) || null,
          technicalPlatform: regulatorCenterForm.technicalPlatform,
          latitude: Number(regulatorCenterForm.latitude),
          longitude: Number(regulatorCenterForm.longitude),
          services: servicesToPayload(regulatorCenterForm.services),
        },
      });
      regulatorCenterSuccess.value = "Centre cree et envoye en validation";
      resetRegulatorCenterForm();
      await fetchAllCenters();
      await fetchPendingCenters();
    } catch (err) {
      regulatorCenterError.value = err.message;
    }
  }

  function onRegulatorRegionChange() {
    regulatorCenterForm.districtCode = "";
  }

  // Centers admin
  function toggleCenterAdminDetails(center) {
    const id = String(center?._id || "");
    expandedCenterAdminId.value = expandedCenterAdminId.value === id ? "" : id;
  }

  function startEditCenterByRegulator(center) {
    expandedCenterAdminId.value = String(center._id);
    editingCenterAdminId.value = String(center._id);
    centerAdminForm.name = center.name || "";
    centerAdminForm.address = center.address || "";
    centerAdminForm.establishmentCode = center.establishmentCode || "";
    centerAdminForm.level = center.level || "CENTRE_SANTE";
    centerAdminForm.establishmentType = center.establishmentType || "PUBLIQUE";
    centerAdminForm.regionCode = center.regionCode || "";
    centerAdminForm.districtCode = center.districtCode || "";
    centerAdminForm.technicalPlatform = center.technicalPlatform || "";
    centerAdminForm.services = servicesFromCenter(center);
    centerAdminForm.latitude = Number(center.location?.coordinates?.[1]) || "";
    centerAdminForm.longitude = Number(center.location?.coordinates?.[0]) || "";
    centersAdminError.value = "";
    centersAdminSuccess.value = "";
  }

  function addCenterAdminServiceRow() {
    centerAdminForm.services.push(createEmptyServiceRow());
  }

  function removeCenterAdminServiceRow(index) {
    centerAdminForm.services.splice(index, 1);
  }

  function cancelEditCenterByRegulator() {
    editingCenterAdminId.value = "";
  }

  async function saveCenterByRegulator() {
    if (!editingCenterAdminId.value) return;
    centersAdminError.value = "";
    centersAdminSuccess.value = "";
    centersAdminActionLoading.value = true;
    try {
      await apiFetch(`/centers/${editingCenterAdminId.value}/admin`, {
        token: auth.state.token,
        method: "PUT",
        body: {
          name: centerAdminForm.name,
          address: centerAdminForm.address,
          establishmentCode: centerAdminForm.establishmentCode || null,
          level: centerAdminForm.level,
          establishmentType: centerAdminForm.establishmentType,
          regionCode: normalizeGeoCode(centerAdminForm.regionCode),
          districtCode: normalizeGeoCode(centerAdminForm.districtCode) || null,
          technicalPlatform: centerAdminForm.technicalPlatform,
          latitude: Number(centerAdminForm.latitude),
          longitude: Number(centerAdminForm.longitude),
          services: servicesToPayload(centerAdminForm.services),
        },
      });
      centersAdminSuccess.value = "Centre mis a jour";
      editingCenterAdminId.value = "";
      await fetchAllCenters();
      await fetchPendingCenters();
    } catch (err) {
      centersAdminError.value = err.message;
    } finally {
      centersAdminActionLoading.value = false;
    }
  }

  async function toggleCenterActiveByRegulator(center) {
    centersAdminError.value = "";
    centersAdminSuccess.value = "";
    centersAdminActionLoading.value = true;
    try {
      const nextIsActive = center?.isActive === false;
      await apiFetch(`/centers/${center._id}/active`, {
        token: auth.state.token,
        method: "PATCH",
        body: { isActive: nextIsActive },
      });
      centersAdminSuccess.value = nextIsActive ? "Centre active" : "Centre desactive";
      await fetchAllCenters();
    } catch (err) {
      centersAdminError.value = err.message;
    } finally {
      centersAdminActionLoading.value = false;
    }
  }

  async function deleteCenterByRegulator(center) {
    const ok = window.confirm(`Supprimer le centre "${center?.name || ""}" ?`);
    if (!ok) return;
    centersAdminError.value = "";
    centersAdminSuccess.value = "";
    centersAdminActionLoading.value = true;
    try {
      await apiFetch(`/centers/${center._id}`, { token: auth.state.token, method: "DELETE" });
      centersAdminSuccess.value = "Centre supprime";
      if (editingCenterAdminId.value === String(center._id)) editingCenterAdminId.value = "";
      await fetchAllCenters();
      await fetchPendingCenters();
    } catch (err) {
      centersAdminError.value = err.message;
    } finally {
      centersAdminActionLoading.value = false;
    }
  }

  // Geo
  async function fetchRegions() {
    geoError.value = "";
    try {
      regions.value = await apiFetch("/geo/regions", { token: auth.state.token });
    } catch (err) {
      geoError.value = err.message;
    }
  }

  async function fetchDistricts() {
    geoError.value = "";
    try {
      districts.value = await apiFetch("/geo/districts", { token: auth.state.token });
    } catch (err) {
      geoError.value = err.message;
    }
  }

  async function createRegion() {
    geoError.value = "";
    geoSuccess.value = "";
    try {
      await apiFetch("/geo/regions", {
        token: auth.state.token,
        method: "POST",
        body: { code: normalizeGeoCode(regionForm.code), name: String(regionForm.name || "").trim() },
      });
      geoSuccess.value = "Region creee";
      regionForm.code = "";
      regionForm.name = "";
      await fetchRegions();
    } catch (err) {
      geoError.value = err.message;
    }
  }

  async function createDistrict() {
    geoError.value = "";
    geoSuccess.value = "";
    try {
      await apiFetch("/geo/districts", {
        token: auth.state.token,
        method: "POST",
        body: {
          code: normalizeGeoCode(districtForm.code),
          name: String(districtForm.name || "").trim(),
          regionCode: normalizeGeoCode(districtForm.regionCode),
        },
      });
      geoSuccess.value = "District cree";
      districtForm.code = "";
      districtForm.name = "";
      await fetchDistricts();
      await fetchRegions();
    } catch (err) {
      geoError.value = err.message;
    }
  }

  // Users
  async function fetchUsers() {
    usersError.value = "";
    try {
      users.value = await apiFetch("/users", { token: auth.state.token });
    } catch (err) {
      usersError.value = err.message;
    }
  }

  async function reviewChef(id, action) {
    usersError.value = "";
    usersSuccess.value = "";
    try {
      await apiFetch(`/users/${id}/review`, {
        token: auth.state.token,
        method: "POST",
        body: { action },
      });
      usersSuccess.value = action === "APPROVE" ? "Chef approuve" : "Chef rejete";
      await fetchUsers();
    } catch (err) {
      usersError.value = err.message;
    }
  }

  async function fetchPendingCenters() {
    usersError.value = "";
    try {
      pendingCenters.value = await apiFetch("/centers/pending", { token: auth.state.token });
    } catch (err) {
      usersError.value = err.message;
    }
  }

  async function reviewCenter(id, action) {
    usersError.value = "";
    usersSuccess.value = "";
    try {
      await apiFetch(`/centers/${id}/review`, {
        token: auth.state.token,
        method: "POST",
        body: { action },
      });
      usersSuccess.value = action === "APPROVE" ? "Centre approuve" : "Centre rejete";
      await fetchPendingCenters();
      await fetchAllCenters();
      await fetchNearby();
    } catch (err) {
      usersError.value = err.message;
    }
  }

  async function approveAllPendingCenters() {
    usersError.value = "";
    usersSuccess.value = "";
    try {
      for (const center of filteredPendingCenters.value) {
        await apiFetch(`/centers/${center._id}/review`, {
          token: auth.state.token,
          method: "POST",
          body: { action: "APPROVE" },
        });
      }
      usersSuccess.value = "Tous les centres filtres ont ete approuves";
      await fetchPendingCenters();
      await fetchAllCenters();
      await fetchNearby();
    } catch (err) {
      usersError.value = err.message;
    }
  }

  async function deleteAllCenters() {
    deleteCentersError.value = "";
    deleteCentersSuccess.value = "";
    if (deleteCentersConfirm.value !== "DELETE_ALL_CENTERS") {
      deleteCentersError.value = "Confirmation invalide. Tapez exactement DELETE_ALL_CENTERS";
      return;
    }
    deleteCentersLoading.value = true;
    try {
      const result = await apiFetch("/centers/all", {
        token: auth.state.token,
        method: "DELETE",
        body: { confirm: deleteCentersConfirm.value },
      });
      deleteCentersSuccess.value = `${Number(result?.deletedCount || 0)} centre(s) supprime(s)`;
      deleteCentersConfirm.value = "";
      await fetchPendingCenters();
      await fetchAllCenters();
      if (!isChef.value) await fetchNearby();
    } catch (err) {
      deleteCentersError.value = err.message;
    } finally {
      deleteCentersLoading.value = false;
    }
  }

  async function createUser() {
    usersError.value = "";
    usersSuccess.value = "";
    try {
      const normalizedRoles = Array.from(new Set([userForm.primaryRole, ...userForm.roles]));
      const payload = {
        fullName: userForm.fullName,
        email: userForm.email,
        role: userForm.primaryRole,
        roles: normalizedRoles,
        establishmentCode: userForm.establishmentCode || null,
        regionCode: normalizeGeoCode(userForm.regionCode) || null,
        districtCode: normalizeGeoCode(userForm.districtCode) || null,
        centerId: userForm.centerId ? Number(userForm.centerId) : null,
      };
      if (userForm.password.trim()) payload.password = userForm.password;
      if (editingUserId.value) {
        await apiFetch(`/users/${editingUserId.value}`, {
          token: auth.state.token,
          method: "PATCH",
          body: payload,
        });
        usersSuccess.value = "Utilisateur mis a jour";
      } else {
        await apiFetch("/users", { token: auth.state.token, method: "POST", body: payload });
        usersSuccess.value = "Utilisateur cree";
      }
      resetUserForm();
      await fetchUsers();
    } catch (err) {
      usersError.value = err.message;
    }
  }

  function resetUserForm() {
    editingUserId.value = "";
    userForm.fullName = "";
    userForm.email = "";
    userForm.password = "";
    userForm.primaryRole = "USER";
    userForm.roles = ["USER"];
    userForm.establishmentCode = "";
    userForm.regionCode = "";
    userForm.districtCode = "";
    userForm.centerId = "";
  }

  function toggleUserRole(role) {
    const normalized = String(role || "").toUpperCase();
    if (userForm.roles.includes(normalized))
      userForm.roles = userForm.roles.filter((r) => r !== normalized);
    else
      userForm.roles = [...userForm.roles, normalized];
  }

  function startEditUser(user) {
    editingUserId.value = String(user.id);
    userForm.fullName = user.fullName || "";
    userForm.email = user.email || "";
    userForm.password = "";
    const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role || "USER"];
    userForm.primaryRole = roles[0];
    userForm.roles = [...new Set(roles)];
    userForm.establishmentCode = user.establishmentCode || "";
    userForm.regionCode = user.regionCode || "";
    userForm.districtCode = user.districtCode || "";
    userForm.centerId = user.centerId || "";
  }

  async function toggleUserActive(user) {
    usersError.value = "";
    usersSuccess.value = "";
    try {
      const nextIsActive = user.isActive === false;
      await apiFetch(`/users/${user.id}/active`, {
        token: auth.state.token,
        method: "PATCH",
        body: { isActive: nextIsActive },
      });
      usersSuccess.value = nextIsActive ? "Utilisateur active" : "Utilisateur desactive";
      await fetchUsers();
    } catch (err) {
      usersError.value = err.message;
    }
  }

  async function deleteUser(id) {
    usersError.value = "";
    usersSuccess.value = "";
    try {
      await apiFetch(`/users/${id}`, { token: auth.state.token, method: "DELETE" });
      usersSuccess.value = "Utilisateur supprime";
      await fetchUsers();
    } catch (err) {
      usersError.value = err.message;
    }
  }

  // Imports
  async function onRegionImportFileChange(event) {
    regionImportError.value = "";
    regionImportSuccess.value = "";
    parsedRegions.value = [];
    regionImportPreviewCount.value = 0;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readFileRows(file);
      parsedRegions.value = rows.map(mapRegionExcelRow).filter(Boolean);
      regionImportPreviewCount.value = parsedRegions.value.length;
      if (!parsedRegions.value.length) regionImportError.value = "Aucune ligne region valide detectee";
    } catch (err) {
      regionImportError.value = err.message || "Lecture fichier impossible";
    }
  }

  async function onDistrictImportFileChange(event) {
    districtImportError.value = "";
    districtImportSuccess.value = "";
    parsedDistricts.value = [];
    districtImportPreviewCount.value = 0;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readFileRows(file);
      parsedDistricts.value = rows.map(mapDistrictExcelRow).filter(Boolean);
      districtImportPreviewCount.value = parsedDistricts.value.length;
      if (!parsedDistricts.value.length) districtImportError.value = "Aucune ligne district valide detectee";
    } catch (err) {
      districtImportError.value = err.message || "Lecture fichier impossible";
    }
  }

  async function importRegionsFromFile() {
    regionImportError.value = "";
    regionImportSuccess.value = "";
    regionImportLoading.value = true;
    try {
      const result = await apiFetch("/geo/regions/import", {
        token: auth.state.token,
        method: "POST",
        body: { regions: parsedRegions.value },
      });
      regionImportSuccess.value = `${Number(result.importedCount || 0)} region(s) importee(s)`;
      parsedRegions.value = [];
      regionImportPreviewCount.value = 0;
      await fetchRegions();
    } catch (err) {
      const firstError = err?.data?.errors?.[0];
      regionImportError.value = firstError
        ? `${err.message} (ligne ${Number(firstError.index) + 1}: ${firstError.message})`
        : err.message;
    } finally {
      regionImportLoading.value = false;
    }
  }

  async function importDistrictsFromFile() {
    districtImportError.value = "";
    districtImportSuccess.value = "";
    districtImportLoading.value = true;
    try {
      const result = await apiFetch("/geo/districts/import", {
        token: auth.state.token,
        method: "POST",
        body: { districts: parsedDistricts.value },
      });
      districtImportSuccess.value = `${Number(result.importedCount || 0)} district(s) importe(s)`;
      parsedDistricts.value = [];
      districtImportPreviewCount.value = 0;
      await fetchDistricts();
      await fetchRegions();
    } catch (err) {
      const firstError = err?.data?.errors?.[0];
      districtImportError.value = firstError
        ? `${err.message} (ligne ${Number(firstError.index) + 1}: ${firstError.message})`
        : err.message;
    } finally {
      districtImportLoading.value = false;
    }
  }

  function escapeCsvCell(value) {
    const text = String(value ?? "");
    if (/[",;\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  async function downloadBackendCsv(path, filename) {
    const baseUrl = (import.meta.env.VITE_API_URL || "http://193.168.173.181:8081/api").replace(/\/+$/, "");
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${auth.state.token}`,
        },
      });
    } catch {
      throw new Error("Impossible de joindre l'API pour l'export.");
    }

    if (!response.ok) {
      let message = `Export impossible (${response.status})`;
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function isEspcCenter(center) {
    const level = String(center?.level || "").trim().toUpperCase();
    const name = String(center?.name || "").trim().toUpperCase();
    const technicalPlatform = String(center?.technicalPlatform || "").trim().toUpperCase();
    const establishmentCode = String(center?.establishmentCode || "").trim().toUpperCase();

    return (
      level === "ESPC" ||
      level === "CENTRE_SANTE" ||
      level === "CLINIQUE" ||
      level === "POLYCLINIQUE" ||
      level === "INFIRMERIE" ||
      name.includes("ESPC") ||
      name.includes("PREMIER CONTACT") ||
      technicalPlatform.includes("ESPC") ||
      technicalPlatform.includes("PREMIER CONTACT") ||
      establishmentCode.includes("ESPC")
    );
  }

  async function exportRegionsCsv() {
    geoError.value = "";
    geoSuccess.value = "";
    try {
      await downloadBackendCsv("/geo/regions/export", "regions_sante_aproximite.csv");
      geoSuccess.value = "Export des regions telecharge";
    } catch (err) {
      geoError.value = err.message || "Export des regions impossible";
    }
  }

  async function exportDistrictsCsv() {
    geoError.value = "";
    geoSuccess.value = "";
    try {
      await downloadBackendCsv("/geo/districts/export", "districts_sante_aproximite.csv");
      geoSuccess.value = "Export des districts telecharge";
    } catch (err) {
      geoError.value = err.message || "Export des districts impossible";
    }
  }

  async function exportEspcCsv() {
    geoError.value = "";
    geoSuccess.value = "";
    try {
      await downloadBackendCsv("/centers/export/espc", "espc_sante_aproximite.csv");
      geoSuccess.value = "Export des ESPC telecharge";
    } catch (err) {
      geoError.value = err.message || "Export des ESPC impossible";
    }
  }

  async function onImportFileChange(event) {
    importError.value = "";
    importSuccess.value = "";
    parsedCenters.value = [];
    importPreviewCount.value = 0;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readFileRows(file);
      if (!rows.length) { importError.value = "Fichier vide"; return; }
      parsedCenters.value = rows.map(mapExcelRow).filter(Boolean);
      importPreviewCount.value = parsedCenters.value.length;
      if (!parsedCenters.value.length) importError.value = "Aucune ligne valide detectee";
    } catch (err) {
      importError.value = err.message || "Lecture Excel impossible";
    }
  }

  async function importCentersFromFile() {
    importError.value = "";
    importSuccess.value = "";
    importLoading.value = true;
    try {
      const chunkSize = 300;
      let totalImported = 0;
      for (let i = 0; i < parsedCenters.value.length; i += chunkSize) {
        const chunk = parsedCenters.value.slice(i, i + chunkSize);
        const result = await apiFetch("/centers/import", {
          token: auth.state.token,
          method: "POST",
          body: { centers: chunk },
        });
        totalImported += Number(result.importedCount || 0);
      }
      importSuccess.value = `${totalImported} centre(s) importes`;
      parsedCenters.value = [];
      importPreviewCount.value = 0;
      await fetchAllCenters();
      await fetchNearby();
    } catch (err) {
      const firstError = err?.data?.errors?.[0];
      importError.value = firstError
        ? `${err.message} (ligne ${Number(firstError.index) + 1}: ${firstError.message})`
        : err.message;
    } finally {
      importLoading.value = false;
    }
  }

  // ─── Internal watchers ───────────────────────────────────────────────────────
  watch(
    () => centersAdminRegionFilter.value,
    () => { centersAdminDistrictFilter.value = ""; }
  );
  watch([filteredUsers, usersPageCount], () => {
    usersPage.value = Math.min(Math.max(1, usersPage.value), usersPageCount.value);
  });
  watch([filteredPendingCenters, pendingCentersPageCount], () => {
    pendingCentersPage.value = Math.min(Math.max(1, pendingCentersPage.value), pendingCentersPageCount.value);
  });
  watch([filteredCentersForAdmin, adminCentersPageCount], () => {
    adminCentersPage.value = Math.min(Math.max(1, adminCentersPage.value), adminCentersPageCount.value);
  });
  watch([complaintsList, complaintsPageCount], () => {
    complaintsPage.value = Math.min(Math.max(1, complaintsPage.value), complaintsPageCount.value);
  });
  watch([filteredEvaluationCenters, evaluationPageCount], () => {
    evaluationPage.value = Math.min(Math.max(1, evaluationPage.value), evaluationPageCount.value);
  });
  watch(
    () => userForm.regionCode,
    (value) => {
      const region = String(value || "").trim().toUpperCase();
      if (!region) { userForm.districtCode = ""; return; }
      if (!userForm.districtCode) return;
      const sel = districts.value.find(
        (d) => String(d.code || "").toUpperCase() === String(userForm.districtCode || "").toUpperCase()
      );
      if (!sel || String(sel.regionCode || "").toUpperCase() !== region) userForm.districtCode = "";
    }
  );
  watch(
    () => userForm.districtCode,
    (value) => {
      if (!value) return;
      const sel = districts.value.find(
        (d) => String(d.code || "").toUpperCase() === String(value || "").toUpperCase()
      );
      if (sel) userForm.regionCode = String(sel.regionCode || "").toUpperCase();
    }
  );
  watch(
    () => userForm.centerId,
    (value) => {
      if (!value) return;
      const sel = allCenters.value.find((c) => String(c._id) === String(value));
      if (!sel) return;
      if (sel.regionCode) userForm.regionCode = String(sel.regionCode || "").toUpperCase();
      if (sel.districtCode) userForm.districtCode = String(sel.districtCode || "").toUpperCase();
      if (sel.establishmentCode && !userForm.establishmentCode)
        userForm.establishmentCode = String(sel.establishmentCode || "").toUpperCase();
    }
  );

  return reactive({
    // permissions
    permissions, hasPermission,
    // roles
    authRoles, isDeveloper, isChef, isRegulator, isEmergencyResponder, isSecurityResponder, canManageUsers, isNational, isHealthAdmin,
    hasAnyRole, hasApprovedChefCenter, canSeeComplaintsPanel, canHandleComplaintActions,
    // tab
    tab, resolveTab,
    // common
    error, info,
    // centers
    radiusKm, nearbySearch, coords, nearbyCenters, allCenters, selectedCenter,
    nearbyBootstrapped, filteredNearbyCenters,
    fetchAllCenters, fetchNearby, refreshCurrentPosition,
    // complaints
    complaintStatusFilter, evaluationSearch, complaintsList, complaintSummary,
    complaintStepNotes, complaintAdminError, complaintSuccess,
    complaintsPage, complaintsPageCount, paginatedComplaintsList,
    filteredEvaluationCenters, evaluationPage, evaluationPageCount, paginatedEvaluationCenters,
    evaluationCoverage, satisfactionBreakdown, topRatedCenters,
    fetchComplaints, fetchComplaintSummary, setComplaintStatus, addComplaintExplanation,
    // suggestions
    suggestionsList, suggestionSummary, suggestionError, suggestionSuccess, suggestionActionLoadingId,
    fetchSuggestions, fetchSuggestionSummary, markSuggestionRead,
    startSuggestionAutoRefresh, stopSuggestionAutoRefresh,
    // app settings
    appSettings, appSettingsLoading, appSettingsError, appSettingsSuccess,
    fetchAppSettings, updateAppSetting,
    // module access per role
    moduleDefinitions, roleDefinitions, appDefinitions, moduleSettingsApp, moduleSettingsMatrix, moduleSettingsLoading, moduleSettingsError,
    fetchModuleSettings, updateModuleSetting, setModuleSettingsApp,
    // emergency
    emergencyAlerts, emergencyGeoDetails, emergencyCategory, emergencyPeriodFrom, emergencyPeriodTo,
    emergencyStepNotes, emergencyAlertsError, emergencyAlertsSuccess, emergencyCategoryMenu,
    filteredEmergencyAlerts, emergencyStats,
    fetchEmergencyAlerts, startEmergencyAutoRefresh, stopEmergencyAutoRefresh,
    openUnhandledEmergencyAlerts, takeEmergencyInCharge, setEmergencyProgress, navigateToEmergency,
    buildEmergencyMapEmbedUrl, getEmergencyStatusClass, getEmergencyAlertCardClass,
    getEmergencyCountry, getEmergencyPlaceName, getEmergencyCity, getEmergencyLocality,
    // security alerts
    securityAlerts, securityAlertsError, securityAlertsSuccess, securityCategory, securityCategoryMenu,
    filteredSecurityAlerts, securityAlertStats,
    fetchSecurityAlerts, takeSecurityAlertInCharge, resolveSecurityAlert, closeSecurityAlert,
    formatSecurityAlertType, formatSecurityStatus, getSecurityStatusClass, getSecurityAlertCardClass,
    navigateToSecurityAlert, buildSecurityMapEmbedUrl,
    // referrals
    incomingReferrals, referralsError, referralsSuccess, referralActionLoadingId,
    pendingReferrals, receivedReferrals, rejectedReferrals,
    fetchIncomingReferrals, confirmReferralReception, rejectReferralReception,
    startReferralsAutoRefresh, stopReferralsAutoRefresh,
    // chef
    myCenterId, chefForm, chefError, chefSuccess,
    availableDistrictsForChef, onChefRegionChange,
    addChefServiceRow, removeChefServiceRow,
    setCurrentPosition, saveMyCenter, loadChefCenterFromList,
    claimCodeInput, claimLoading, claimError, claimNotFound,
    claimCenterByCode, createWithClaimCode,
    serviceActionLoadingName, serviceError, adjustServiceBeds, updateServiceDetails,
    // regulator center
    regulatorCenterForm, regulatorCenterError, regulatorCenterSuccess,
    setRegulatorCurrentPosition, createCenterByRegulator, onRegulatorRegionChange,
    resetRegulatorCenterForm, addRegulatorServiceRow, removeRegulatorServiceRow,
    // centers admin
    pendingCenters, pendingCenterSearch, centersAdminSearch,
    centersAdminRegionFilter, centersAdminDistrictFilter,
    centersAdminActionLoading, centersAdminLoading, centersAdminError, centersAdminSuccess,
    expandedCenterAdminId, editingCenterAdminId, centerAdminForm,
    pendingChefsCount, disabledUsersCount,
    filteredPendingCenters, pendingCentersPage, pendingCentersPageCount, paginatedPendingCenters,
    filteredCentersForAdmin, adminCentersPage, adminCentersPageCount, paginatedCentersForAdmin,
    toggleCenterAdminDetails, startEditCenterByRegulator, cancelEditCenterByRegulator,
    addCenterAdminServiceRow, removeCenterAdminServiceRow,
    saveCenterByRegulator, toggleCenterActiveByRegulator, deleteCenterByRegulator,
    fetchPendingCenters, reviewCenter, approveAllPendingCenters,
    deleteAllCenters, deleteCentersConfirm, deleteCentersLoading, deleteCentersError, deleteCentersSuccess,
    // geo
    regions, districts, regionForm, districtForm, geoError, geoSuccess,
    parsedRegions, parsedDistricts, regionImportPreviewCount, districtImportPreviewCount,
    regionImportError, districtImportError, regionImportSuccess, districtImportSuccess,
    regionImportLoading, districtImportLoading,
    availableDistrictsForRegulatorCenter, availableDistrictsForCenterAdminFilter,
    availableDistrictsForCenterAdminForm,
    availableDistrictsForUserAssignment, assignableCentersForUser,
    fetchRegions, fetchDistricts, createRegion, createDistrict,
    onRegionImportFileChange, onDistrictImportFileChange,
    importRegionsFromFile, importDistrictsFromFile,
    exportRegionsCsv, exportDistrictsCsv, exportEspcCsv,
    // users
    users, usersSearch, userCategory, usersError, usersSuccess,
    settingsSection, editingUserId, userRoleOptions, userCategoryMenu,
    userForm, requiresEstablishmentCode,
    userCategoryCounts, filteredUsers, usersPage, usersPageCount, paginatedUsers,
    fetchUsers, reviewChef, createUser, resetUserForm, toggleUserRole,
    formatUserRoleLabel, startEditUser, toggleUserActive, deleteUser,
    // imports
    parsedCenters, importPreviewCount, importError, importSuccess, importLoading,
    onImportFileChange, importCentersFromFile,
    // format helpers
    formatType, formatLevel, formatDate, formatComplaintStatus, formatEmergencyStatus,
    formatUserScope, getDistrictName,
    // geolocation
    getCurrentPositionDetailed,
    // normalize
    normalizeGeoCode,
    // rbac
    rbacRoles, rbacPermissions, rbacError, rbacSuccess,
    fetchRbacRoles, fetchRbacPermissions, createRbacRole, updateRbacRole, deleteRbacRole, assignRbacUsers,
  });
})();

export function useDashboardStore() {
  return _store;
}
