"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, ready, hydrate } = useAuthStore();
  const [verifiedToken, setVerifiedToken] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (ready && !token) router.replace("/login");
  }, [ready, token, router]);

  useEffect(() => {
    if (!ready || !token) return;
    let active = true;
    let checking = false;
    const validate = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        await apiFetch("/auth/profile", { token });
        if (active) { setVerifiedToken(token); setSessionError(""); }
      } catch (error) {
        if (active) {
          setVerifiedToken("");
          setSessionError(error instanceof Error ? error.message : "Impossible de vérifier votre session.");
        }
      } finally { checking = false; }
    };
    void validate();
    const timer = setInterval(() => { void validate(); }, 60000);
    window.addEventListener("focus", validate);
    window.addEventListener("online", validate);
    document.addEventListener("visibilitychange", validate);
    return () => {
      active = false; clearInterval(timer);
      window.removeEventListener("focus", validate);
      window.removeEventListener("online", validate);
      document.removeEventListener("visibilitychange", validate);
    };
  }, [ready, token, retry]);

  if (!ready || !token || verifiedToken !== token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        {sessionError && token ? <div className="max-w-md space-y-4 p-6 text-center">
          <p role="alert">{sessionError}</p>
          <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={() => { setSessionError(""); setRetry((value) => value + 1); }}>Réessayer</button>
        </div> : <Spinner className="h-6 w-6 text-blue-600" />}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
