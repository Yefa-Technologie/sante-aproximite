"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { hasAnyRole } from "@/lib/roles";

type QuotaAlert = {
  id: string;
  model: string;
  route: string;
  last_seen_at: string;
  occurrence_count: number;
  notified_at: string | null;
};

export function AssistantQuotaNotice() {
  const { user, token } = useAuthStore();
  const authorized = hasAnyRole(user, ["DEVELOPER", "NATIONAL", "REGULATOR"]);
  const [result, setResult] = useState<{ token: string; alerts: QuotaAlert[] } | null>(null);

  useEffect(() => {
    if (!authorized || !token) return;
    let active = true;
    async function refresh() {
      try {
        const data = await apiFetch<{ alerts: QuotaAlert[] }>("/assistant/admin/alerts", { token });
        if (active) setResult({ token: token!, alerts: data.alerts.filter((entry) => Date.now() - Date.parse(entry.last_seen_at) < 24 * 60 * 60 * 1000) });
      } catch { /* A monitoring failure must not prevent dashboard access. */ }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60000);
    return () => { active = false; clearInterval(timer); };
  }, [authorized, token]);

  if (!authorized || !token || result?.token !== token || !result.alerts.length) return null;
  return (
    <details className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:px-6">
      <summary className="cursor-pointer font-semibold" role="status">
        Assistant IA : dépassement de quota Gemini signalé — {result.alerts.length} incident(s) dans les dernières 24 heures
      </summary>
      <p className="mt-2 text-xs">Vérifiez les quotas dans Google AI Studio. Les utilisateurs mobiles voient uniquement un message d’indisponibilité.</p>
      <ul className="mt-2 space-y-2">
        {result.alerts.map((entry) => <li key={entry.id} className="rounded border border-amber-200 bg-white/60 p-2 text-xs">
          <strong>{entry.model}</strong> · {entry.route} · {entry.occurrence_count} refus · {new Date(entry.last_seen_at).toLocaleString("fr-FR")}
          <span className="block">{entry.notified_at ? "Courriel transmis au serveur SMTP." : "Courriel non envoyé : vérifiez la configuration SMTP. Cet incident reste enregistré ici."}</span>
        </li>)}
      </ul>
    </details>
  );
}
