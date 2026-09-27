"use client";

import { useState } from "react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { ChevronDown, HelpCircle, Mail } from "lucide-react";

const FAQ = [
  { q: "Comment trouver un centre de sante proche ?", a: "Depuis 'Centres de sante', autorisez la localisation puis lancez une recherche : les centres les plus proches s'affichent sur la carte et en liste, avec filtres par nom, service ou plateau technique." },
  { q: "Comment gerer les plaintes ?", a: "Les regulateurs peuvent prendre en compte, rejeter ou resoudre une plainte depuis 'Gestion des plaintes'. Les chefs d'etablissement peuvent y ajouter une explication." },
  { q: "Comment signaler une urgence ?", a: "Les urgences sont signalees depuis l'application mobile. Ici, le personnel SAMU/Pompiers/Police les traite depuis 'Alertes urgence' ou 'Alertes securite'." },
  { q: "Comment gerer mon centre en tant que chef d'etablissement ?", a: "Depuis 'Mon centre', entrez le code de votre etablissement s'il existe deja, ou creez-en un nouveau. Vous pouvez ensuite gerer les places disponibles par service sans repasser par une validation centrale." },
  { q: "Comment fonctionnent les orientations de patients ?", a: "Un professionnel oriente un patient vers votre centre depuis l'application mobile. Vous le voyez apparaitre dans 'Orientations patients' et confirmez sa reception en un clic." },
  { q: "Qui peut valider un nouveau centre de sante ?", a: "Les comptes regulateurs (national/region/district) valident les centres crees par les etablissements avant qu'ils n'apparaissent publiquement." },
];

export default function HelpPage() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={HelpCircle} title="Aide & FAQ" subtitle="Trouvez rapidement les reponses a vos questions" />

      <div className="flex flex-col gap-2">
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <button
              key={item.q}
              onClick={() => setOpen(isOpen ? null : i)}
              className={`rounded-2xl border p-4 text-left shadow-sm transition-colors ${
                isOpen ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800">{item.q}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </div>
              {isOpen ? <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.a}</p> : null}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl bg-blue-950 p-6 text-center text-white">
        <p className="text-sm font-semibold text-blue-100">Pas de reponse a votre question ?</p>
        <a
          href="mailto:yefa.technologie@gmail.com"
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-900"
        >
          <Mail className="h-4 w-4" /> Contacter le support
        </a>
      </div>
    </div>
  );
}
