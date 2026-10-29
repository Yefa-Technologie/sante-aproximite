"use client";
import {useEffect,useRef,useState} from "react";
import dynamic from "next/dynamic";
import {apiFetch} from "@/lib/api-client";
import {useAuthStore} from "@/lib/auth-store";
import {Button} from "@/components/ui/button";
import {Select} from "@/components/ui/select";
import {Textarea} from "@/components/ui/textarea";
import {Alert} from "@/components/ui/alert";
import {formatEmergencyStatus,formatIncidentEvent,formatAssignmentReason} from "@/lib/format";
const IncidentMap=dynamic(()=>import("./IncidentMap"),{ssr:false});
type History={id:string;event:string;actor_name:string;to_status:string;created_at:string;reason:string};
type Incident={id:string;latitude:number;longitude:number;status:string;assignedBaseId:string|null;assignedBaseName:string|null;assignmentReason:string;targetService:string;emergencyType?:string;alertType?:string;description:string;pickupPointName?:string;locationName?:string;phoneNumber:string;victimCount:number|null;accuracyMeters:number|null;photos:string[];probableDuplicate:boolean;createdAt:string;history?:History[]};
type Access={coordinateAll:boolean;coordinateBaseIds:string[];supervisorBaseIds:string[]};
type Target={id:string;name:string;city:string;service_type:string};
const next:Record<string,string>={NEW:"ACKNOWLEDGED",ACKNOWLEDGED:"EN_ROUTE",EN_ROUTE:"ON_SITE",ON_SITE:"COMPLETED"};
export function IncidentDesk({kind}:{kind:"medical"|"security"}) {
  const {token}=useAuthStore();
  const [items,setItems]=useState<Incident[]>([]),[selected,setSelected]=useState<Incident|null>(null),[filter,setFilter]=useState("ACTIVE"),[pageCursor,setPageCursor]=useState("");
  const [access,setAccess]=useState<Access>({coordinateAll:false,coordinateBaseIds:[],supervisorBaseIds:[]}),[targets,setTargets]=useState<Target[]>([]);
  const [reason,setReason]=useState(""),[target,setTarget]=useState(""),[mode,setMode]=useState("TRANSFER"),[authorize,setAuthorize]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const pending=useRef(false),generation=useRef(0);
  async function load(){if(pending.current)return;pending.current=true;const version=generation.current;try{const [data,a]=await Promise.all([apiFetch<Incident[]>(`/incidents/${kind}?${filter==="QUEUE"?"queue=1&":""}${pageCursor?`beforeId=${pageCursor}`:""}`,{token}),apiFetch<Access>("/incidents/access/mine",{token})]);if(version!==generation.current)return;setItems(data);setSelected(current=>current&&!data.some(x=>x.id===current.id)?null:current);setAccess(a);setError("");}catch(e){if(version===generation.current){setItems([]);setSelected(null);setError(e instanceof Error?e.message:"Chargement impossible");}}finally{if(version===generation.current)pending.current=false;}}
  useEffect(()=>{void load();const timer=setInterval(load,15000);return()=>{generation.current++;pending.current=false;clearInterval(timer);};},[token,kind,filter,pageCursor]);
  const canTransfer=(x:Incident)=>access.coordinateAll||access.coordinateBaseIds.includes(x.assignedBaseId||"")||access.supervisorBaseIds.includes(x.assignedBaseId||"");
  async function open(id:string){setError("");setSelected(null);setReason("");setTarget("");setAuthorize(false);setTargets([]);try{const x=await apiFetch<Incident>(`/incidents/${kind}/${id}`,{token});setSelected(x);if(canTransfer(x))setTargets(await apiFetch<Target[]>("/incidents/transfer-targets",{token}));}catch(e){setError(e instanceof Error?e.message:"Accès refusé");}}
  async function change(status:string){if(!selected||busy)return;setBusy(true);setError("");try{await apiFetch(`/incidents/${kind}/${selected.id}/status`,{token,method:"PATCH",body:{status,reason,teamNote:reason}});setSelected(await apiFetch<Incident>(`/incidents/${kind}/${selected.id}`,{token}));await load();}catch(e){setError(e instanceof Error?e.message:"Échec");}finally{setBusy(false);}}
  async function transfer(){if(!selected||busy)return;setBusy(true);setError("");try{await apiFetch(`/incidents/${kind}/${selected.id}/transfer`,{token,method:"POST",body:{mode,targetBaseId:target,reason,authorizeTarget:authorize}});setSelected(null);await load();}catch(e){setError(e instanceof Error?e.message:"Transfert refusé");}finally{setBusy(false);}}
  function more(){if(items.length){setSelected(null);setPageCursor(items[items.length-1].id);}}

  async function exportCsv(){try{const blob=await apiFetch<Blob>(`/incidents/${kind}/export`,{token,responseType:"blob"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`signalements-${kind}.csv`;a.click();URL.revokeObjectURL(url);}catch(e){setError(e instanceof Error?e.message:"Export impossible");}}
  const visible=items.filter(x=>filter!=="ACTIVE"||Object.keys(next).includes(x.status));
  return <div className="flex flex-col gap-4">
    <h1 className="text-2xl font-bold">{kind==="medical"?"Urgences sanitaires":"Urgences de sécurité"}</h1>
    <p className="text-sm">Dossiers de vos centres et renforts autorisés. La réception d’une notification ne prend jamais automatiquement un incident en charge.</p>
    <div className="flex flex-wrap gap-3"><Select className="max-w-xs" value={filter} onChange={e=>{setFilter(e.target.value);setPageCursor("");setSelected(null);}}><option value="ACTIVE">Actifs</option><option value="ALL">Tous</option>{access.coordinateAll?<option value="QUEUE">À affecter</option>:null}</Select><Button variant="outline" onClick={load}>Actualiser</Button><Button variant="outline" onClick={exportCsv}>Exporter les dossiers autorisés</Button></div>
    {error?<Alert variant="error">{error}</Alert>:null}
    <IncidentMap items={visible} onSelect={open}/>
    <div className="grid gap-3 md:grid-cols-2">{visible.map(x=><button key={x.id} onClick={()=>open(x.id)} className="rounded-xl border bg-white p-4 text-left"><strong>#{x.id} · {x.emergencyType||x.alertType}</strong><p>{formatEmergencyStatus(x.status)} · {x.assignedBaseName||"À affecter"}</p><p>{x.pickupPointName||x.locationName}</p>{x.probableDuplicate?<p className="text-amber-700">Doublon probable à vérifier ; signalement conservé.</p>:null}</button>)}</div>
    {!visible.length&&!error?<p>Aucun signalement pour ce filtre.</p>:null}
    {pageCursor?<Button variant="outline" onClick={()=>{setSelected(null);setPageCursor("");}}>Revenir aux signalements les plus récents</Button>:null}
    {items.length>=300?<Button variant="outline" onClick={more}>Charger les signalements plus anciens</Button>:null}
    {selected?<section className="flex flex-col gap-3 rounded-xl border bg-white p-5">
      <div className="flex justify-between"><h2 className="text-xl font-bold">Dossier #{selected.id} · {formatEmergencyStatus(selected.status)}</h2><Button variant="outline" onClick={()=>setSelected(null)}>Fermer</Button></div>
      <p>{selected.description}</p><p>Repère : {selected.pickupPointName||selected.locationName}</p><p>Téléphone : {selected.phoneNumber} · Victimes estimées : {selected.victimCount??"inconnu"}</p>
      <p>Centre : {selected.assignedBaseName||selected.assignedBaseId||"À affecter"} · GPS {selected.latitude}, {selected.longitude} · précision {selected.accuracyMeters??"inconnue"} m</p>
      <p className="text-xs">Affectation : {formatAssignmentReason(selected.assignmentReason)}</p>
      <div className="flex flex-wrap gap-3">{selected.photos.map((src,i)=><img key={i} src={src} alt={`Photo facultative ${i+1} du signalement`} className="h-40 w-56 rounded object-contain"/>)}</div>
      <Textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} placeholder="Note / motif obligatoire pour un doublon, non confirmé ou transfert"/>
      <div className="flex flex-wrap gap-3">{next[selected.status]?<Button disabled={busy} onClick={()=>change(next[selected.status])}>{formatEmergencyStatus(next[selected.status])}</Button>:null}{Object.keys(next).includes(selected.status)?["UNCONFIRMED","DUPLICATE"].map(s=><Button key={s} disabled={busy} variant="outline" onClick={()=>change(s)}>{formatEmergencyStatus(s)}</Button>):null}</div>
      {canTransfer(selected)&&!["COMPLETED","UNCONFIRMED","DUPLICATE","CLOSED","RESOLVED"].includes(selected.status)?<div className="flex flex-col gap-3 border-t pt-4">
        <h3 className="font-bold">Transfert ou renfort entre centres</h3>
        <Select value={mode} onChange={e=>{setMode(e.target.value);setAuthorize(false);}}><option value="TRANSFER">Transférer (retrait de l’accès à l’ancien centre)</option><option value="REINFORCEMENT">Demander un renfort (accès supplémentaire autorisé)</option></Select>
        <Select value={target} onChange={e=>{setTarget(e.target.value);setAuthorize(false);}}><option value="">Centre destinataire</option>{targets.filter(b=>b.service_type===selected.targetService&&String(b.id)!==selected.assignedBaseId).map(b=><option key={b.id} value={b.id}>{b.name} · {b.city}</option>)}</Select>
        <label className="text-sm"><input type="checkbox" checked={authorize} onChange={e=>setAuthorize(e.target.checked)}/> J’autorise explicitement l’accès du centre destinataire à ce dossier.</label>
        <Button disabled={busy||!target||!authorize||reason.trim().length<5} onClick={transfer}>Confirmer avec motif et historique</Button>
      </div>:null}
      {error?<Alert variant="error">{error}</Alert>:null}
      <h3 className="font-bold">Historique horodaté</h3>{selected.history?.map(h=><p key={h.id} className="text-sm">{new Date(h.created_at).toLocaleString("fr-FR")} · {h.actor_name||(h.event==="MIGRATED_TO_QUEUE"?"Système":"Compte supprimé")} · {formatIncidentEvent(h.event)} · {formatEmergencyStatus(h.to_status)} · {h.reason}</p>)}
    </section>:null}
  </div>;
}
