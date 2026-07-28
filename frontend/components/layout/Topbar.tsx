"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { getNavItems } from "@/lib/roles";

export function Topbar() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navItems = getNavItems(user);
  const today = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date());

  function onLogout() {
    logout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-20 flex flex-col border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div>
            <p className="text-sm font-bold text-slate-900">Sante Aproximite Platform</p>
            <p className="hidden text-xs text-slate-400 sm:block">Ecosysteme de pilotage des centres de sante</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-xs font-bold text-slate-700">Ministere de la Sante</p>
            <p className="text-[11px] text-slate-400">Service digital des etablissements</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            {user?.role || "VISITOR"}
          </span>
          <span className="hidden text-xs text-slate-400 md:block">{today}</span>
        </div>
      </div>

      {open ? (
        <div className="flex flex-col gap-1 border-t border-slate-100 px-4 py-3 lg:hidden">
          {navItems.map((item) => {
            const href = `/dashboard/${item.key}`;
            return (
              <Link
                key={item.key}
                href={href}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  pathname === href ? "bg-red-50 text-red-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={onLogout}
            className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" /> Deconnexion
          </button>
        </div>
      ) : null}
    </header>
  );
}
