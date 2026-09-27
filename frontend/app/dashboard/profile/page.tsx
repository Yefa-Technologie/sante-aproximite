"use client";

import { useEffect, useState } from "react";
import { UserRound, KeyRound } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { getRoleChipLabel } from "@/lib/roles";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

type Profile = { fullName: string; email: string; phoneNumber: string | null };

function normalizePhone(raw: string) {
  return String(raw || "").replace(/\D/g, "").slice(0, 10);
}

export default function ProfilePage() {
  const { token, user, updateUser } = useAuthStore();
  const [form, setForm] = useState({ fullName: user?.fullName || "", email: user?.email || "", phoneNumber: "" });
  const [initial, setInitial] = useState(form);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [changePassword, setChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<Profile>("/auth/profile", { token })
      .then((data) => {
        if (!active) return;
        const next = { fullName: data.fullName || "", email: data.email || "", phoneNumber: normalizePhone(data.phoneNumber || "") };
        setForm(next);
        setInitial(next);
      })
      .catch((err) => { if (active) setError(err instanceof ApiError ? err.message : "Impossible de charger le profil."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const emailChanged = form.email.trim().toLowerCase() !== initial.email.trim().toLowerCase();
  const needsCurrentPassword = changePassword || (emailChanged && Boolean(initial.email));
  const dirty =
    form.fullName.trim() !== initial.fullName.trim() ||
    form.phoneNumber !== initial.phoneNumber ||
    emailChanged ||
    changePassword;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const fullName = form.fullName.trim();
    if (fullName.length < 2 || fullName.length > 120) return setError("Le nom doit contenir entre 2 et 120 caracteres.");
    if (form.phoneNumber && form.phoneNumber.length !== 10) return setError("Le numero de telephone doit contenir 10 chiffres.");
    if (changePassword) {
      if (passwords.next.length < 6) return setError("Le nouveau mot de passe doit contenir au moins 6 caracteres.");
      if (passwords.next !== passwords.confirm) return setError("La confirmation ne correspond pas au nouveau mot de passe.");
    }
    if (needsCurrentPassword && !passwords.current) return setError("Saisissez votre mot de passe actuel pour confirmer.");

    setSaving(true);
    try {
      const body: Record<string, string> = { fullName, phoneNumber: form.phoneNumber };
      if (form.email.trim()) body.email = form.email.trim();
      if (needsCurrentPassword) body.currentPassword = passwords.current;
      if (changePassword) body.newPassword = passwords.next;

      const data = await apiFetch<Profile>("/auth/profile", { token, method: "PATCH", body });
      const next = { fullName: data.fullName || "", email: data.email || "", phoneNumber: normalizePhone(data.phoneNumber || "") };
      setForm(next);
      setInitial(next);
      updateUser({ fullName: next.fullName, email: next.email });
      setPasswords({ current: "", next: "", confirm: "" });
      setMessage(changePassword ? "Profil et mot de passe mis a jour." : "Votre profil a ete mis a jour.");
      setChangePassword(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const initialLetter = (form.fullName || user?.fullName || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader icon={UserRound} title="Mon profil" subtitle="Consultez et modifiez les informations de votre compte" />

      <Card className="mb-5">
        <CardContent className="flex items-center gap-4 pt-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xl font-black text-white">
            {initialLetter}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-slate-900">{form.fullName || user?.fullName}</p>
            <p className="text-sm font-semibold text-blue-600">{getRoleChipLabel(user)}</p>
          </div>
          {loading ? <Spinner className="ml-auto h-5 w-5 text-blue-600" /> : null}
        </CardContent>
      </Card>

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
            <CardDescription>Votre e-mail sert a vous connecter a la plateforme.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="fullName">Nom complet</Label>
              <Input id="fullName" value={form.fullName} maxLength={120} disabled={loading || saving}
                onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" autoComplete="email" value={form.email} disabled={loading || saving}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Telephone</Label>
              <Input id="phone" inputMode="numeric" placeholder="10 chiffres" value={form.phoneNumber} disabled={loading || saving}
                onChange={(e) => setForm((p) => ({ ...p, phoneNumber: normalizePhone(e.target.value) }))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-blue-600" /> Mot de passe</CardTitle>
              <CardDescription>Votre mot de passe n&apos;est jamais affiche.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm"
              onClick={() => { setChangePassword((v) => !v); setPasswords((p) => ({ ...p, next: "", confirm: "" })); }}>
              {changePassword ? "Annuler" : "Changer"}
            </Button>
          </CardHeader>
          {changePassword ? (
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newPassword">Nouveau mot de passe</Label>
                <Input id="newPassword" type="password" autoComplete="new-password" placeholder="6 caracteres minimum"
                  value={passwords.next} onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmPassword">Confirmer</Label>
                <Input id="confirmPassword" type="password" autoComplete="new-password"
                  value={passwords.confirm} onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))} />
              </div>
            </CardContent>
          ) : null}
        </Card>

        {needsCurrentPassword ? (
          <Card className="border-amber-300">
            <CardHeader>
              <CardTitle>Confirmation</CardTitle>
              <CardDescription>Requis pour modifier l&apos;e-mail ou le mot de passe.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex max-w-sm flex-col gap-1.5">
                <Label htmlFor="currentPassword">Mot de passe actuel</Label>
                <Input id="currentPassword" type="password" autoComplete="current-password"
                  value={passwords.current} onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))} />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {error ? <Alert variant="error">{error}</Alert> : null}
        {message ? <Alert variant="success">{message}</Alert> : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={loading || saving || !dirty}>
            {saving ? "Enregistrement..." : "Enregistrer les modifications"}
          </Button>
        </div>
      </form>
    </div>
  );
}
