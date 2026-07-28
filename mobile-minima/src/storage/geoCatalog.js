import AsyncStorage from "@react-native-async-storage/async-storage";

const REGIONS_KEY = "sante_aproxmite_geo_regions";
const DISTRICTS_PREFIX = "sante_aproxmite_geo_districts_";
const ALL_DISTRICTS_KEY = "sante_aproxmite_geo_all_districts";

function getDistrictsKey(regionCode) {
  return `${DISTRICTS_PREFIX}${encodeURIComponent(String(regionCode || ""))}`;
}

export async function loadCachedRegions() {
  try {
    const raw = await AsyncStorage.getItem(REGIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCachedRegions(regions) {
  try {
    await AsyncStorage.setItem(REGIONS_KEY, JSON.stringify(Array.isArray(regions) ? regions : []));
  } catch {
    // stockage indisponible, on continue sans cache
  }
}

export async function loadCachedDistricts(regionCode) {
  if (!regionCode) return [];
  try {
    const raw = await AsyncStorage.getItem(getDistrictsKey(regionCode));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCachedDistricts(regionCode, districts) {
  if (!regionCode) return;
  try {
    await AsyncStorage.setItem(getDistrictsKey(regionCode), JSON.stringify(Array.isArray(districts) ? districts : []));
  } catch {
    // stockage indisponible, on continue sans cache
  }
}

export async function loadCachedAllDistricts() {
  try {
    const raw = await AsyncStorage.getItem(ALL_DISTRICTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCachedAllDistricts(districts) {
  try {
    await AsyncStorage.setItem(ALL_DISTRICTS_KEY, JSON.stringify(Array.isArray(districts) ? districts : []));
  } catch {
    // stockage indisponible, on continue sans cache
  }
}
