"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const ROLE_OPTIONS = [
  { value: "USER", label: "Utilisateur" },
  { value: "NATIONAL", label: "National" },
  { value: "REGION", label: "Region" },
  { value: "DISTRICT", label: "District" },
  { value: "ETABLISSEMENT", label: "Etablissement" },
  { value: "SAPEUR_POMPIER", label: "Sapeur-Pompier" },
  { value: "SAMU", label: "SAMU" },
  { value: "POLICE", label: "Police" },
  { value: "GENDARMERIE", label: "Gendarmerie" },
  { value: "PROTECTION_CIVILE", label: "Protection Civile" },
  { value: "DEVELOPER", label: "Developpeur" },
];

export default function RegisterPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "USER",
    establishmentCode: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const data = await apiFetch<{ token?: string; user?: never; pendingApproval?: boolean; message?: string }>(
        "/auth/register",
        { method: "POST", body: form }
      );
      if (data.pendingApproval) {
        setSuccess(data.message || "Compte en attente de validation");
        setForm({ fullName: "", email: "", password: "", role: "USER", establishmentCode: "" });
        return;
      }
      if (data.token && data.user) {
        login({ token: data.token, user: data.user });
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900">Creer un compte</h2>
          <p className="mt-1 text-sm text-slate-500">
            Remplissez le formulaire pour demander votre acces a la plateforme.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-name">Nom complet</Label>
            <Input
              id="reg-name"
              autoComplete="name"
              required
              placeholder="Prenom Nom"
              value={form.fullName}
              onChange={(e) => setField("fullName", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-email">Adresse email</Label>
            <Input
              id="reg-email"
              type="email"
              autoComplete="email"
              required
              placeholder="vous@exemple.com"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-password">Mot de passe</Label>
            <Input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              required
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setField("password", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-role">Role</Label>
            <Select id="reg-role" value={form.role} onChange={(e) => setField("role", e.target.value)}>
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {form.role === "ETABLISSEMENT" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-code">Code de l&apos;etablissement</Label>
              <Input
                id="reg-code"
                required
                placeholder="Ex: ETB-001"
                value={form.establishmentCode}
                onChange={(e) => setField("establishmentCode", e.target.value)}
              />
            </div>
          ) : null}

          {error ? <Alert variant="error">{error}</Alert> : null}
          {success ? <Alert variant="success">{success}</Alert> : null}

          <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full">
            {loading ? "Inscription en cours..." : "S'inscrire"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Deja un compte ?{" "}
          <Link href="/login" className="font-semibold text-blue-600 hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    </main>
  );
}
