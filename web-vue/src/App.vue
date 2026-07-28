<template>
  <div class="app-shell" :class="{ 'auth-mode': isAuthPage, 'sidebar-collapsed': !sidebarOpen && !isAuthPage }">
    <aside v-if="!isAuthPage" class="shell-sidebar">
      <div class="sidebar-head">
        
        <div class="sidebar-app-badge">
          <img src="/logo-web.png" alt="logo" class="shell-logo" />
        </div>
        <div>
          <h1 class="sidebar-app-title">SANTE APROXMITE</h1>
          <p class="sidebar-app-sub">Gestion sanitaire</p>
        </div>
      </div>

      <div class="sidebar-scroll">
        <p class="sidebar-section-title">{{ auth.state.user?.fullName || "Utilisateur" }}</p>
        <button class="role-chip" type="button">{{ roleChipLabel }}</button>

        <div class="sidebar-divider"></div>

        <nav class="shell-menu">
          <template v-for="section in sidebarSections" :key="section.label">
            <div class="menu-section-head">
              <p class="menu-section-label">{{ section.label }}</p>
              <span class="menu-section-decor">{{ section.decor }}</span>
            </div>
            <RouterLink
              v-for="item in section.items"
              :key="item.tab"
              class="shell-link shell-link-row"
              :class="{ active: isMenuActive(item.tab), 'no-highlight-link': isNoHighlightTab(item.tab) }"
              active-class="router-active-disabled"
              exact-active-class="router-active-disabled"
              :to="{ path: '/', query: { tab: item.tab } }"
            >
              <span class="shell-link-left">
                <span class="shell-link-icon">{{ item.icon }}</span>
                {{ item.label }}
              </span>
              <span class="shell-link-arrow">›</span>
            </RouterLink>
          </template>
          
        </nav>
        <button v-if="auth.state.token" class="ghost side-logout" @click="logout">Deconnexion</button>
        <template v-else>
          <RouterLink class="shell-link" to="/login">Connexion</RouterLink>
          <RouterLink class="shell-link" to="/register">Inscription</RouterLink>
        </template>
      </div>
    </aside>

    <main class="shell-content">
      <header v-if="!isAuthPage" class="shell-topband">
        <div class="shell-topband-left">
          <button class="topbar-hamburger" type="button" @click="toggleSidebar" aria-label="Menu">
            ☰
          </button>
          <div class="topbar-app-badge">
            <img src="/logo-web.png" alt="logo" class="shell-logo" />
          </div>
          <p class="shell-topband-title">Sante Aproximite Platform</p>
          <p class="shell-topband-subtitle">Ecosysteme de pilotage des centres de sante</p>
        </div>
        <div class="shell-topband-right">
          <div class="company-block">
            <strong>Ministere de la Sante</strong>
            <small>Service digital des etablissements</small>
          </div>
          <span class="shell-role-badge">{{ auth.state.user?.role || "VISITOR" }}</span>
          <span class="shell-date">{{ todayLabel }}</span>
        </div>
      </header>

      <header v-if="!isAuthPage" class="shell-mobile-header">
        <img src="/logo-web.png" alt="logo" class="shell-logo small" />
        <div class="shell-mobile-links">
          <RouterLink
            v-for="item in mobileMenuItems"
            :key="item.tab"
            :to="{ path: '/', query: { tab: item.tab } }"
          >
            {{ item.label }}
          </RouterLink>
          <a :href="backendUrl" target="_blank" rel="noreferrer">API</a>
          <button v-if="auth.state.token" class="ghost" @click="logout">Deconnexion</button>
        </div>
      </header>

      <router-view />
    </main>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const backendUrl = (import.meta.env.VITE_API_URL || "http://193.168.173.181:8081/api").replace(/\/+$/, "");
const isAuthPage = computed(() => route.path === "/login" || route.path === "/register");
const normalizeRole = (value) => String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
const role = computed(() => normalizeRole(auth.state.user?.role || ""));
const roles = computed(() => {
  const all = [
    ...(Array.isArray(auth.state.user?.roles) ? auth.state.user.roles : []),
    auth.state.user?.role
  ]
    .map((value) => normalizeRole(value))
    .filter(Boolean);
  return [...new Set(all)];
});
const hasRole = (value) => roles.value.includes(normalizeRole(value));
const hasAnyRole = (values) => values.some((value) => hasRole(value));
const currentTab = computed(() => String(route.query.tab || "").trim());
const sidebarOpen = ref(false);
const adminRoles = new Set(["REGULATOR", "NATIONAL", "REGION", "DISTRICT"]);
const etablissementRoles = new Set(["ETABLISSEMENT", "CHEF_ETABLISSEMENT"]);
const emergencyRoleValues = ["SAMU", "SAPEUR_POMPIER"];
const securityRoleValues = ["POLICE", "GENDARMERIE", "PROTECTION_CIVILE"];

