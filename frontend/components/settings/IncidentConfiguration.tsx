"use client";
import {useEffect,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Select} from "@/components/ui/select";
import {Textarea} from "@/components/ui/textarea";
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
  const [zone,setZone]=useState({id:"",name:"",baseId:"",geometry:"",isActive:true,isTest:false});
  const [rights,setRights]=useState({userId:"",coordinateAll:false,coordinateBaseIds:[] as string[],supervisorBaseIds:[] as string[]});
  async function load(){try{const [b,z,p,u,g]=await Promise.all([apiFetch<ServiceBase[]>("/service-bases",{token}),apiFetch<Zone[]>("/incidents/zones",{token}),apiFetch<Policy>("/incidents/policy",{token}),apiFetch<Account[]>("/users",{token}),apiFetch<Grant[]>("/incidents/access",{token})]);setBases(b);setZones(z);setPolicy(p);setUsers(u);setGrants(g);}catch(e){setError(e instanceof Error?e.message:"Chargement impossible");}}
  useEffect(()=>{void load();},[token]);
  async function save(action:()=>Promise<unknown>,message:string){setError("");setSuccess("");setBusy(true);try{await action();setSuccess(message);await load();}catch(e){setError(e instanceof Error?e.message:"Échec");}finally{setBusy(false);}}
  function selectUser(id:string){const g=grants.find(x=>String(x.user_id)===id);setRights({userId:id,coordinateAll:g?.coordinate_all||false,coordinateBaseIds:(g?.coordinate_base_ids||[]).map(String),supervisorBaseIds:(g?.supervisor_base_ids||[]).map(String)});}
  function toggle(key:"coordinateBaseIds"|"supervisorBaseIds",id:string){setRights(r=>({...r,[key]:r[key].includes(id)?r[key].filter(x=>x!==id):[...r[key],id]}));}
  return <div className="mt-6 flex flex-col gap-5 border-t pt-5">
    <h2 className="text-xl font-bold">Zones d’intervention, GPS et coordination</h2>
    <p className="text-sm">L’affectation utilise exclusivement les périmètres ci-dessous. Le nom de ville et l’ancien rayon des bases ne déterminent plus l’accès aux signalements. Aucun périmètre officiel n’est fourni. Hors zone, chevauchement entre centres ou centre inactif : file « À affecter ».</p>
    {error?<Alert variant="error">{error}</Alert>:null}{success?<Alert variant="success">{success}</Alert>:null}
    {policy?<form className="grid gap-3 rounded-xl border bg-white p-5 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void save(()=>apiFetch("/incidents/policy",{token,method:"PUT",body:policy}),"Paramètres GPS et protection contre les répétitions enregistrés.");}}>
      <h3 className="col-span-full font-bold">Validation des signalements</h3>
      {(Object.keys(policyLabels) as (keyof Policy)[]).map(key=><label key={key} className="text-sm">{policyLabels[key]}<Input required type="number" step={key==="maxAccuracyMeters"?"any":"1"} value={policy[key]} onChange={e=>setPolicy(p=>p?{...p,[key]:Number(e.target.value)}:p)}/></label>)}
      <Button disabled={busy} className="col-span-full">Enregistrer les seuils</Button>
    </form>:null}
    <form className="grid gap-3 rounded-xl border bg-white p-5 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void save(()=>apiFetch(`/incidents/zones${zone.id?`/${zone.id}`:""}`,{token,method:zone.id?"PUT":"POST",body:{...zone,geometry:JSON.parse(zone.geometry)}}),"Périmètre enregistré. Les dossiers existants gardent leur affectation ; les nouveaux utilisent ce périmètre.");}}>
      <h3 className="col-span-full font-bold">{zone.id?"Modifier un périmètre":"Créer un périmètre"}</h3>
      <label>Nom<Input required value={zone.name} onChange={e=>setZone(z=>({...z,name:e.target.value}))}/></label>
      <label>Centre compétent<Select required value={zone.baseId} onChange={e=>setZone(z=>({...z,baseId:e.target.value}))}><option value="">Choisir un centre</option>{bases.map(b=><option key={b.id} value={b.id}>{b.name} · {b.serviceType} · {b.isActive?"actif":"inactif"}</option>)}</Select></label>
      <label className="col-span-full">Périmètre GeoJSON Polygon (coordonnées longitude, latitude ; contours fermés)<Textarea required rows={7} value={zone.geometry} placeholder={'{"type":"Polygon","coordinates":[...]}'} onChange={e=>setZone(z=>({...z,geometry:e.target.value}))}/></label>
      <label><input type="checkbox" checked={zone.isActive} onChange={e=>setZone(z=>({...z,isActive:e.target.checked}))}/> Zone active</label>
      <label><input type="checkbox" checked={zone.isTest} onChange={e=>setZone(z=>({...z,isTest:e.target.checked}))}/> Zone de test fictive (exclue du routage en production)</label>
      <p className="col-span-full text-xs text-slate-600">Utilisez des limites validées par les responsables compétents. Les zones fictives doivent porter TEST ou FICTIF dans leur nom. Des contours appartenant à plusieurs centres peuvent créer une affectation ambiguë ; la coordination devra trancher.</p>
      <div className="col-span-full flex gap-3"><Button disabled={busy}>Enregistrer le périmètre</Button>{zone.id?<Button type="button" variant="outline" onClick={()=>setZone({id:"",name:"",baseId:"",geometry:"",isActive:true,isTest:false})}>Nouveau périmètre</Button>:null}</div>
    </form>
    <div className="grid gap-3 sm:grid-cols-2">{zones.map(z=><div key={z.id} className="rounded-xl border bg-white p-4"><strong>{z.name}</strong><p>{z.base_name} · {z.is_active?"Active":"Inactive"} {z.is_test?"· FICTIVE — TEST":""}</p><Button variant="outline" onClick={()=>setZone({id:String(z.id),name:z.name,baseId:String(z.base_id),geometry:JSON.stringify(z.geometry,null,2),isActive:z.is_active,isTest:z.is_test})}>Modifier la zone</Button></div>)}</div>
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
