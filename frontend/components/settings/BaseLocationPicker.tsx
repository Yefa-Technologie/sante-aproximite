"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {MapContainer,TileLayer,Marker,Circle,useMap,useMapEvents} from "react-leaflet";
import {divIcon} from "leaflet";
import {Input} from "@/components/ui/input";
import "leaflet/dist/leaflet.css";

type Locality={id:string;name:string;search:string;latitude:number;longitude:number;population:number};
type Position={latitude:number;longitude:number};
const normalized=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr");
function distanceKm(a:Position,b:Position){const rad=Math.PI/180;const dLat=(b.latitude-a.latitude)*rad,dLon=(b.longitude-a.longitude)*rad;const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
const pin=divIcon({className:"base-position-pin",html:'<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2563eb;border:3px solid white;box-shadow:0 2px 6px #33415580"></div>',iconSize:[28,28],iconAnchor:[14,28]});
function MapEvents({position,onChange}:{position:Position|null;onChange:(p:Position)=>void}) {
 const map=useMap();
 useMapEvents({click:e=>onChange({latitude:e.latlng.lat,longitude:e.latlng.lng})});
 useEffect(()=>{map.invalidateSize();if(position)map.setView([position.latitude,position.longitude],Math.max(map.getZoom(),14));},[map,position?.latitude,position?.longitude]);
 return null;
}

export default function BaseLocationPicker({city,latitude,longitude,disabled,onCityChange,onPositionChange}:{city:string;latitude:string;longitude:string;disabled:boolean;onCityChange:(city:string)=>void;onPositionChange:(p:Position)=>void}) {
 const initial=useRef({city,latitude,longitude});
 const [selectedLocality,setSelectedLocality]=useState<Locality|null>(null),[radiusKm,setRadiusKm]=useState(5);
 const [localities,setLocalities]=useState<Locality[]>([]),[open,setOpen]=useState(false),[activeIndex,setActiveIndex]=useState(0),[error,setError]=useState("");
 useEffect(()=>{let active=true;fetch("/maps/civ-localities.json").then(r=>{if(!r.ok)throw Error("Liste des villes indisponible");return r.json();}).then(data=>{if(active)setLocalities(data.localities.map((l:Locality)=>({...l,search:normalized(`${l.name} ${l.search}`)})));}).catch(()=>{if(active)setError("La liste des villes n’a pas pu être chargée. Vous pouvez saisir le nom et choisir le point sur la carte.");});return()=>{active=false;};},[]);
 const results=useMemo(()=>{const query=normalized(city.trim());if(!query)return localities.slice(0,12);return localities.filter(l=>l.search.includes(query)).slice(0,20);},[localities,city]);
 const lat=Number(latitude),lon=Number(longitude);
 const position=latitude!==""&&longitude!==""&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{latitude:lat,longitude:lon}:null;
 const reference=useMemo(()=>{
  if(selectedLocality&&selectedLocality.name===city)return selectedLocality;
  // On editing, recover the closest homonymous locality to the saved position.
  const saved=initial.current;
  if(!saved.latitude||!saved.longitude||city!==saved.city)return null;
  const matches=localities.filter(l=>normalized(l.name)===normalized(saved.city));
  const origin={latitude:Number(saved.latitude),longitude:Number(saved.longitude)};
  return matches.reduce<Locality|null>((best,l)=>!best||distanceKm(origin,l)<distanceKm(origin,best)?l:best,null);
 },[localities,city,selectedLocality]);
 const distance=reference&&position?distanceKm(reference,position):null;
 const outside=distance!==null&&distance>radiusKm;
 function choose(l:Locality){if(disabled)return;setSelectedLocality(l);onCityChange(l.name);onPositionChange({latitude:l.latitude,longitude:l.longitude});setOpen(false);}
 function update(p:Position){if(!disabled)onPositionChange(p);}
 return <div className="col-span-full space-y-3">
  <div className="relative"><label className="text-sm">Ville ou village<Input aria-label="Ville ou village" required disabled={disabled} role="combobox" aria-autocomplete="list" aria-controls="base-locality-results" aria-expanded={open} aria-activedescendant={open&&results[activeIndex]?`base-locality-${results[activeIndex].id}`:undefined} autoComplete="off" value={city} placeholder="Rechercher une ville ou un village…" onFocus={()=>{setOpen(true);setActiveIndex(0);}} onBlur={()=>setOpen(false)} onKeyDown={e=>{if(e.key==="Escape")setOpen(false);if(e.key==="ArrowDown"){e.preventDefault();setOpen(true);setActiveIndex(i=>Math.min(results.length-1,i+1));}if(e.key==="ArrowUp"){e.preventDefault();setActiveIndex(i=>Math.max(0,i-1));}if(e.key==="Enter"&&open){e.preventDefault();if(results[activeIndex])choose(results[activeIndex]);}}} onChange={e=>{setSelectedLocality(null);onCityChange(e.target.value);setActiveIndex(0);setOpen(true);}}/></label>
   {open?<div id="base-locality-results" role="listbox" aria-label="Villes et villages" className="absolute z-[1001] mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">{results.length?results.map((l,index)=><button disabled={disabled} id={`base-locality-${l.id}`} role="option" aria-label={`${l.name} · ${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)}`} aria-selected={activeIndex===index} key={l.id} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>choose(l)} className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${activeIndex===index?"bg-blue-50":""}`}><strong>{l.name}</strong><span className="ml-2 text-xs text-slate-500">{l.latitude.toFixed(4)}, {l.longitude.toFixed(4)}</span></button>):<p className="p-3 text-sm text-slate-500">Aucune correspondance. Gardez le nom saisi et choisissez le point sur la carte.</p>}</div>:null}
  </div>
  <p className="text-sm text-slate-600">Choisissez une ville pour centrer la carte, puis cliquez sur le site de la base ou déplacez le point bleu pour préciser son emplacement.</p>
  {reference?<div className="space-y-2 rounded-lg border bg-slate-50 p-3 text-sm"><label>Rayon de repère autour de {reference.name} (km) <Input aria-label="Rayon de repère autour de la ville (km)" disabled={disabled} type="number" min="0.1" max="100" step="0.1" value={radiusKm} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=.1&&n<=100)setRadiusKm(n);}} className="mt-1 max-w-32"/></label><p className="text-xs text-slate-500">Ce cercle est un repère de distance autour du centre de la localité, pas sa frontière administrative.</p></div>:null}
  {outside&&reference?<p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Attention : le point est à {distance!.toLocaleString("fr-FR",{maximumFractionDigits:1})} km du centre de {reference.name}, au-delà du rayon de repère de {radiusKm} km. Il peut se trouver hors de la ville choisie. Vous pouvez continuer et enregistrer cette position.</p>:null}
  {error?<p role="alert" className="text-sm text-amber-800">{error}</p>:null}
  <div aria-label="Choisir la position exacte de la base" className="relative z-0 h-96 overflow-hidden rounded-xl border"><MapContainer center={position?[position.latitude,position.longitude]:[7.54,-5.55]} zoom={position?14:7} style={{height:"100%",width:"100%"}}><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><MapEvents position={position} onChange={update}/>{reference?<Circle center={[reference.latitude,reference.longitude]} radius={radiusKm*1000} interactive={false} pathOptions={{color:outside?"#d97706":"#2563eb",weight:2,fillOpacity:.04,dashArray:"5 5"}}/>:null}{position?<Marker position={[position.latitude,position.longitude]} icon={pin} title="Position de la base — déplacez ce point" draggable={!disabled} eventHandlers={{dragend:e=>{const p=e.target.getLatLng();update({latitude:p.lat,longitude:p.lng});}}}/>:null}</MapContainer></div>
  <p className="text-xs text-slate-500">{position?`Point sélectionné : ${lat.toFixed(6)}, ${lon.toFixed(6)}`:"Cliquez sur la carte pour placer la base."} · Localités : <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="underline">GeoNames</a>, CC BY 4.0. Les fonds de carte nécessitent Internet.</p>
 </div>;
}
