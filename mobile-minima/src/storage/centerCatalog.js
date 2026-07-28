import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "../api/client";

const META_KEY_LAST_SYNC = "last_sync_at";
const META_KEY_INITIAL_LOAD_NOTIFIED = "initial_load_notified_at";
const META_KEY_DOWNLOAD_CONSENT = "offline_download_consent";
const CATALOG_PREFIX = "sante_aproxmite_center_catalog_";
const META_PREFIX = "sante_aproxmite_center_catalog_meta_";

function getCatalogKey(token) {
  const tokenKey = token ? String(token).slice(0, 12) : "public";
  return `${CATALOG_PREFIX}${encodeURIComponent(tokenKey)}`;
}

function getMetaStorageKey(key) {
  return `${META_PREFIX}${encodeURIComponent(String(key || ""))}`;
}

function compactBedCount(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function compactServices(services) {
  return Array.isArray(services)
    ? services
        .map((service) => ({
          name: String(service?.name || "").trim(),
          description: String(service?.description || "").trim().slice(0, 120) || null,
          bedsAvailable: compactBedCount(service?.bedsAvailable),
          bedsOccupied: compactBedCount(service?.bedsOccupied),
          bedsOutOfService: compactBedCount(service?.bedsOutOfService)
        }))
        .filter((service) => service.name)
        .slice(0, 20)
    : [];
}

function sanitizeCenter(center) {
  const latitude = Number(center?.location?.coordinates?.[1]);
  const longitude = Number(center?.location?.coordinates?.[0]);
  return {
    _id: String(center?._id || center?.id || ""),
    name: String(center?.name || ""),
    address: String(center?.address || ""),
    establishmentCode: center?.establishmentCode || null,
    level: center?.level || null,
    establishmentType: center?.establishmentType || null,
    technicalPlatform: String(center?.technicalPlatform || ""),
    regionCode: center?.regionCode || null,
    districtCode: center?.districtCode || null,
    location: {
      type: "Point",
      coordinates: [
        Number.isFinite(longitude) ? longitude : 0,
        Number.isFinite(latitude) ? latitude : 0
      ]
    },
    approvalStatus: center?.approvalStatus || null,
    isActive: center?.isActive !== false,
    createdAt: center?.createdAt || null,
    updatedAt: center?.updatedAt || null,
    ratingAverage: center?.ratingAverage == null ? null : Number(center.ratingAverage),
    ratingCount: Number(center?.ratingCount || 0),
    satisfactionRate: center?.satisfactionRate == null ? null : Number(center.satisfactionRate),
    myRating: center?.myRating == null ? null : Number(center.myRating),
    mySatisfaction: center?.mySatisfaction || null,
    services: compactServices(center?.services)
  };
}

async function readCatalog(token) {
  const raw = await AsyncStorage.getItem(getCatalogKey(token));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(sanitizeCenter) : [];
  } catch {
    return [];
  }
}

async function clearAppCache() {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const appKeys = allKeys.filter(
      (k) => k.startsWith("sante_aproxmite_") || k.startsWith("sante_aproxmite_cache_")
    );
    if (appKeys.length) await AsyncStorage.multiRemove(appKeys);
  } catch {}
}

async function writeCatalog(token, centers) {
  const payload = JSON.stringify(Array.isArray(centers) ? centers.map(sanitizeCenter) : []);
  try {
    await AsyncStorage.setItem(getCatalogKey(token), payload);
  } catch (err) {
    const isFull =
      String(err?.message || "").toLowerCase().includes("sqlite_full") ||
      String(err?.message || "").toLowerCase().includes("database or disk is full") ||
      err?.code === 13;
    if (isFull) {
      // Clear stale cache then retry once
      await clearAppCache();
      await AsyncStorage.setItem(getCatalogKey(token), payload);
    } else {
      throw err;
    }
  }
}

async function getMetaValue(key) {
  return AsyncStorage.getItem(getMetaStorageKey(key));
}

