export function formatType(type?: string) {
  if (type === "CONFESSIONNEL") return "Confessionnel";
  if (type === "PRIVE") return "Prive";
  if (type === "PUBLIQUE") return "Publique";
  return type || "-";
}

export function formatLevel(level?: string) {
  const map: Record<string, string> = {
    CLINIQUE: "Clinique",
    POLYCLINIQUE: "Polyclinique",
    INFIRMERIE: "Infirmerie",
    CENTRE_SANTE: "Centre de sante",
    EHPAD_USLD: "EHPAD / USLD",
    CENTRE_RADIOTHERAPIE: "Centre de radiotherapie",
    CENTRE_CARDIOLOGIE: "Centre de cardiologie",
  };
  return map[level || ""] || level || "-";
}

export function formatComplaintStatus(status?: string) {
  const map: Record<string, string> = {
    NEW: "NOUVELLE",
    IN_PROGRESS: "EN COURS",
    RESOLVED: "RESOLUE",
    REJECTED: "REJETEE",
  };
  return map[status || ""] || status || "-";
}

export function formatEmergencyStatus(status?: string) {
  const map: Record<string, string> = {
    NEW: "NOUVELLE",
    ACKNOWLEDGED: "PRISE EN CHARGE",
    EN_ROUTE: "EN ROUTE",
    ON_SITE: "SUR SITE",
    COMPLETED: "TERMINEE",
    CLOSED: "CLOTUREE",
  };
  return map[status || ""] || status || "-";
}

export function formatDate(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return String(value);
  }
}