const isDeveloper = computed(() => roles.value.includes("DEVELOPER"));

const menuItems = computed(() => {
  if (!auth.state.token) return [];

  const items = [];
  const pushItem = (item) => {
    if (!items.some((entry) => entry.tab === item.tab)) items.push(item);
  };

  // DEVELOPER voit tout, dans toutes les sections
  if (isDeveloper.value) {
    pushItem({ tab: "overview",         label: "Dashboard",             icon: "▦",  section: "VUE D'ENSEMBLE",  decor: "📋" });
    pushItem({ tab: "nearby",           label: "Centres de santé",      icon: "📍", section: "RESEAU DE SOINS",  decor: "🏥" });
    pushItem({ tab: "emergency-alerts", label: "Alertes urgence",       icon: "🚨", section: "URGENCES",         decor: "🚨" });
    pushItem({ tab: "complaints",       label: "Plaintes",              icon: "📝", section: "QUALITE",          decor: "📈" });
    pushItem({ tab: "suggestions",      label: "Observations",          icon: "💡", section: "QUALITE",          decor: "📈" });
    pushItem({ tab: "evaluations",      label: "Evaluations",           icon: "📊", section: "QUALITE",          decor: "📈" });
    pushItem({ tab: "my-center",        label: "Mon centre",            icon: "🏥", section: "SUIVI SANITAIRE",  decor: "🩺" });
    pushItem({ tab: "referrals",        label: "Orientations patients", icon: "🚑", section: "SUIVI SANITAIRE",  decor: "🩺" });
    pushItem({ tab: "settings",         label: "Paramètres",            icon: "⚙",  section: "GOUVERNANCE",      decor: "⚙" });
    pushItem({ tab: "imports",          label: "Importations",          icon: "📥", section: "GOUVERNANCE",      decor: "⚙" });
    pushItem({ tab: "roles",            label: "Gestion des rôles",     icon: "🛡", section: "GOUVERNANCE",      decor: "⚙" });
    pushItem({ tab: "analytics",        label: "Statistiques",          icon: "📈", section: "ANALYTIQUE",       decor: "📊" });
    pushItem({ tab: "help",             label: "Aide",                  icon: "❓", section: "SUPPORT & PROJET", decor: "💬" });
    pushItem({ tab: "about",            label: "À propos",              icon: "ℹ",  section: "SUPPORT & PROJET", decor: "💬" });
    return items;
  }

  if (hasAnyRole([...etablissementRoles])) {
    pushItem({ tab: "my-center",  label: "Mon centre",             icon: "🏥", section: "SUIVI SANITAIRE",  decor: "🩺" });
    pushItem({ tab: "referrals",  label: "Orientations patients",  icon: "🚑", section: "SUIVI SANITAIRE",  decor: "🩺" });
    pushItem({ tab: "complaints", label: "Plaintes & Satisfaction", icon: "⭐", section: "SUIVI SANITAIRE",  decor: "🩺" });
    pushItem({ tab: "suggestions", label: "Observations",           icon: "💡", section: "SUIVI SANITAIRE",  decor: "🩺" });
    pushItem({ tab: "evaluations",label: "Evaluations",             icon: "📊", section: "SUIVI SANITAIRE",  decor: "🩺" });
    pushItem({ tab: "settings",   label: "Utilisateurs",            icon: "👥", section: "GOUVERNANCE",      decor: "⚙" });
    pushItem({ tab: "help",       label: "Aide",                    icon: "❓", section: "SUPPORT & PROJET", decor: "💬" });
    pushItem({ tab: "about",      label: "À propos",                icon: "ℹ",  section: "SUPPORT & PROJET", decor: "💬" });
    return items;
  }

  pushItem({ tab: "overview", label: "Dashboard", icon: "▦", section: "VUE D'ENSEMBLE", decor: "📋" });
  pushItem({ tab: "nearby", label: "Centre de santé", icon: "📍", section: "RESEAU DE SOINS", decor: "🏥" });

  if (hasAnyRole(emergencyRoleValues)) {
    pushItem({ tab: "emergency-alerts", label: "Alertes urgence",  icon: "🚨", section: "URGENCES",          decor: "🚨" });
    pushItem({ tab: "settings",         label: "Utilisateurs",     icon: "👥", section: "GOUVERNANCE",       decor: "⚙"  });
  }

  if (hasAnyRole(securityRoleValues)) {
    pushItem({ tab: "security-alerts",  label: "Alertes sécurité", icon: "🛡", section: "SÉCURITÉ",          decor: "🛡" });
    pushItem({ tab: "settings",         label: "Utilisateurs",     icon: "👥", section: "GOUVERNANCE",       decor: "⚙"  });
  }

  if (hasAnyRole([...adminRoles])) {
    pushItem({ tab: "complaints", label: "Gestion des Plaintes", icon: "📝", section: "QUALITE",          decor: "📈" });
    pushItem({ tab: "suggestions", label: "Observations",         icon: "💡", section: "QUALITE",          decor: "📈" });
    pushItem({ tab: "evaluations",label: "Evaluations",           icon: "📊", section: "QUALITE",          decor: "📈" });
    pushItem({ tab: "settings",   label: "Parametres",            icon: "⚙",  section: "GOUVERNANCE",      decor: "👥" });
    pushItem({ tab: "imports",    label: "Importations",          icon: "📥", section: "GOUVERNANCE",      decor: "👥" });
    if (hasAnyRole(["NATIONAL", "REGULATOR"])) {
      pushItem({ tab: "roles",    label: "Gestion des roles",     icon: "🛡", section: "GOUVERNANCE",      decor: "👥" });
    }
    pushItem({ tab: "analytics",  label: "Statistiques",          icon: "📈", section: "ANALYTIQUE",       decor: "📊" });
  }

  pushItem({ tab: "help",  label: "Aide",      icon: "❓", section: "SUPPORT & PROJET", decor: "💬" });
  pushItem({ tab: "about", label: "À propos",  icon: "ℹ",  section: "SUPPORT & PROJET", decor: "💬" });

  return items;
});