async function setMetaValue(key, value) {
  await AsyncStorage.setItem(getMetaStorageKey(key), String(value || ""));
}

export async function getCenterCatalogMeta(key) {
  return getMetaValue(key);
}

export async function setCenterCatalogMeta(key, value) {
  return setMetaValue(key, value);
}

export { META_KEY_INITIAL_LOAD_NOTIFIED };

export async function getCatalogDownloadConsent() {
  return getMetaValue(META_KEY_DOWNLOAD_CONSENT);
}

export async function setCatalogDownloadConsent(value) {
  return setMetaValue(META_KEY_DOWNLOAD_CONSENT, value);
}

function askCatalogDownloadConsent() {
  return new Promise((resolve) => {
    Alert.alert(
      "Charger les donnees en local ?",
      "Pour un acces plus rapide et disponible hors ligne, l'application peut telecharger la liste complete des centres de sante sur cet appareil. Vous pourrez ensuite actualiser a tout moment pour recuperer les nouveautes.",
      [
        { text: "Non merci", style: "cancel", onPress: () => resolve(false) },
        { text: "Charger", onPress: () => resolve(true) }
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

export async function ensureCatalogDownloaded(token, { forcePrompt = false } = {}) {
  const existing = await loadCenterCatalog(token);
  if (Array.isArray(existing.centers) && existing.centers.length > 0) {
    return existing;
  }

  const consent = await getCatalogDownloadConsent();
  if (consent !== "granted") {
    if (consent === "declined" && !forcePrompt) return existing;
    const accepted = await askCatalogDownloadConsent();
    await setCatalogDownloadConsent(accepted ? "granted" : "declined");
    if (!accepted) return existing;
  }

  return syncCenterCatalog(token, { forceFull: true });
}

export async function loadCenterCatalog(token) {
  const centers = await readCatalog(token);
  return {
    centers: centers.filter((center) => center?.isActive !== false),
    lastSyncAt: await getMetaValue(META_KEY_LAST_SYNC)
  };
}

export async function saveCenterCatalog(token, payload) {
  const centers = Array.isArray(payload?.centers) ? payload.centers.map(sanitizeCenter) : [];
  await writeCatalog(token, centers);
  await setMetaValue(META_KEY_LAST_SYNC, payload?.lastSyncAt || new Date().toISOString());
}

export async function syncCenterCatalog(token, { forceFull = false } = {}) {
  const lastSyncAt = forceFull ? null : await getMetaValue(META_KEY_LAST_SYNC);
  const path = lastSyncAt
    ? `/centers/sync?since=${encodeURIComponent(lastSyncAt)}`
    : "/centers/sync";

  const result = await apiFetch(path, { token });
  const incomingCenters = Array.isArray(result?.centers) ? result.centers.map(sanitizeCenter) : [];

  if (!lastSyncAt) {
    await writeCatalog(token, incomingCenters);
  } else {
    const existingCenters = await readCatalog(token);
    const byId = new Map(existingCenters.map((center) => [String(center._id), center]));
    for (const center of incomingCenters) {
      byId.set(String(center._id), center);
    }
    await writeCatalog(token, Array.from(byId.values()));
  }

  const serverTime = result?.serverTime || new Date().toISOString();
  await setMetaValue(META_KEY_LAST_SYNC, serverTime);
  const catalog = await loadCenterCatalog(token);
  return {
    ...catalog,
    changedCount: incomingCenters.length,
    wasFullSync: !lastSyncAt,
    serverTime
  };
}

export async function updateCachedCenter(token, centerId, patch) {
  const existingCenters = await readCatalog(token);
  const nextCenters = existingCenters.map((center) =>
    String(center?._id || "") === String(centerId || "")
      ? sanitizeCenter({
          ...center,
          myRating: patch?.myRating ?? center?.myRating ?? null,
          mySatisfaction: patch?.mySatisfaction ?? center?.mySatisfaction ?? null
        })
      : center
  );
  await writeCatalog(token, nextCenters);
  return loadCenterCatalog(token);
}
