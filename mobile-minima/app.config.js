// app.config.js
import 'dotenv/config';
import { networkInterfaces } from "os";

function detectLanIp() {
  const nets = networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        candidates.push({ name, address: net.address });
      }
    }
  }
  if (candidates.length === 0) return null;
  const preferred = candidates.find((c) => /wi-?fi|ethernet/i.test(c.name));
  return (preferred || candidates[0]).address;
}

export default ({ config }) => {
  const env = process.env.NODE_ENV || 'development';
  const isProd = env === "production";

  // En dev, l'IP locale de la machine change souvent (reseau Wi-Fi different) : on la
  // detecte automatiquement plutot que de dependre d'une valeur figee dans .env.
  // EXPO_PUBLIC_LAN_IP permet de forcer une IP precise si la detection se trompe.
  const lanIp = !isProd ? (process.env.EXPO_PUBLIC_LAN_IP || detectLanIp()) : null;

  const apiUrl = isProd
    ? (process.env.EXPO_PUBLIC_API_URL_PROD || process.env.EXPO_PUBLIC_API_URL)
    : (lanIp ? `http://${lanIp}:8081/api` : (process.env.EXPO_PUBLIC_API_URL_DEV || process.env.EXPO_PUBLIC_API_URL));
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";

  return {
    ...config,
    name: "Sante Aproximite Lite",
    updates: {
      enabled: false,
    },
    android: {
      ...(config.android || {}),
      package: "com.yefa.sante.lite",
    },
    ios: {
      ...(config.ios || {}),
      bundleIdentifier: "com.yefa.sante.lite",
    },
    extra: {
      ...(config?.extra || {}),
      apiUrl,
      googleMapsApiKey
    }
  };
};
