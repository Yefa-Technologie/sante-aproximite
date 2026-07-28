import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const FALLBACK_API_URL = "http://193.168.173.181:8081/api";
const API_URL_CANDIDATES = [
  Constants?.expoConfig?.extra?.apiUrl,
  Constants?.manifest?.extra?.apiUrl,
  Constants?.manifest2?.extra?.expoClient?.extra?.apiUrl,
  process.env.EXPO_PUBLIC_API_URL,
  process.env.EXPO_PUBLIC_API_URL_DEV,
  process.env.EXPO_PUBLIC_API_URL_PROD,
  FALLBACK_API_URL
]
  .map((value) => String(value || "").trim().replace(/\/+$/, ""))
  .filter(Boolean)
  .filter((value, index, array) => array.indexOf(value) === index);
const OFFLINE_QUEUE_KEY = "sante_aproxmite_offline_queue";
const TOKEN_KEY = "sante_aproxmite_token";
const REFRESH_TOKEN_KEY = "sante_aproxmite_refresh_token";
const USER_KEY = "sante_aproxmite_user";
const CACHE_PREFIX = "sante_aproxmite_cache_";
const CACHE_TTL_MS = 15 * 60 * 1000;

function isAuthPath(path) {
  return (
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/register") ||
    path.startsWith("/auth/refresh") ||
    path.startsWith("/auth/mobile-user-session")
  );
}

function isNetworkFailure(error) {
  return error?.name === "AbortError" || error?.message === "Network request failed";
}

function normalizeError(error) {
  if (error?.name === "AbortError") {
    const err = new Error("Certaines informations ne sont pas disponibles pour le moment. Reessayez plus tard.");
    err.code = "UPSTREAM_TIMEOUT";
    return err;
  }
  if (error?.message === "Network request failed") {
    const err = new Error("Certaines informations ne peuvent pas etre mises a jour pour le moment.");
    err.code = "NETWORK_UNREACHABLE";
    return err;
  }
  return error;
}

function toCacheKey(path, token) {
  const tokenKey = token ? token.slice(0, 12) : "public";
  return `${CACHE_PREFIX}${encodeURIComponent(tokenKey)}_${encodeURIComponent(path)}`;
}

async function requestApi(path, { token, method = "GET", body, timeoutMs = 15000 } = {}) {
  let lastError = null;

  for (const baseUrl of API_URL_CANDIDATES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });

      const rawText = await response.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        let message = data.message || "";
        if (!message && response.status === 404) {
          message = `Service indisponible: endpoint introuvable (${path}). Verifiez que le backend est a jour.`;
        }
        if (!message && response.status >= 500) {
          message = "Erreur serveur. Reessayez dans quelques instants.";
        }
        if (!message && response.status === 401) {
          message = "Session invalide ou expiree. Reconnectez-vous.";
        }
        if (!message && response.status === 403) {
          message = "Acces refuse pour cette action.";
        }
        const err = new Error(message || "Erreur API");
        err.status = response.status;
        throw err;
      }

      return data;
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error)) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Impossible de contacter le serveur");
}

let refreshingPromise = null;

async function refreshSessionIfPossible() {
  if (!refreshingPromise) {
    refreshingPromise = (async () => {
      const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) return null;

      const payload = await requestApi("/auth/refresh", {
        method: "POST",
        body: { refreshToken },
        timeoutMs: 10000
      });

      if (!payload?.token) return null;
      await AsyncStorage.multiSet([
        [TOKEN_KEY, payload.token],
        [REFRESH_TOKEN_KEY, payload.refreshToken || ""],
        [USER_KEY, JSON.stringify(payload.user || null)]
      ]);

      return payload.token;
    })().finally(() => {
      refreshingPromise = null;
    });
  }

  return refreshingPromise;
}

async function loadCached(path, token) {
  const raw = await AsyncStorage.getItem(toCacheKey(path, token));
  if (!raw) return null;

  const payload = JSON.parse(raw);
  if (!payload?.savedAt) return payload?.data ?? null;

  if (Date.now() - payload.savedAt > CACHE_TTL_MS) return null;
  return payload.data;
}

async function saveCached(path, token, data) {
  await AsyncStorage.setItem(
    toCacheKey(path, token),
    JSON.stringify({
      savedAt: Date.now(),
      data
    })
  );
}

async function enqueueOfflineRequest(path, { token, method, body }) {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  const queue = raw ? JSON.parse(raw) : [];
  queue.push({
    path,
    token: token || "",
    method,
    body: body || null,
    createdAt: new Date().toISOString()
  });
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

export function trackEvent(module, action, metadata) {
  Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(USER_KEY),
  ])
    .then(([token, userRaw]) => {
      let role = null;
      try { role = JSON.parse(userRaw || "null")?.role || null; } catch {}
      return requestApi("/analytics/event", {
        token: token || undefined,
        method: "POST",
        body: { module, action, role, metadata: metadata || undefined },
        timeoutMs: 5000,
      });
    })
    .catch(() => {});
}

export async function clearLocalCache() {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const appKeys = allKeys.filter(
      (k) =>
        k.startsWith("sante_aproxmite_") ||
        k.startsWith(CACHE_PREFIX)
    );
    if (appKeys.length) await AsyncStorage.multiRemove(appKeys);
  } catch {}
}

export async function getPendingRequests() {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function getPendingRequestsCount() {
  const queue = await getPendingRequests();
  return queue.length;
}

export async function syncPendingRequests() {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  const queue = raw ? JSON.parse(raw) : [];
  if (!queue.length) return 0;

  const remaining = [];

  for (const item of queue) {
    try {
      await requestApi(item.path, {
        token: item.token || undefined,
        method: item.method,
        body: item.body,
        timeoutMs: 10000
      });
    } catch (error) {
      if (isNetworkFailure(error)) {
        remaining.push(item);
        continue;
      }
    }
  }

  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  return queue.length - remaining.length;
}

export async function apiFetch(path, { token, method = "GET", body } = {}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const persistedToken = token ? await AsyncStorage.getItem(TOKEN_KEY) : "";
  const effectiveToken = persistedToken || token;

  try {
    const data = await requestApi(path, { token: effectiveToken, method: normalizedMethod, body });
    if (normalizedMethod === "GET") {
      await saveCached(path, effectiveToken, data);
    }
    return data;
  } catch (error) {
    if (
      error?.status === 401 &&
      effectiveToken &&
      !isAuthPath(path)
    ) {
      try {
        const renewedToken = await refreshSessionIfPossible();
        if (renewedToken) {
          const retried = await requestApi(path, { token: renewedToken, method: normalizedMethod, body });
          if (normalizedMethod === "GET") {
            await saveCached(path, renewedToken, retried);
          }
          return retried;
        }
      } catch {
        // Continue to existing flow.
      }
    }

    if (normalizedMethod === "GET" && isNetworkFailure(error)) {
      const cached = await loadCached(path, effectiveToken);
      if (cached !== null) return cached;
    }

    if (normalizedMethod !== "GET" && isNetworkFailure(error) && !isAuthPath(path)) {
      await enqueueOfflineRequest(path, { token, method: normalizedMethod, body });
      return {
        queued: true,
        offline: true,
        message: "Action enregistree hors ligne. Synchronisation automatique des que la connexion revient."
      };
    }

    throw normalizeError(error);
  }
}
