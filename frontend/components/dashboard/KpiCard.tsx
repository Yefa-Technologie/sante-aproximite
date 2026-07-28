"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCENTS: Record<string, string> = {
  blue: "border-t-blue-500 bg-blue-50 text-blue-600",
  green: "border-t-emerald-500 bg-emerald-50 text-emerald-600",
  red: "border-t-red-500 bg-red-50 text-red-600",
  amber: "border-t-amber-500 bg-amber-50 text-amber-600",
  slate: "border-t-slate-400 bg-slate-100 text-slate-500",
};

export function KpiCard({
  icon: Icon,
  tag,
  value,
  sub,
  detail,
  accent = "blue",
  onClick,
  action,
}: {
  icon: LucideIcon;
  tag: string;
  value: React.ReactNode;
  sub: string;
  detail?: React.ReactNode;
  accent?: keyof typeof ACCENTS;
  onClick?: () => void;
  action?: React.ReactNode;
}) {
  const [borderClass, bgClass] = ACCENTS[accent].split(" ");
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1.5 rounded-2xl border-t-4 bg-white p-5 shadow-sm shadow-slate-200/50 transition-transform",
        borderClass,
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{tag}</span>
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", bgClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="text-4xl font-black leading-tight text-slate-900">{value}</div>
      <p className="text-sm text-slate-500">{sub}</p>
      {action}
      {detail ? <p className="text-xs text-slate-400">{detail}</p> : null}
    </div>
  );
}
