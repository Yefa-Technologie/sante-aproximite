function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function matches(value, query) {
  const canonical = (input) => normalize(input).replace(/accouchements?/g, "maternite").replace(/analyses? medicales?/g, "laboratoire").replace(/radiographies?/g, "radiologie").replace(/consultations? (?:des? |pour (?:les? )?)?enfants?/g, "pediatrie");
  const text = canonical(value);
  return canonical(query).split(" ").filter((word) => word && !["de", "du", "des", "la", "le", "les", "et", "a", "l", "service", "services", "consultation", "consultations"].includes(word))
    .every((word) => text.includes(word.replace(/^(matern|pediatr|cardiol|radiol|ophtalm|laborat|vaccin).*/, "$1")));
}
function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}
function nameRelevance(value, query) {
  const text = normalize(value); const words = text.split(" ");
  const generic = new Set(["de", "du", "des", "la", "le", "les", "et", "a", "l", "centre", "centres", "sante", "clinique", "cliniques", "medical", "medicale", "hopital", "hospitalier", "prive", "privee", "public"]);
  const tokens = [...new Set(normalize(query).split(" ").filter(Boolean))];
  const useful = tokens.filter((word) => !generic.has(word));
  const terms = useful.length ? useful : tokens;
  let matched = 0; let score = 0;
  for (const word of terms) {
    if (words.includes(word)) { matched++; score += 3; }
    else if (words.some((candidate) => candidate.startsWith(word) && word.length >= 4)) { matched++; score += 2; }
    else if (word.length >= 5 && words.some((candidate) => candidate.length >= 5 && oneEditApart(candidate, word))) { matched++; score++; }
  }
  return { score: matched ? score / (terms.length * 3) : 0, partial: matched > 0 && matched < terms.length };
}
function coordinates(center) {
  const lon = center.location?.coordinates?.[0]; const lat = center.location?.coordinates?.[1];
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0) ? { lat, lon } : null;
}
function distance(a, b) {
  const p = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * p / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin((b.lon - a.lon) * p / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function findCentersForIntent(catalog, intent, { coords, districts = [], regions = [] } = {}) {
  // AI searches span the full authorized catalog. Distance is informative, never a cutoff.
  const userPosition = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon) && Math.abs(coords.lat) <= 90 && Math.abs(coords.lon) <= 180 ? coords : null;
  const key = (code) => String(code || "").trim().toUpperCase();
  const districtByCode = new Map(districts.map((entry) => [key(entry.code), entry]));
  const regionByCode = new Map(regions.map((entry) => [key(entry.code), entry]));
  const centers = [];
  for (const center of catalog) {
    if (center.isActive === false || (center.approvalStatus && center.approvalStatus !== "APPROVED")) continue;
    const relevance = intent.name ? nameRelevance(center.name, intent.name) : { score: 0, partial: false };
    if (intent.name && !relevance.score) continue;
    const services = (Array.isArray(center.services) ? center.services : []).filter((service) => service.isActive !== false);
    if (intent.service && !services.some((service) => matches(service.name, intent.service))) continue;
    if (intent.equipment && !matches(center.technicalPlatform, intent.equipment)) continue;
    const district = districtByCode.get(key(center.districtCode));
    const regionCode = center.regionCode || district?.regionCode || null;
    const regionName = regionByCode.get(key(regionCode))?.name || district?.regionName || center.regionName || null;
    const districtName = district?.name || center.districtName || null;
    // A sanitary district may cover multiple towns: never use its name as a guessed city.
    const cityName = [center.cityName, center.city, center.ville, center.commune].find((value) => typeof value === "string" && value.trim())?.trim() || null;
    if (intent.locality && !matches([center.name, center.address, cityName, districtName, regionName].filter(Boolean).join(" "), intent.locality)) continue;
    const position = coordinates(center);
    const distanceKm = userPosition && position ? distance(userPosition, position) : null;
    centers.push({ ...center, services, regionCode, regionName, districtName, cityName, searchRelevance: relevance.score, partialNameMatch: relevance.partial, distanceKm: distanceKm === null ? null : Number(distanceKm.toFixed(2)) });
  }
  centers.sort((a, b) => b.searchRelevance - a.searchRelevance || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || String(a.name).localeCompare(String(b.name)));
  return { needsLocation: false, centers };
}
function formatCenterFacts(center) {
  const distanceLabel = center.distanceKm == null ? "indisponible (position GPS nécessaire)" : `${center.distanceKm} km à vol d’oiseau`;
  return `Distance : ${distanceLabel}. Région : ${center.regionName || center.regionCode || "non renseignée"}. District sanitaire : ${center.districtName || center.districtCode || "non renseigné"}. Ville : ${center.cityName || "non renseignée"}.`;
}
module.exports = { findCentersForIntent, formatCenterFacts };
