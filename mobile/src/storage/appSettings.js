import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "../api/client";

const SETTINGS_KEY = "sante_aproxmite_app_settings";
const DEFAULT_SETTINGS = { centerReviewsEnabled: true };

export async function loadCachedAppSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? { ...DEFAULT_SETTINGS, ...parsed } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function saveCachedAppSettings(settings) {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // stockage indisponible, on continue sans cache
  }
}

export async function fetchAppSettings(token) {
  const data = await apiFetch("/settings", { token });
  const settings = { ...DEFAULT_SETTINGS, ...(data || {}) };
  saveCachedAppSettings(settings).catch(() => {});
  return settings;
}
