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
    PENDING_ASSIGNMENT:"À AFFECTER", UNCONFIRMED:"NON CONFIRMÉ", DUPLICATE:"DOUBLON",
    NEW: "NOUVEAU",
    ACKNOWLEDGED: "PRISE EN CHARGE",
    EN_ROUTE: "ÉQUIPE ENVOYÉE",
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

export function formatIncidentEvent(event:string) {
  const labels:Record<string,string>={CREATED:"Signalement reçu",STATUS:"Statut modifié",TRANSFER:"Transfert",REINFORCEMENT:"Renfort autorisé",REINFORCEMENT_REVOKED:"Autorisation de renfort retirée",CENTER_DEACTIVATED:"Centre désactivé : réaffectation nécessaire",MIGRATED_TO_QUEUE:"Dossier historique à affecter"};
  return labels[event] || "Mise à jour";
}
export function formatAssignmentReason(reason:string) {
  const labels:Record<string,string>={OUTSIDE_ZONE:"Aucun périmètre ne couvre cette position",AMBIGUOUS_ZONE:"Plusieurs centres couvrent cette position",INACTIVE_CENTER:"Le centre compétent est inactif",ZONE_MATCH:"Centre déterminé par son périmètre",MANUAL_TRANSFER:"Affectation décidée par un responsable habilité",LEGACY_UNASSIGNED:"Dossier historique nécessitant une affectation"};
  return labels[reason] || "À vérifier par la coordination";
}
