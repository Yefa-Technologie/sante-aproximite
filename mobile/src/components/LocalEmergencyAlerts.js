import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiFetch } from "../api/client";
import { subscribeLocalEmergencyNotifications } from "../notifications";
import { C } from "../theme";
const statusLabel={NEW:"Nouveau",ACKNOWLEDGED:"Pris en charge",EN_ROUTE:"Équipe en route",ON_SITE:"Équipe sur place"};
export function LocalEmergencyAlerts({token,onNavigate}) {
  const [open,setOpen]=useState(false),[alerts,setAlerts]=useState([]),[bases,setBases]=useState([]);
  const [needsAssignment,setNeedsAssignment]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const active=useRef(true),pending=useRef(false);
  async function refresh() {
    if(pending.current || AppState.currentState!=="active")return;
    pending.current=true;setBusy(true);
    try {
      const data=await apiFetch("/emergency-reports/local-alerts",{token,queueOffline:false,cache:false});
      if(active.current){setAlerts(data.alerts||[]);setBases(data.bases||[]);setNeedsAssignment(!!data.needsAssignment);setError("");}
    } catch(e){if(active.current){setAlerts([]);setError(e.message||"Impossible d’actualiser les alertes.");}}
    finally{pending.current=false;if(active.current)setBusy(false);}
  }
  useEffect(()=>{
    active.current=true;void refresh();
    const timer=setInterval(refresh,30000);
    const app=AppState.addEventListener("change",state=>{if(state==="active")void refresh();});
    const unsubscribe=subscribeLocalEmergencyNotifications(()=>{if(active.current){setOpen(true);void refresh();}});
    return()=>{active.current=false;clearInterval(timer);app.remove();unsubscribe();};
  },[token]);
  return <>
    <Pressable onPress={()=>{setOpen(true);void refresh();}} accessibilityRole="button" style={{marginHorizontal:12,marginVertical:5,padding:10,borderRadius:10,backgroundColor:alerts.length?C.redLight:C.primaryLight}}>
      <Text accessibilityLiveRegion="polite" style={{color:alerts.length?C.red:C.primary,fontWeight:"700"}}>🔔 {alerts.length?`${alerts.length} alerte(s) pour votre base`:"Alertes de votre base"}</Text>
      {needsAssignment?<Text>Base non affectée : contactez l’administrateur.</Text>:null}
      {error?<Text style={{color:C.red}}>Alertes non actualisées · toucher pour réessayer</Text>:null}
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={()=>setOpen(false)}>
      <SafeAreaView style={{flex:1,backgroundColor:C.bg}}><ScrollView contentContainerStyle={{padding:18,gap:16}}>
        <Pressable onPress={()=>setOpen(false)}><Text style={{color:C.primary,fontWeight:"700"}}>‹ Retour</Text></Pressable>
        <Text style={{fontSize:23,fontWeight:"800"}}>Alertes de votre base</Text>
        <Text>Seuls les signalements destinés à votre service, dans la ville ou le rayon d’intervention de votre base, sont affichés.</Text>
        {bases.map(b=><Text key={b.id}>{b.name} · {b.serviceType.replaceAll("_"," ")} · {b.city} · rayon {b.radiusKm} km</Text>)}
        {needsAssignment?<Text style={{color:C.red}}>Aucune base active n’est affectée à votre compte. Demandez à l’administrateur de vous affecter une base depuis le web.</Text>:null}
        <Pressable onPress={refresh} disabled={busy}><Text style={{color:C.primary,fontWeight:"700"}}>Actualiser</Text></Pressable>
        {busy?<ActivityIndicator color={C.primary}/>:null}
        {error?<Text accessibilityRole="alert" style={{color:C.red}}>{error}</Text>:null}
        {!busy&&!error&&!needsAssignment&&!alerts.length?<Text>Aucun signalement actif dans la zone de votre base.</Text>:null}
        {alerts.map(a=><Pressable key={`${a.kind}-${a.id}`} onPress={()=>{setOpen(false);onNavigate?.(a.kind);}} style={{padding:16,backgroundColor:"white",borderRadius:12,gap:7}}>
          <Text style={{fontWeight:"800",color:C.red}}>{a.kind==="security"?"Alerte sécurité":"Urgence sanitaire"} · {a.targetService.replaceAll("_"," ")}</Text>
          <Text>{a.city||"À proximité de votre base"}</Text>
          <Text>{statusLabel[a.status]||a.status} · {new Date(a.createdAt).toLocaleString("fr-FR")}</Text>
          <Text style={{color:C.primary}}>Ouvrir l’espace opérationnel ›</Text>
        </Pressable>)}
        <Text style={{color:C.textMuted}}>Une connexion Internet est nécessaire pour actualiser les alertes.</Text>
      </ScrollView></SafeAreaView>
    </Modal>
  </>;
}
