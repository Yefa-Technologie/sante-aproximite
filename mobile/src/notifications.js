import * as Device from "expo-device";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiFetch } from "./api/client";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(token) {
  if (!token || !Device.isDevice) return;

  try {
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

    // Les notifications push distantes ne sont plus supportees dans Expo Go depuis le SDK 53
    // (necessite un development build). getExpoPushTokenAsync loggerait une erreur non interceptable.
    if (Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient") return;

    const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!pushToken?.data) return;

    await apiFetch("/push-tokens", { token, method: "POST", body: { token: pushToken.data, appKey: "mobile" } });
  } catch {
    // notifications non critiques : on ignore silencieusement toute erreur
  }
}
