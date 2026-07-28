"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Building2, Siren, LineChart, ClipboardList, Lock, Mail } from "lucide-react";

const FEATURES = [
  { icon: Building2, label: "Localisation des centres de sante" },
  { icon: Siren, label: "Gestion des alertes d'urgence" },
  { icon: LineChart, label: "Suivi des performances sanitaires" },
  { icon: ClipboardList, label: "Gestion des plaintes et evaluations" },
];

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: never }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      login(data);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-red-700 via-red-600 to-rose-800 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 left-0 h-80 w-80 rounded-full bg-black/10 blur-3xl" />
        <div className="relative z-10">
          <h1 className="text-4xl font-black leading-tight">
            Sante
            <br />
            Aproximite
          </h1>
          <p className="mt-4 max-w-sm text-red-50/90">
            Plateforme de gestion et de pilotage des etablissements sanitaires de proximite.
          </p>
        </div>
        <div className="relative z-10 flex flex-col gap-3">
          {FEATURES.map((f) => (
            <div key={f.label} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
              <f.icon className="h-5 w-5 shrink-0" />
              <span className="text-sm font-medium">{f.label}</span>
            </div>
          ))}
        </div>
        <p className="relative z-10 text-xs text-red-100/70">
          v1.0.0 · &copy; {new Date().getFullYear()} Sante Aproximite
        </p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:text-left">
            <h2 className="text-2xl font-bold text-slate-900">Bienvenue 👋</h2>
            <p className="mt-1 text-sm text-slate-500">
              Connectez-vous pour acceder a votre espace de gestion sanitaire.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email">Adresse email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="vous@exemple.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Mot de passe</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {error ? <Alert variant="error">{error}</Alert> : null}

            <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full">
              {loading ? "Connexion en cours..." : "Se connecter →"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Pas encore de compte ?{" "}
            <Link href="/register" className="font-semibold text-red-600 hover:underline">
              Creer un compte
            </Link>
          </p>

          <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Lock className="h-3.5 w-3.5" /> Plateforme securisee - acces restreint aux personnels autorises
          </div>
        </div>
      </section>
    </main>
  );
}
