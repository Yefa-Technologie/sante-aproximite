const test = require("node:test");
const assert = require("node:assert/strict");
const { findCentersForIntent, formatCenterFacts } = require("./assistedCenterSearch.cjs");
const intent = { name: "", service: "", equipment: "", locality: "", nearby: false, radiusKm: null };
const center = { _id: "1", name: "Centre A", address: "Rue 1", approvalStatus: "APPROVED", services: [{ name: "Maternité" }], districtCode: "BOU", location: { coordinates: [-5.03, 7.69] }, technicalPlatform: "Scanner, Echographie" };

test("search uses real catalog records, accents and locality names", () => {
  const result = findCentersForIntent([center, { ...center, _id: "2", districtCode: "OTHER", address: "Rue 2" }], { ...intent, service: "maternite", locality: "Bouaké" }, { districts: [{ code: "BOU", name: "BOUAKE" }] });
  assert.deepEqual(result.centers.map((item) => item._id), ["1"]);
  assert.equal(findCentersForIntent([center], { ...intent, name: "Centre inventé" }).centers.length, 0);
});
test("inactive centers, pending centers and inactive services are excluded", () => {
  const records = [{ ...center, isActive: false }, { ...center, approvalStatus: "PENDING" }, { ...center, services: [{ name: "Maternité", isActive: false }] }];
  assert.equal(findCentersForIntent(records, { ...intent, service: "maternité" }).centers.length, 0);
});
test("AI search ignores both UI and extracted radii and keeps distant or unlocated centers", () => {
  const result = findCentersForIntent([center, { ...center, _id: "far", location: { coordinates: [0, 40] } }, { ...center, _id: "unknown", location: { coordinates: [0, 0] } }], { ...intent, nearby: true, radiusKm: 5 }, { coords: { lat: 7.69, lon: -5.03 } });
  assert.deepEqual(result.centers.map((item) => item._id), ["1", "far", "unknown"]);
  assert.equal(result.centers[0].distanceKm, 0);
  assert.ok(result.centers[1].distanceKm > 300);
  assert.equal(result.centers[2].distanceKm, null);
  assert.equal(findCentersForIntent([center], { ...intent, nearby: true }, { defaultRadiusKm: 0.1 }).centers.length, 1);
});
test("missing user position never hides a center or invents a distance", () => {
  const result = findCentersForIntent([center], { ...intent, nearby: true });
  assert.equal(result.needsLocation, false);
  assert.equal(result.centers.length, 1);
  assert.equal(result.centers[0].distanceKm, null);
});
test("region, district and city are separate data and are included in spoken facts", () => {
  const result = findCentersForIntent([{ ...center, city: "Sakassou" }], intent, {
    districts: [{ code: "BOU", name: "District de Bouaké", regionCode: "GBE", regionName: "Gbêkê" }]
  }).centers[0];
  assert.equal(result.regionName, "Gbêkê");
  assert.equal(result.districtName, "District de Bouaké");
  assert.equal(result.cityName, "Sakassou");
  assert.match(formatCenterFacts(result), /Région : Gbêkê/);
  assert.match(formatCenterFacts(result), /District sanitaire : District de Bouaké/);
  assert.match(formatCenterFacts(result), /Ville : Sakassou/);
  const unknownCity = findCentersForIntent([center], intent, { districts: [{ code: "BOU", name: "Bouaké" }] }).centers[0];
  assert.equal(unknownCity.cityName, null);
  assert.match(formatCenterFacts(unknownCity), /Ville : non renseignée/);
});
test("service and equipment criteria must both match and local data are not mutated", () => {
  assert.equal(findCentersForIntent([center], { ...intent, service: "maternité", equipment: "scanner" }).centers.length, 1);
  assert.equal(findCentersForIntent([center], { ...intent, service: "pédiatrie", equipment: "scanner" }).centers.length, 0);
  assert.equal(center.distanceKm, undefined);
});

test("minor name spelling differences are tolerated without broadening medical service filters", () => {
  const record = { ...center, name: "CLINIQUE SILOHE" };
  assert.equal(findCentersForIntent([record], { ...intent, name: "clinique Siloé" }).centers.length, 1);
  assert.equal(findCentersForIntent([record], { ...intent, name: "clinique totalement différente" }).centers.length, 0);
  assert.equal(findCentersForIntent([{ ...record, services: [{ name: "Scanner" }] }], { ...intent, service: "scannex" }).centers.length, 0);
});

test("distinctive words find other facility types and relevance precedes distance", () => {
  const records = [
    { ...center, _id: "partial", name: "CMS SILOE", location: { coordinates: [-5.03, 7.69] } },
    { ...center, _id: "full", name: "ESPACE MEDICAL ESPERANCE SILOE", location: { coordinates: [0, 40] } },
    { ...center, _id: "irrelevant", name: "CLINIQUE AUTRE" }
  ];
  const result = findCentersForIntent(records, { ...intent, name: "clinique Siloé Espérance" }, { coords: { lat: 7.69, lon: -5.03 } });
  assert.deepEqual(result.centers.map((item) => item._id), ["full", "partial"]);
  assert.equal(result.centers[0].partialNameMatch, false);
  assert.equal(result.centers[1].partialNameMatch, true);
  assert.equal(findCentersForIntent(records, { ...intent, name: "clinique Siloé" }).centers.length, 2);
});

test("common service synonyms match actual active services", () => {
  assert.equal(findCentersForIntent([center], { ...intent, service: "accouchement" }).centers.length, 1);
  assert.equal(findCentersForIntent([{ ...center, services: [{ name: "Pédiatrie" }] }], { ...intent, service: "consultation pour enfants" }).centers.length, 1);
  assert.equal(findCentersForIntent([center], { ...intent, service: "analyses médicales" }).centers.length, 0);
});
