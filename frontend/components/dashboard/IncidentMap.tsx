"use client";
import {useEffect} from "react";
import {MapContainer,TileLayer,CircleMarker,Popup,useMap} from "react-leaflet";
import "leaflet/dist/leaflet.css";
type Point={id:string;latitude:number;longitude:number;status:string;assignedBaseName?:string|null};
function Fit({items}:{items:Point[]}){const map=useMap();useEffect(()=>{if(items.length)map.fitBounds(items.map(p=>[p.latitude,p.longitude] as [number,number]),{padding:[30,30],maxZoom:14});},[map,items]);return null;}
export default function IncidentMap({items,onSelect}:{items:Point[];onSelect:(id:string)=>void}) {
  if(!items.length)return null;
  return <div className="relative z-0 h-80 overflow-hidden rounded-xl border"><MapContainer center={[items[0].latitude,items[0].longitude]} zoom={12} style={{height:"100%",width:"100%"}}><TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Fit items={items}/>{items.map(x=><CircleMarker key={x.id} center={[x.latitude,x.longitude]} radius={8} pathOptions={{color:x.status==="PENDING_ASSIGNMENT"?"#d97706":"#dc2626"}}><Popup><strong>#{x.id}</strong><p>{x.assignedBaseName||"À affecter"}</p><button onClick={()=>onSelect(x.id)}>Ouvrir le signalement</button></Popup></CircleMarker>)}</MapContainer></div>;
}
