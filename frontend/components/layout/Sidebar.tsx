"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  MapPin,
  Siren,
  FileText,
  Lightbulb,
  BarChart3,
  Hospital,
  Ambulance,
  Settings,
  Upload,
  Shield,
  LineChart,
  HelpCircle,
  Info,
  Star,
  Users,
  ShieldAlert,
  LogOut,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/auth-store";
import { getNavItems, getRoleChipLabel } from "@/lib/roles";

const ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  "map-pin": MapPin,
  siren: Siren,
  "file-text": FileText,
  lightbulb: Lightbulb,
  "bar-chart-3": BarChart3,
  hospital: Hospital,
  ambulance: Ambulance,
  settings: Settings,
  upload: Upload,
  shield: Shield,
  "line-chart": LineChart,
  "help-circle": HelpCircle,
  info: Info,
  star: Star,
  users: Users,
  "shield-alert": ShieldAlert,
  user: UserRound,
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const navItems = getNavItems(user);
  const roleChip = getRoleChipLabel(user);

  const sections = navItems.reduce<Record<string, typeof navItems>>((acc, item) => {
    acc[item.section] = acc[item.section] || [];
    acc[item.section].push(item);
    return acc;
  }, {});

  function onLogout() {
    logout();
    router.push("/login");
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-black text-white">
          SA
        </div>
        <div>
          <p className="text-sm font-black leading-tight text-slate-900">SANTE APROXMITE</p>
          <p className="text-xs text-slate-400">Gestion sanitaire</p>
        </div>
      </div>

      <Link
        href="/dashboard/profile"
        className={cn(
          "mx-3 my-3 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-slate-100",
          pathname === "/dashboard/profile" && "bg-blue-50"
        )}
        title="Gerer mon profil"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white">
          {(user?.fullName || "?").trim().charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{user?.fullName || "Utilisateur"}</p>
          <span className="text-xs font-bold text-blue-600">{roleChip}</span>
        </div>
      </Link>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section}>
            <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{section}</p>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.icon] || LayoutDashboard;
                const href = `/dashboard/${item.key}`;
                const active = pathname === href;
                return (
                  <Link
                    key={`${section}-${item.key}`}
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900",
                      active && "bg-blue-50 text-blue-700 font-semibold"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-3">
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-4 w-4" /> Deconnexion
        </button>
      </div>
    </aside>
  );
}
