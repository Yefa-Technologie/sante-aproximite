import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "../api/client";

const MATRIX_KEY = "sante_aproxmite_module_settings_mobile_minima";

export async function loadCachedModuleSettings() {
  try {
    const raw = await AsyncStorage.getItem(MATRIX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveCachedModuleSettings(matrix) {
  try {
    await AsyncStorage.setItem(MATRIX_KEY, JSON.stringify(matrix && typeof matrix === "object" ? matrix : {}));
  } catch {
    // stockage indisponible, on continue sans cache
  }
}

export async function fetchModuleSettings(token) {
  const data = await apiFetch("/settings/modules?appKey=mobile-minima", { token });
  const matrix = data?.matrix && typeof data.matrix === "object" ? data.matrix : {};
  saveCachedModuleSettings(matrix).catch(() => {});
  return matrix;
}
