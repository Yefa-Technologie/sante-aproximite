"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Shield, Trash2 } from "lucide-react";

type RbacRole = { id: string; name: string; description: string; permissions: string[]; user_ids: string[] };
type UserLite = { id: string; fullName: string; email: string };
type Permission = { key: string; section: string; label: string; desc: string };

function groupBySection(permissions: Permission[]) {
  const groups = new Map<string, Permission[]>();
  for (const p of permissions) {
    if (!groups.has(p.section)) groups.set(p.section, []);
    groups.get(p.section)!.push(p);
  }
  return [...groups.entries()];
}

export default function RolesPage() {
  const { token } = useAuthStore();
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setError("");
    try {
      const [r, p, u] = await Promise.all([
        apiFetch<RbacRole[]>("/rbac/roles", { token }),
        apiFetch<Permission[]>("/rbac/permissions", { token }),
        apiFetch<UserLite[]>("/users", { token }).catch(() => []),
      ]);
      setRoles(r);
      setPermissions(p);
      setUsers(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function togglePerm(p: string) {
    setSelectedPerms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    try {
      await apiFetch("/rbac/roles", { token, method: "POST", body: { name, description, permissions: selectedPerms } });
      setSuccess("Role cree");
      setName(""); setDescription(""); setSelectedPerms([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteRole(id: string) {
    setError(""); setSuccess("");
    try {
      await apiFetch(`/rbac/roles/${id}`, { token, method: "DELETE" });
      setSuccess("Role supprime");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function assignUsers(role: RbacRole, userIds: string[]) {
    setError(""); setSuccess("");
    try {
      await apiFetch(`/rbac/roles/${role.id}/users`, { token, method: "PUT", body: { userIds } });
      setSuccess("Utilisateurs assignes");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={Shield} title="Gestion des roles" subtitle="Roles personnalises et permissions" />

      <form onSubmit={createRole} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input required placeholder="Nom du role" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Textarea readOnly value="" className="hidden" />
        <div className="flex flex-col gap-3">
          {groupBySection(permissions).map(([section, perms]) => (
            <div key={section}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{section}</p>
              <div className="flex flex-wrap gap-2">
                {perms.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    title={p.desc}
                    onClick={() => togglePerm(p.key)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      selectedPerms.includes(p.key) ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Button type="submit" className="w-fit">Creer le role</Button>
      </form>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="flex flex-col gap-3">
        {roles.map((role) => (
          <div key={role.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">{role.name}</p>
                <p className="text-xs text-slate-500">{role.description}</p>
              </div>
              <Button size="sm" variant="danger" onClick={() => deleteRole(role.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {role.permissions.map((key) => (
                <Badge key={key} variant="blue">{permissions.find((p) => p.key === key)?.label || key}</Badge>
              ))}
            </div>
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-slate-400">Utilisateurs assignes ({role.user_ids.length})</p>
              <select
                multiple
                className="h-24 w-full rounded-lg border border-slate-300 p-2 text-xs"
                value={role.user_ids}
                onChange={(e) => assignUsers(role, Array.from(e.target.selectedOptions).map((o) => o.value))}
              >
                {users.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
