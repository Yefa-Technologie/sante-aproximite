import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { apiFetch } from "./api/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
const DEVICE_PUSH_KEY="sante_device_push_token";

// Les notifications push distantes ne sont plus supportees dans Expo Go depuis le SDK 53
// (necessite un development build). Le simple fait d'importer expo-notifications declenche
// un console.error interne dans ce contexte : on evite donc de charger le module tant qu'on
// n'est pas certain de ne pas etre dans Expo Go.
const isExpoGo = Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";
let lastLocalResponseId = null;

export function subscribeLocalEmergencyNotifications(onOpen) {
  if (isExpoGo) return () => {};
  let active = true;
  try {
    const Notifications = require("expo-notifications");
    const handle = (response) => {
      const request = response?.notification?.request;
      if (!active || request?.content?.data?.type !== "LOCAL_EMERGENCY_ALERT" || request.identifier === lastLocalResponseId) return;
      lastLocalResponseId = request.identifier; onOpen();
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    return () => { active = false; sub.remove(); };
  } catch { return () => { active = false; }; }
}

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

    await apiFetch("/push-tokens", { token, method: "POST", queueOffline:false, body: { token: pushToken.data, appKey: "mobile" } });
    await AsyncStorage.setItem(DEVICE_PUSH_KEY,pushToken.data);
  } catch {
    // notifications non critiques : on ignore silencieusement toute erreur
  }
}
export async function unregisterDeviceNotifications(token) {
  const deviceToken=await AsyncStorage.getItem(DEVICE_PUSH_KEY);
  if(!isExpoGo){try{await require("expo-notifications").dismissAllNotificationsAsync();}catch{}}
  if(token&&deviceToken)await apiFetch("/push-tokens",{token,method:"DELETE",body:{token:deviceToken},queueOffline:false,timeoutMs:3000}).catch(()=>{});
  await AsyncStorage.removeItem(DEVICE_PUSH_KEY);
}