const roleChipLabel = computed(() => {
  if (hasRole("DEVELOPER"))          return "Développeur";
  if (hasRole("NATIONAL"))           return "Niveau National";
  if (hasRole("REGULATOR"))          return "Autorite de regulation";
  if (hasRole("REGION"))             return "Niveau Region";
  if (hasRole("DISTRICT"))           return "Niveau District";
  if (hasAnyRole([...etablissementRoles])) return "Niveau Etablissement";
  if (hasRole("SAPEUR_POMPIER"))     return "Sapeur-Pompier";
  if (hasRole("SAMU"))               return "Service SAMU";
  if (hasRole("POLICE"))             return "Police Nationale";
  if (hasRole("GENDARMERIE"))        return "Gendarmerie Nationale";
  if (hasRole("PROTECTION_CIVILE"))  return "Protection Civile";
  return "Gestionnaire Plateforme";
});
const sidebarSections = computed(() => {
  const grouped = new Map();
  for (const item of menuItems.value) {
    const key = item.section || "MENU";
    if (!grouped.has(key)) {
      grouped.set(key, { label: key, decor: item.decor || "•", items: [] });
    }
    grouped.get(key).items.push(item);
  }
  return Array.from(grouped.values());
});

const mobileMenuItems = computed(() => menuItems.value.slice(0, 3));
const todayLabel = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date());
const userInitials = computed(() => {
  const fullName = String(auth.state.user?.fullName || "").trim();
  if (!fullName) return "U";
  const parts = fullName.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
});

function isMenuActive(tab) {
  if (currentTab.value) return currentTab.value === tab;
  if (hasAnyRole([...etablissementRoles])) return tab === "my-center";
  return tab === (menuItems.value[0]?.tab || "overview");
}

function isNoHighlightTab(tab) {
  return ["overview", "nearby", "settings"].includes(String(tab || ""));
}

