import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Info, MapPin, FileText, Siren, ShieldAlert, Hospital, Radio } from "lucide-react";

const FEATURES = [
  { icon: MapPin, label: "Carte des centres", sub: "Localisation en temps reel" },
  { icon: FileText, label: "Plaintes", sub: "Soumission et suivi" },
  { icon: Siren, label: "Urgences sanitaires", sub: "SAMU et Pompiers" },
  { icon: ShieldAlert, label: "Urgences securitaires", sub: "Police et Gendarmerie" },
  { icon: Hospital, label: "Espace chef", sub: "Gestion de centre" },
  { icon: Radio, label: "Mode hors ligne", sub: "Synchronisation auto (mobile)" },
];

export default function AboutPage() {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={Info} title="A propos" />

      <div className="rounded-2xl bg-gradient-to-br from-red-700 to-rose-800 p-8 text-center text-white">
        <h2 className="text-2xl font-black">Sante et Securite a Proximite</h2>
        <span className="mt-2 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-bold">v1.0.0</span>
        <p className="mx-auto mt-3 max-w-md text-sm text-red-50/90">
          Plateforme nationale de gestion sanitaire et d&apos;urgences.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Mission</h3>
        <p className="text-sm leading-relaxed text-slate-600">
          Rapprocher les citoyens des services de sante en localisant les centres, coordonnant les urgences et
          garantissant la transparence des soins a travers tout le territoire national.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Fonctionnalites</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.label} className="rounded-xl border border-slate-200 p-3">
              <f.icon className="h-5 w-5 text-red-600" />
              <p className="mt-2 text-sm font-bold text-slate-800">{f.label}</p>
              <p className="text-xs text-slate-500">{f.sub}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Developpeur</h3>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-600 text-sm font-black text-white">
            YT
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">YEFA TECHNOLOGIE</p>
            <a href="mailto:yefa.technologie@gmail.com" className="text-sm font-semibold text-red-600">
              yefa.technologie@gmail.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
