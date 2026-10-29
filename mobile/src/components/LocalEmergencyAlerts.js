import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { apiFetch } from "../api/client";
import { subscribeLocalEmergencyNotifications } from "../notifications";
import { C } from "../theme";

const statusLabel = { NEW: "Signalée", ACKNOWLEDGED: "Prise en charge", EN_ROUTE: "Équipe en route", ON_SITE: "Équipe sur place" };
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Localisation trop longue. Réessayez dans une zone dégagée.")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export function LocalEmergencyAlerts({ token, userId }) {
  const consentKey = `sante_local_emergency_${userId}`;
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(20);
  const active = useRef(true);
  const operation = useRef(false);
  const lastPosition = useRef(0);
  const enabledRef = useRef(false);

  const request = (path, options = {}) => apiFetch(`/emergency-reports/${path}`, { token, queueOffline: false, cache: false, ...options });
  async function disable() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try {
      await request("location", { method: "DELETE" });
      await AsyncStorage.removeItem(consentKey);
      if (active.current) { enabledRef.current = false; setEnabled(false); setAlerts([]); lastPosition.current = 0; }
    } catch (e) { if (active.current) setError(e.message); }
    finally { operation.current = false; if (active.current) setBusy(false); }
  }
  async function refresh({ activate = false, force = false } = {}) {
    if (operation.current || AppState.currentState !== "active") return;
    operation.current = true; if (active.current) setBusy(true);
    try {
      if (activate || force || Date.now() - lastPosition.current > 5 * 60000) {
        const permission = activate ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          // Stop server targeting when the permission has been revoked.
          if (enabledRef.current) await request("location", { method: "DELETE" });
          await AsyncStorage.removeItem(consentKey);
          if (active.current) { enabledRef.current = false; setEnabled(false); setAlerts([]); }
          throw new Error("Activez la localisation pour recevoir les alertes de votre ville et des environs.");
        }
        const position = await bounded(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 20000);
        let cityName = "";
        try { cityName = (await bounded(Location.reverseGeocodeAsync(position.coords), 5000))[0]?.city || ""; } catch {}
        if (!active.current) return;
        await request("location", { method: "PUT", body: { latitude: position.coords.latitude, longitude: position.coords.longitude, city: cityName } });
        lastPosition.current = Date.now();
        await AsyncStorage.setItem(consentKey, "enabled");
        if (!active.current) return;
        enabledRef.current = true; setEnabled(true); setCity(cityName);
      }
      const data = await request("local-alerts");
      if (!active.current) return;
      if (data.needsLocation) { lastPosition.current = 0; setAlerts([]); throw new Error("Actualisez votre position pour recevoir les alertes locales."); }
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []); setRadius(data.radiusKm || 20); setCity(data.city || ""); setError("");
    } catch (e) { if (active.current) setError(e.message || "Impossible d’actualiser les alertes. Vérifiez votre connexion Internet."); }
    finally { operation.current = false; if (active.current) setBusy(false); }
  }
  useEffect(() => {
    active.current = true;
    AsyncStorage.getItem(consentKey).then((value) => {
      if (!active.current) return;
      enabledRef.current = value === "enabled"; setEnabled(value === "enabled"); setReady(true);
      if (value === "enabled") void refresh({ force: true });
    }).catch(() => { if (active.current) setReady(true); });
    const tick = () => { if (enabledRef.current) void refresh(); };
    const timer = setInterval(tick, 30000);
    const app = AppState.addEventListener("change", (state) => { if (state === "active") tick(); });
    const unsubscribe = subscribeLocalEmergencyNotifications(() => { if (active.current) { setOpen(true); tick(); } });
    return () => { active.current = false; clearInterval(timer); app.remove(); unsubscribe(); };
  }, []);

  if (!ready) return null;
  return <>
    <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ marginHorizontal: 12, marginVertical: 5, padding: 10, borderRadius: 10, backgroundColor: alerts.length ? C.redLight : C.primaryLight }}>
      <Text accessibilityLiveRegion="polite" style={{ color: alerts.length ? C.red : C.primary, fontWeight: "700" }}>
        {alerts.length ? `🔔 ${alerts.length} urgence(s) sanitaire(s) près de vous` : enabled ? "🔔 Alertes sanitaires de proximité" : "🔔 Activer les alertes sanitaires de proximité"}
      </Text>
      {error ? <Text style={{ color: C.red }}>Alertes non actualisées · toucher pour réessayer</Text> : null}
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
          <Pressable onPress={() => setOpen(false)}><Text style={{ color: C.primary, fontWeight: "700" }}>‹ Retour</Text></Pressable>
          <Text style={{ fontSize: 23, fontWeight: "800", color: C.textDark }}>Alertes sanitaires à proximité</Text>
          <Text style={{ color: C.textMed }}>Signalements actifs des dernières 24 heures, dans votre ville ou à moins de {radius} km. Votre position récente sert à sélectionner les alertes ; elle doit être actualisée lorsque vous changez de ville.</Text>
          {city ? <Text style={{ color: C.textMed }}>Votre ville : {city}</Text> : null}
          {!enabled ? <>
            <Text style={{ color: C.textMed }}>Activez la localisation pour recevoir les alertes locales. Sans ville identifiée, la sélection utilise uniquement la distance GPS.</Text>
            <Pressable disabled={busy} onPress={() => refresh({ activate: true })} style={{ backgroundColor: C.primary, padding: 14, borderRadius: 10 }}><Text style={{ color: "white", fontWeight: "700" }}>Activer les alertes locales</Text></Pressable>
          </> : <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18 }}>
            <Pressable disabled={busy} onPress={() => refresh({ force: true })}><Text style={{ color: C.primary, fontWeight: "700" }}>Actualiser ma position</Text></Pressable>
            <Pressable disabled={busy} onPress={disable}><Text style={{ color: C.red }}>Désactiver les alertes locales</Text></Pressable>
          </View>}
          {busy ? <ActivityIndicator color={C.primary} /> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: C.red }}>{error}</Text> : null}
          {enabled && !busy && !error && !alerts.length ? <Text>Aucune urgence sanitaire active dans votre zone.</Text> : null}
          {enabled && !error ? alerts.map((a) => <View key={a.id} style={{ padding: 16, backgroundColor: "white", borderRadius: 12, gap: 7 }}>
            <Text style={{ fontWeight: "800", color: C.red }}>Urgence sanitaire signalée</Text>
            <Text>{a.sameCity ? "Dans votre ville" : `À environ ${a.distanceKm} km à vol d’oiseau`}{a.city ? ` · ${a.city}` : ""}</Text>
            <Text>{statusLabel[a.status] || "Signalée"} · {new Date(a.createdAt).toLocaleString("fr-FR")}</Text>
          </View>) : null}
          <Text style={{ color: C.textMuted }}>Une connexion Internet est nécessaire pour actualiser ces alertes. En cas d’urgence, contactez les secours.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}
