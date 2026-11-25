"use client";
import {useEffect,useMemo,useState} from "react";
import {baseMapColor} from "@/lib/base-map-color";
import {apiFetch} from "@/lib/api-client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Select} from "@/components/ui/select";
import {Alert} from "@/components/ui/alert";
import type {ServiceBase} from "./ServiceBasesTab";
type Zone={id:string;name:string;base_id:string;base_name:string;geometry:unknown;is_active:boolean;is_test:boolean};
type Policy={maxAgeSeconds:number;maxAccuracyMeters:number;maxReportsPerMinute:number;duplicateWindowMinutes:number;duplicateDistanceMeters:number};
type Account={id:string;fullName:string;role:string};
type Grant={user_id:string;coordinate_all:boolean;coordinate_base_ids:string[];supervisor_base_ids:string[]};
const policyLabels:Record<keyof Policy,string>={maxAgeSeconds:"Ancienneté GPS maximale (secondes)",maxAccuracyMeters:"Précision GPS maximale (mètres)",maxReportsPerMinute:"Envois maximum par minute et déclarant",duplicateWindowMinutes:"Fenêtre de détection des doublons (minutes)",duplicateDistanceMeters:"Distance de détection des doublons (mètres)"};
export function IncidentConfiguration({token}:{token:string}) {
  const [bases,setBases]=useState<ServiceBase[]>([]),[zones,setZones]=useState<Zone[]>([]),[users,setUsers]=useState<Account[]>([]),[grants,setGrants]=useState<Grant[]>([]);
  const [policy,setPolicy]=useState<Policy|null>(null),[error,setError]=useState(""),[success,setSuccess]=useState(""),[busy,setBusy]=useState(false);
  const [rights,setRights]=useState({userId:"",coordinateAll:false,coordinateBaseIds:[] as string[],supervisorBaseIds:[] as string[]});
  const zoneGroups=useMemo(()=>{
    const groups=new Map<string,{id:string;name:string;base?:ServiceBase;zones:Zone[]}>();
    for(const z of zones){const id=String(z.base_id);let group=groups.get(id);if(!group){const base=bases.find(b=>String(b.id)===id);group={id,name:base?.name||z.base_name||`Base ${id}`,base,zones:[]};groups.set(id,group);}group.zones.push(z);}
    return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,"fr")).map(g=>({...g,zones:[...g.zones].sort((a,b)=>a.name.localeCompare(b.name,"fr"))}));
  },[zones,bases]);
  async function load(){try{const [b,z,p,u,g]=await Promise.all([apiFetch<ServiceBase[]>("/service-bases",{token}),apiFetch<Zone[]>("/incidents/zones",{token}),apiFetch<Policy>("/incidents/policy",{token}),apiFetch<Account[]>("/users",{token}),apiFetch<Grant[]>("/incidents/access",{token})]);setBases(b);setZones(z);setPolicy(p);setUsers(u);setGrants(g);}catch(e){setError(e instanceof Error?e.message:"Chargement impossible");}}
  useEffect(()=>{void load();const refresh=()=>{void load();};window.addEventListener("incident-zones-updated",refresh);return()=>window.removeEventListener("incident-zones-updated",refresh);},[token]);
  async function save(action:()=>Promise<unknown>,message:string){setError("");setSuccess("");setBusy(true);try{await action();window.dispatchEvent(new Event("incident-zones-updated"));setSuccess(message);await load();}catch(e){setError(e instanceof Error?e.message:"Échec");}finally{setBusy(false);}}
  function selectUser(id:string){const g=grants.find(x=>String(x.user_id)===id);setRights({userId:id,coordinateAll:g?.coordinate_all||false,coordinateBaseIds:(g?.coordinate_base_ids||[]).map(String),supervisorBaseIds:(g?.supervisor_base_ids||[]).map(String)});}
  function toggle(key:"coordinateBaseIds"|"supervisorBaseIds",id:string){setRights(r=>({...r,[key]:r[key].includes(id)?r[key].filter(x=>x!==id):[...r[key],id]}));}
  return <div className="mt-6 flex flex-col gap-5 border-t pt-5">
    <h2 className="text-xl font-bold">Zones d’intervention, GPS et coordination</h2>
    <p className="text-sm">Sélectionnez les territoires d’intervention sur la carte ci-dessus. L’affectation utilise les zones enregistrées ci-dessous. Le nom de ville et l’ancien rayon des bases ne déterminent plus l’accès aux signalements. Aucun périmètre officiel n’est fourni. Hors zone, chevauchement entre centres ou centre inactif : file « À affecter ».</p>
    {error?<Alert variant="error">{error}</Alert>:null}{success?<Alert variant="success">{success}</Alert>:null}
    {policy?<form className="grid gap-3 rounded-xl border bg-white p-5 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void save(()=>apiFetch("/incidents/policy",{token,method:"PUT",body:policy}),"Paramètres GPS et protection contre les répétitions enregistrés.");}}>
      <h3 className="col-span-full font-bold">Validation des signalements</h3>
      {(Object.keys(policyLabels) as (keyof Policy)[]).map(key=><label key={key} className="text-sm">{policyLabels[key]}<Input required type="number" step={key==="maxAccuracyMeters"?"any":"1"} value={policy[key]} onChange={e=>setPolicy(p=>p?{...p,[key]:Number(e.target.value)}:p)}/></label>)}
      <Button disabled={busy} className="col-span-full">Enregistrer les seuils</Button>
    </form>:null}
    <section aria-label="Zones d’intervention par base" className="space-y-4">
      <h3 className="text-lg font-bold">Zones d’intervention par base</h3>
      {zoneGroups.map(group=><section key={group.id} aria-labelledby={`zone-base-${group.id}`} className="overflow-hidden rounded-xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-5 py-4"><div><h4 id={`zone-base-${group.id}`} className="font-bold"><span aria-hidden="true" style={{color:baseMapColor(group.id)}}>●</span> {group.name}</h4>{group.base?<p className="text-sm text-slate-600">{group.base.serviceType.replaceAll("_"," ")} · {group.base.city} · {group.base.isActive?"Base active":"Base inactive"}</p>:null}</div><p className="text-sm text-slate-600">{group.zones.length} zone(s) · {group.zones.filter(z=>z.is_active).length} active(s)</p></div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">{group.zones.map(z=><div key={z.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><strong>{z.name}</strong><p className="text-sm text-slate-600">{z.is_active?"Active":"Inactive"}{z.is_test?" · FICTIVE — TEST":""}</p></div><Button disabled={busy} variant="outline" onClick={()=>void save(()=>apiFetch(`/incidents/zones/${z.id}`,{token,method:"PUT",body:{name:z.name,baseId:z.base_id,geometry:z.geometry,isActive:!z.is_active,isTest:z.is_test}}),z.is_active?"Zone désactivée.":"Zone activée.")}>{z.is_active?"Désactiver la zone":"Activer la zone"}</Button></div>)}</div>
      </section>)}
      {!zoneGroups.length?<p className="text-sm text-slate-600">Aucune zone enregistrée. Sélectionnez les territoires sur la carte pour les affecter à une base.</p>:null}
    </section>
    <form className="grid gap-3 rounded-xl border bg-white p-5" onSubmit={e=>{e.preventDefault();void save(()=>apiFetch(`/incidents/access/${rights.userId}`,{token,method:"PUT",body:rights}),"Droits de coordination et de responsable enregistrés explicitement.");}}>
      <h3 className="font-bold">Droits de coordination et responsables de centre</h3>
      <label>Compte<Select required value={rights.userId} onChange={e=>selectUser(e.target.value)}><option value="">Choisir un compte</option>{users.map(u=><option key={u.id} value={u.id}>{u.fullName} · {u.role}</option>)}</Select></label>
      <label><input type="checkbox" checked={rights.coordinateAll} onChange={e=>setRights(r=>({...r,coordinateAll:e.target.checked}))}/> Coordination de tous les centres, y compris la file « À affecter »</label>
      <div className="grid gap-2 sm:grid-cols-2">{bases.map(b=><div key={b.id} className="rounded-lg border p-3 text-sm"><strong>{b.name}</strong><p>{b.serviceType} · {b.city}</p>
        <label className="block"><input type="checkbox" checked={rights.coordinateBaseIds.includes(b.id)} onChange={()=>toggle("coordinateBaseIds",b.id)}/> Coordination de ce centre</label>
        <label className="block"><input type="checkbox" checked={rights.supervisorBaseIds.includes(b.id)} onChange={()=>toggle("supervisorBaseIds",b.id)}/> Responsable de ce centre (rattachement obligatoire)</label>
      </div>)}</div>
      <p className="text-xs">La coordination autorise consultation et transfert dans son périmètre. Un responsable rattaché à son centre peut transférer un dossier ou autoriser un renfort. La gestion des bases seule ne donne pas accès aux signalements.</p>
      <Button disabled={busy||!rights.userId}>Enregistrer les droits</Button>
    </form>
  </div>;
}
