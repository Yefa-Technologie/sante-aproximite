"use client";
import {useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {Button} from "@/components/ui/button";
import {Select} from "@/components/ui/select";
import type {ServiceBase} from "./ServiceBasesTab";

export type Territory={properties:{shapeID:string;shapeName:string};geometry:{type:"Polygon"|"MultiPolygon";coordinates:number[][][]|number[][][][]}};
export default function TerritorySelection({areas,bases,token,onRemove,onCancel,onSaved,onBusyChange}:{areas:Territory[];bases:ServiceBase[];token:string;onRemove:(id:string)=>void;onCancel:()=>void;onSaved:()=>void;onBusyChange:(busy:boolean)=>void}) {
 const [baseId,setBaseId]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(e:React.FormEvent){
  e.preventDefault();if(!areas.length||!baseId||!confirmed||busy)return;
  setBusy(true);onBusyChange(true);setError("");
  try{
   const zones=areas.flatMap(a=>{
    const parts=a.geometry.type==="Polygon"?[a.geometry.coordinates as number[][][]]:a.geometry.coordinates as number[][][][];
    return parts.map((coordinates,i)=>({name:`${a.properties.shapeName}${parts.length>1?` · partie ${i+1}`:""}`,geometry:{type:"Polygon",coordinates}}));
   });
   await apiFetch("/incidents/zones/selection",{token,method:"POST",body:{baseId,isTest:false,zones}});
   window.dispatchEvent(new Event("incident-zones-updated"));onSaved();
  }catch(e){setError(e instanceof Error?e.message:"Enregistrement impossible. Votre sélection est conservée.");}finally{setBusy(false);onBusyChange(false);}
 }
 return <form onSubmit={save} aria-label="Affecter les zones sélectionnées" className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
  <h3 className="font-bold">{areas.length} territoire(s) sélectionné(s)</h3>
  <p className="text-sm text-slate-600">Cliquez sur les territoires pour les ajouter ou les retirer, puis choisissez la base responsable. Vous pouvez en sélectionner jusqu’à 25.</p>
  <div className="flex flex-wrap gap-2">{areas.map(a=><button disabled={busy} key={a.properties.shapeID} type="button" aria-label={`Retirer ${a.properties.shapeName}`} onClick={()=>onRemove(a.properties.shapeID)} className="rounded-full border bg-white px-3 py-1 text-sm">{a.properties.shapeName} ×</button>)}</div>
  <label className="block text-sm">Base responsable<Select aria-label="Base responsable" required disabled={busy} value={baseId} onChange={e=>{setBaseId(e.target.value);setConfirmed(false);}}><option value="">Choisir une base</option>{bases.filter(b=>b.isActive).map(b=><option key={b.id} value={b.id}>{b.name} · {b.serviceType.replaceAll("_"," ")} · {b.city}</option>)}</Select></label>
  <label className="flex items-start gap-2 text-sm"><input required disabled={busy} type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Je confirme que cette base doit couvrir les territoires sélectionnés. Ces zones actives serviront à affecter les nouveaux signalements.</span></label>
  <p className="text-xs text-slate-600">Les zones existantes sont conservées. Une couverture partagée entre plusieurs bases du même service pourra envoyer les incidents dans « À affecter ».</p>
  {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
  <div className="flex flex-wrap gap-2"><Button disabled={busy||!areas.length||!baseId||!confirmed}>{busy?"Enregistrement…":"Enregistrer les zones d’intervention"}</Button><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Annuler la sélection</Button></div>
 </form>;
}