function logout() {
  auth.logout();
  router.push("/login");
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  background:
    radial-gradient(900px 420px at 95% -10%, rgba(54, 144, 232, 0.2), transparent 56%),
    linear-gradient(180deg, #f7fbff 0%, #eef5fd 100%);
}

.shell-sidebar {
  background: linear-gradient(180deg, #0b4f94 0%, #0a3f77 52%, #08345f 100%);
  border-right: 1px solid rgba(179, 214, 255, 0.28);
  box-shadow: 8px 0 30px rgba(5, 37, 72, 0.22);
}

.sidebar-head {
  border-bottom: 1px solid rgba(179, 214, 255, 0.25);
  background: rgba(255, 255, 255, 0.04);
}

.sidebar-app-badge {
  background: linear-gradient(180deg, #ffffff, #e6f2ff);
  border: 1px solid #b9d9ff;
}

.role-chip {
  background: linear-gradient(135deg, #1d80dc, #1766be);
  border: 1px solid #8fc3ff;
}

.user-card {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(179, 214, 255, 0.25);
  border-radius: 14px;
  padding: 12px 10px;
}

.user-avatar {
  border-radius: 999px;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #eff5ff, #d6e6ff);
  color: #143567;
  font-weight: 800;
}

.shell-user-name {
  margin: 0;
  color: #f0f5ff;
  font-weight: 700;
}

.shell-user-role {
  margin: 2px 0 0;
  color: #a8c3ee;
  font-size: 0.78rem;
}

.menu-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  margin-bottom: 4px;
}

.menu-section-label {
  margin: 0;
  color: #98b9ef;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.menu-section-decor {
  color: #89ade7;
  opacity: 0.9;
}

.shell-link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 2px;
  color: #dbe8ff;
  text-decoration: none;
  font-weight: 700;
  font-size: 1.02rem;
  position: relative;
}

.shell-link-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.shell-link-icon {
  width: 20px;
  display: inline-grid;
  place-items: center;
  color: #bcd5fb;
}

.shell-link.active::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 4px;
  background: #8fc2ff;
}

.menu-dot {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(124, 161, 226, 0.45);
  position: relative;
  opacity: 0;
  transform: scale(0.85);
  transition: 0.2s ease;
}

.menu-dot::after {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: #eef5ff;
  position: absolute;
  left: 6.5px;
  top: 6.5px;
}

.shell-link-arrow {
  color: #9abdee;
  font-size: 1.1rem;
  opacity: 0.45;
  transition: 0.2s ease;
}

.shell-link-row:hover .menu-dot,
.shell-link-row.active .menu-dot {
  opacity: 1;
  transform: scale(1);
}

.shell-link-row:hover .shell-link-arrow,
.shell-link-row.active .shell-link-arrow {
  opacity: 1;
}

.shell-link-row.no-highlight-link:hover,
.shell-link-row.no-highlight-link.active {
  transform: none;
  background: transparent !important;
}

.shell-link-row.no-highlight-link.active::before {
  display: none;
}

.shell-link-row.no-highlight-link .menu-dot {
  display: none;
}

.shell-link-row.no-highlight-link .shell-link-arrow {
  opacity: 0.45;
}

.shell-link-row.no-highlight-link {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* Pour overview/nearby/settings: pas de surbrillance en actif, seulement au survol */
.shell-link-row.no-highlight-link.active {
  color: #dbe8ff;
  border: 1px solid rgba(143, 194, 255, 0.65) !important;
  background: rgba(126, 164, 236, 0.12) !important;
  border-radius: 10px;
}

.shell-link-row.no-highlight-link:hover {
  border: 1px solid rgba(143, 194, 255, 0.65) !important;
  background: rgba(126, 164, 236, 0.12) !important;
  border-radius: 10px;
  color: #ffffff;
}

.shell-link-row.no-highlight-link:hover::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 4px;
  background: #8fc2ff;
}

.side-logout {
  margin-top: 14px;
  border-radius: 10px;
  border: 1px solid #4a79c7;
  background: rgba(187, 32, 32, 0.18);
  color: #ffdede;
  font-weight: 700;
  padding: 10px;
  width: 100%;
}

.shell-link {
  border-radius: 0;
  border: none;
  box-shadow: none;
}

.shell-link:hover {
  background: transparent;
}

.shell-link.active {
  background: transparent;
  color: #ffffff;
}

.shell-content {
  background: transparent;
}

.shell-topband {
  background: rgba(240, 248, 255, 0.92);
  border-bottom: 1px solid #cfe2f7;
  backdrop-filter: blur(8px);
}

.shell-topband-title {
  color: #0d2f57;
  font-weight: 800;
}

.shell-topband-subtitle {
  color: #4a6d92;
}

.company-block {
  background: #eaf4ff;
  border: 1px solid #cfe2f7;
  border-radius: 999px;
  padding: 6px 12px;
}

.shell-role-badge {
  background: linear-gradient(135deg, #1f79d0, #175ea6);
}

.shell-mobile-header {
  background: #edf6ff;
  border-bottom: 1px solid #cfe2f7;
}

@media (max-width: 1024px) {
  .app-shell {
    background: linear-gradient(180deg, #f7fbff 0%, #edf5ff 100%);
  }
}
</style>
