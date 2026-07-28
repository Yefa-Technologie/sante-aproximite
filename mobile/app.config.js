// app.config.js
import 'dotenv/config';

export default ({ config }) => {
  const env = process.env.NODE_ENV || 'development';

  const apiUrl =
    process.env.EXPO_PUBLIC_API_URL ||
    (env === "production"
      ? process.env.EXPO_PUBLIC_API_URL_PROD
      : process.env.EXPO_PUBLIC_API_URL_DEV);
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";

  return {
    ...config,
    name: "Sante Aproximite",
    updates: {
      enabled: false,
    },
    android: {
      ...(config.android || {}),
      package: "com.yefa.sante",
    },
    ios: {
      ...(config.ios || {}),
      bundleIdentifier: "com.yefa.sante",
    },
    extra: {
      ...(config?.extra || {}),
      apiUrl,
      googleMapsApiKey
    }
  };
};
