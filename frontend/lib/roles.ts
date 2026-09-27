export type User = {
  id?: string;
  fullName?: string;
  email?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  establishmentCode?: string | null;
  regionCode?: string | null;
  districtCode?: string | null;
  centerId?: string | null;
};

export const ADMIN_ROLES = new Set(["REGULATOR", "NATIONAL", "REGION", "DISTRICT"]);
export const ETABLISSEMENT_ROLES = new Set(["ETABLISSEMENT", "CHEF_ETABLISSEMENT"]);
export const EMERGENCY_ROLES = new Set(["SAMU", "SAPEUR_POMPIER"]);
export const SECURITY_ROLES = new Set(["POLICE", "GENDARMERIE", "PROTECTION_CIVILE"]);

export function normalizeRole(value?: string | null): string {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function getUserRoles(user: User | null | undefined): string[] {
  const all = [...(Array.isArray(user?.roles) ? user!.roles : []), user?.role]
    .map((v) => normalizeRole(v))
    .filter(Boolean);
  return [...new Set(all)];
}

export function hasRole(user: User | null | undefined, role: string): boolean {
  return getUserRoles(user).includes(normalizeRole(role));
}

export function hasAnyRole(user: User | null | undefined, roles: string[]): boolean {
  return roles.some((r) => hasRole(user, r));
}

export function isDeveloper(user: User | null | undefined): boolean {
  return hasRole(user, "DEVELOPER");
}

export function isChef(user: User | null | undefined): boolean {
  return hasAnyRole(user, [...ETABLISSEMENT_ROLES]);
}

export function isRegulator(user: User | null | undefined): boolean {
  return isDeveloper(user) || hasAnyRole(user, [...ADMIN_ROLES]);
}

export function isEmergencyResponder(user: User | null | undefined): boolean {
  return hasAnyRole(user, [...EMERGENCY_ROLES]);
}

export function isSecurityResponder(user: User | null | undefined): boolean {
  return hasAnyRole(user, [...SECURITY_ROLES]);
}

export function canManageUsers(user: User | null | undefined): boolean {
  return (
    isDeveloper(user) ||
    hasAnyRole(user, [
      "NATIONAL",
      "REGULATOR",
      "REGION",
      "DISTRICT",
      "ETABLISSEMENT",
      "CHEF_ETABLISSEMENT",
      "SAMU",
      "SAPEUR_POMPIER",
      "POLICE",
      "GENDARMERIE",
      "PROTECTION_CIVILE",
    ])
  );
}

export type NavItem = {
  key: string;
  label: string;
  icon: string;
  section: string;
};

// "Mon profil" est propose a tous les comptes connectes.
const PROFILE_NAV_ITEM: NavItem = { key: "profile", label: "Mon profil", icon: "user", section: "MON COMPTE" };

export function getNavItems(user: User | null | undefined): NavItem[] {
  if (!user) return [];
  return [...getRoleNavItems(user), PROFILE_NAV_ITEM];
}

function getRoleNavItems(user: User): NavItem[] {

  if (isDeveloper(user)) {
    return [
      { key: "overview", label: "Dashboard", icon: "layout-dashboard", section: "VUE D'ENSEMBLE" },
      { key: "nearby", label: "Centres de sante", icon: "map-pin", section: "RESEAU DE SOINS" },
      { key: "emergency-alerts", label: "Alertes urgence", icon: "siren", section: "URGENCES" },
      { key: "complaints", label: "Plaintes", icon: "file-text", section: "QUALITE" },
      { key: "suggestions", label: "Observations", icon: "lightbulb", section: "QUALITE" },
      { key: "evaluations", label: "Evaluations", icon: "bar-chart-3", section: "QUALITE" },
      { key: "my-center", label: "Mon centre", icon: "hospital", section: "SUIVI SANITAIRE" },
      { key: "referrals", label: "Orientations patients", icon: "ambulance", section: "SUIVI SANITAIRE" },
      { key: "settings", label: "Parametres", icon: "settings", section: "GOUVERNANCE" },
      { key: "imports", label: "Importations", icon: "upload", section: "GOUVERNANCE" },
      { key: "roles", label: "Gestion des roles", icon: "shield", section: "GOUVERNANCE" },
      { key: "analytics", label: "Statistiques", icon: "line-chart", section: "ANALYTIQUE" },
      { key: "help", label: "Aide", icon: "help-circle", section: "SUPPORT & PROJET" },
      { key: "about", label: "A propos", icon: "info", section: "SUPPORT & PROJET" },
    ];
  }

  if (isChef(user)) {
    return [
      { key: "my-center", label: "Mon centre", icon: "hospital", section: "SUIVI SANITAIRE" },
      { key: "referrals", label: "Orientations patients", icon: "ambulance", section: "SUIVI SANITAIRE" },
      { key: "complaints", label: "Plaintes & Satisfaction", icon: "star", section: "SUIVI SANITAIRE" },
      { key: "suggestions", label: "Observations", icon: "lightbulb", section: "SUIVI SANITAIRE" },
      { key: "evaluations", label: "Evaluations", icon: "bar-chart-3", section: "SUIVI SANITAIRE" },
      { key: "settings", label: "Utilisateurs", icon: "users", section: "GOUVERNANCE" },
      { key: "help", label: "Aide", icon: "help-circle", section: "SUPPORT & PROJET" },
      { key: "about", label: "A propos", icon: "info", section: "SUPPORT & PROJET" },
    ];
  }

  const items: NavItem[] = [
    { key: "overview", label: "Dashboard", icon: "layout-dashboard", section: "VUE D'ENSEMBLE" },
    { key: "nearby", label: "Centre de sante", icon: "map-pin", section: "RESEAU DE SOINS" },
  ];

  if (isEmergencyResponder(user)) {
    items.push({ key: "emergency-alerts", label: "Alertes urgence", icon: "siren", section: "URGENCES" });
    items.push({ key: "settings", label: "Utilisateurs", icon: "users", section: "GOUVERNANCE" });
  }

  if (isSecurityResponder(user)) {
    items.push({ key: "security-alerts", label: "Alertes securite", icon: "shield-alert", section: "SECURITE" });
    items.push({ key: "settings", label: "Utilisateurs", icon: "users", section: "GOUVERNANCE" });
  }

  if (isRegulator(user)) {
    items.push({ key: "complaints", label: "Gestion des Plaintes", icon: "file-text", section: "QUALITE" });
    items.push({ key: "suggestions", label: "Observations", icon: "lightbulb", section: "QUALITE" });
    items.push({ key: "evaluations", label: "Evaluations", icon: "bar-chart-3", section: "QUALITE" });
    items.push({ key: "settings", label: "Parametres", icon: "settings", section: "GOUVERNANCE" });
    items.push({ key: "imports", label: "Importations", icon: "upload", section: "GOUVERNANCE" });
    if (hasAnyRole(user, ["NATIONAL", "REGULATOR"])) {
      items.push({ key: "roles", label: "Gestion des roles", icon: "shield", section: "GOUVERNANCE" });
    }
    items.push({ key: "analytics", label: "Statistiques", icon: "line-chart", section: "ANALYTIQUE" });
  }

  items.push({ key: "help", label: "Aide", icon: "help-circle", section: "SUPPORT & PROJET" });
  items.push({ key: "about", label: "A propos", icon: "info", section: "SUPPORT & PROJET" });

  // dedupe by key, first occurrence wins (mirrors App.vue's pushItem behavior)
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export function getDefaultNavKey(user: User | null | undefined): string {
  const items = getNavItems(user);
  return items[0]?.key || "overview";
}

export function getRoleChipLabel(user: User | null | undefined): string {
  if (hasRole(user, "DEVELOPER")) return "Developpeur";
  if (hasRole(user, "NATIONAL")) return "Niveau National";
  if (hasRole(user, "REGULATOR")) return "Autorite de regulation";
  if (hasRole(user, "REGION")) return "Niveau Region";
  if (hasRole(user, "DISTRICT")) return "Niveau District";
  if (isChef(user)) return "Niveau Etablissement";
  if (hasRole(user, "SAPEUR_POMPIER")) return "Sapeur-Pompier";
  if (hasRole(user, "SAMU")) return "Service SAMU";
  if (hasRole(user, "POLICE")) return "Police Nationale";
  if (hasRole(user, "GENDARMERIE")) return "Gendarmerie Nationale";
  if (hasRole(user, "PROTECTION_CIVILE")) return "Protection Civile";
  return "Gestionnaire Plateforme";
}
