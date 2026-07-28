import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "./src/context/AuthContext";
import { Root } from "./src/Root";

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Root />
    </AuthProvider>
  );
}
