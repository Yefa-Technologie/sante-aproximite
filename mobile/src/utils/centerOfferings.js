// Outils communs pour rechercher les centres par service ou par equipement du plateau technique.

// Cle de regroupement insensible a la casse et aux accents ("Pédiatrie" = "pediatrie").
export function toOfferingKey(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ");
}

// Le plateau technique est saisi en texte libre : "Radiologie, Echographie; Laboratoire".
export function parsePlatformItems(value) {
  const text = String(value || "").trim();
  if (!text || toOfferingKey(text) === "non renseigne") return [];
  return text.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

// Les services desactives par le centre ne sont pas proposes.
export function activeServices(center) {
  return (Array.isArray(center?.services) ? center.services : []).filter((service) => service?.isActive !== false);
}

// Liste des services (kind = "SERVICE") ou equipements (kind = "PLATFORM") proposes par au moins un centre,
// avec le nombre de centres et le total de places disponibles.
export function buildOfferingOptions(centers, kind) {
  const groups = new Map();
  for (const center of centers) {
    const entries = kind === "SERVICE"
      ? activeServices(center).map((service) => ({ label: String(service.name || ""), beds: Number(service.bedsAvailable) || 0 }))
      : parsePlatformItems(center.technicalPlatform).map((label) => ({ label, beds: 0 }));
    const seen = new Set();
    for (const { label, beds } of entries) {
      const key = toOfferingKey(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const group = groups.get(key) || { key, labels: new Map(), centerCount: 0, bedsAvailable: 0 };
      const clean = label.trim();
      group.labels.set(clean, (group.labels.get(clean) || 0) + 1);
      group.centerCount += 1;
      group.bedsAvailable += beds;
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      label: [...group.labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
      centerCount: group.centerCount,
      bedsAvailable: group.bedsAvailable,
    }))
    .sort((a, b) => b.centerCount - a.centerCount || a.label.localeCompare(b.label));
}

export function findMatchingService(center, serviceKey) {
  return activeServices(center).find((service) => toOfferingKey(service.name) === serviceKey) || null;
}

export function centerHasPlatformItem(center, platformKey) {
  return parsePlatformItems(center?.technicalPlatform).some((item) => toOfferingKey(item) === platformKey);
}
