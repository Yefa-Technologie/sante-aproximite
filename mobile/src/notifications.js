import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { apiFetch } from "./api/client";

// Les notifications push distantes ne sont plus supportees dans Expo Go depuis le SDK 53
// (necessite un development build). Le simple fait d'importer expo-notifications declenche
// un console.error interne dans ce contexte : on evite donc de charger le module tant qu'on
// n'est pas certain de ne pas etre dans Expo Go.
const isExpoGo = Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";

export async function registerForPushNotifications(token) {
  if (!token || !Device.isDevice || isExpoGo) return;

  try {
    const Notifications = require("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!pushToken?.data) return;

    await apiFetch("/push-tokens", { token, method: "POST", body: { token: pushToken.data, appKey: "mobile" } });
  } catch {
    // notifications non critiques : on ignore silencieusement toute erreur
  }
}
