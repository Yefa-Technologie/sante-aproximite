import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { AuthProvider } from "./src/context/AuthContext";
import { Root } from "./src/Root";

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
      <StatusBar style="dark" />
      <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
