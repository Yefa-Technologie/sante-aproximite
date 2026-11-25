"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
const ServiceCoverageMap = dynamic(() => import("./ServiceCoverageMap"), {ssr:false, loading:()=> <p>Chargement de la carte…</p>});
const BaseLocationPicker = dynamic(() => import("./BaseLocationPicker"), {ssr:false, loading:()=> <p className="col-span-full">Chargement de la carte de positionnement…</p>});
import {baseMapColor} from "@/lib/base-map-color";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
export const SERVICE_ROLES=["SAMU","SAPEUR_POMPIER","POLICE","GENDARMERIE","PROTECTION_CIVILE"];
export type ServiceBase={id:string;name:string;serviceType:string;address:string;city:string;latitude:number;longitude:number;radiusKm:number;isActive:boolean};
const empty={name:"",serviceType:"SAMU",address:"",city:"",latitude:"",longitude:"",radiusKm:"20",isActive:true};
export function ServiceBasesTab({token}:{token:string}) {
  const [bases,setBases]=useState<ServiceBase[]>([]),[form,setForm]=useState(empty),[editing,setEditing]=useState("");
  const [error,setError]=useState(""),[success,setSuccess]=useState(""),[busy,setBusy]=useState(false);
  const [formOpen,setFormOpen]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);
  useEffect(()=>{if(formOpen){formRef.current?.scrollIntoView({behavior:"smooth",block:"start"});formRef.current?.querySelector<HTMLInputElement>("input")?.focus({preventScroll:true});}},[formOpen,editing]);
  function createBase(){setEditing("");setForm(empty);setError("");setSuccess("");setFormOpen(true);if(formOpen){formRef.current?.scrollIntoView({behavior:"smooth",block:"start"});formRef.current?.querySelector<HTMLInputElement>("input")?.focus({preventScroll:true});}}
  async function load(){try{setBases(await apiFetch<ServiceBase[]>("/service-bases",{token}));}catch(e){setError(e instanceof Error?e.message:"Chargement impossible");}}
  useEffect(()=>{void load();},[token]);
  async function submit(e:React.FormEvent){
    e.preventDefault();setError("");setSuccess("");if(!valid){setError("Choisissez une ville ou placez le point de la base sur la carte avant d’enregistrer.");return;}setBusy(true);
    try{
      await apiFetch(`/service-bases${editing?`/${editing}`:""}`,{token,method:editing?"PUT":"POST",body:{...form,latitude:Number(form.latitude),longitude:Number(form.longitude),radiusKm:Number(form.radiusKm)}});
      setSuccess(editing?"Base mise à jour":"Base créée. Vous pouvez maintenant y affecter des comptes du même service.");
      setEditing("");setForm(empty);setFormOpen(false);await load();
    }catch(e){setError(e instanceof Error?e.message:"Enregistrement impossible");}finally{setBusy(false);}
  }
  function locate(){
    setError("");
    if(!navigator.geolocation){setError("Géolocalisation indisponible : choisissez une ville ou placez le point sur la carte.");return;}
    navigator.geolocation.getCurrentPosition(p=>setForm(f=>({...f,latitude:String(p.coords.latitude),longitude:String(p.coords.longitude)})),()=>setError("Position inaccessible. Choisissez une ville ou placez le point sur la carte."),{enableHighAccuracy:true,timeout:15000});
  }
  const lat=Number(form.latitude),lon=Number(form.longitude),valid=form.latitude!==""&&form.longitude!==""&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
  return <div className="flex flex-col gap-4">
    <p className="text-sm text-slate-600">Créez et géolocalisez les bases SAMU, sapeurs-pompiers et sécurité. Chaque compte professionnel doit être affecté à une base de son service dans l’onglet Utilisateurs. Les signalements sont affectés selon les périmètres configurés plus bas ; la ville et le rayon ne donnent pas de droit d’accès.</p>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Bases de secours et zones d’intervention</h2><Button type="button" disabled={busy} aria-expanded={formOpen} aria-controls="service-base-form" onClick={createBase}>+ Créer une nouvelle base</Button></div>
    <ServiceCoverageMap bases={bases} token={token}/>
    {formOpen?<form id="service-base-form" ref={formRef} onSubmit={submit} className="grid gap-3 rounded-2xl border bg-white p-5 sm:grid-cols-2">
      <h3 className="col-span-full text-lg font-bold">{editing?"Modifier la base":"Créer une nouvelle base"}</h3>
      <label className="text-sm">Service<Select disabled={!!editing} value={form.serviceType} onChange={e=>setForm(f=>({...f,serviceType:e.target.value}))}>{SERVICE_ROLES.map(r=><option key={r}>{r}</option>)}</Select></label>
      <label className="text-sm">Nom de la base<Input required value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
      <label className="text-sm">Adresse<Input required value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))}/></label>
      <BaseLocationPicker city={form.city} latitude={form.latitude} longitude={form.longitude} disabled={busy} onCityChange={city=>setForm(f=>({...f,city}))} onPositionChange={p=>setForm(f=>({...f,latitude:String(p.latitude),longitude:String(p.longitude)}))}/>
      <label className="text-sm">Latitude GPS<Input required type="number" step="any" min="-90" max="90" value={form.latitude} onChange={e=>setForm(f=>({...f,latitude:e.target.value}))}/></label>
      <label className="text-sm">Longitude GPS<Input required type="number" step="any" min="-180" max="180" value={form.longitude} onChange={e=>setForm(f=>({...f,longitude:e.target.value}))}/></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={e=>setForm(f=>({...f,isActive:e.target.checked}))}/>Base active</label>
      <div className="col-span-full flex flex-wrap gap-3"><Button type="button" variant="outline" onClick={locate}>Utiliser ma position actuelle</Button><span className="text-xs text-slate-500">À utiliser uniquement si vous êtes sur le site de la base.</span></div>

      <div className="col-span-full flex gap-2"><Button disabled={busy||!valid}>{busy?"Enregistrement…":editing?"Mettre à jour la base":"Créer la base"}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>{setEditing("");setForm(empty);setFormOpen(false);}}>Annuler</Button></div>
    </form>:null}
    {error?<Alert variant="error">{error}</Alert>:null}{success?<Alert variant="success">{success}</Alert>:null}
    <div className="grid gap-3 sm:grid-cols-2">{bases.map(b=><div key={b.id} className="rounded-xl border bg-white p-4 text-sm">
      <strong><span aria-hidden="true" style={{color:baseMapColor(b.id)}}>●</span> {b.name}</strong><p>{b.serviceType.replaceAll("_"," ")} · {b.isActive?"Active":"Inactive"}</p><p>{b.city} · {b.address}</p><p>GPS : {b.latitude}, {b.longitude}</p>
      <Button type="button" variant="outline" onClick={()=>{setEditing(b.id);setForm({...b,latitude:String(b.latitude),longitude:String(b.longitude),radiusKm:String(b.radiusKm)});setError("");setSuccess("");setFormOpen(true);}}>Modifier</Button>
    </div>)}</div>
    {!bases.length&&!error?<p>Aucune base créée.</p>:null}
  </div>;
}
