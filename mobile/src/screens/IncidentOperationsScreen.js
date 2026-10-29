import { useEffect,useRef,useState } from "react";
import * as Location from "expo-location";
import { Image,Linking,Modal,Pressable,ScrollView,Text,TextInput,View } from "react-native";
import MapView,{Marker} from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C,shared } from "../theme";
const labels={PENDING_ASSIGNMENT:"À affecter",NEW:"Nouveau",ACKNOWLEDGED:"Pris en charge",EN_ROUTE:"Équipe envoyée",ON_SITE:"Sur place",COMPLETED:"Intervention terminée",UNCONFIRMED:"Non confirmé",DUPLICATE:"Doublon",CLOSED:"Clôturé",RESOLVED:"Intervention terminée"};
const events={CREATED:"Signalement reçu",STATUS:"Statut modifié",TRANSFER:"Transfert",REINFORCEMENT:"Renfort autorisé",REINFORCEMENT_REVOKED:"Renfort retiré",CENTER_DEACTIVATED:"Centre désactivé",MIGRATED_TO_QUEUE:"Dossier historique à affecter"};
const assignmentReasons={OUTSIDE_ZONE:"Aucun périmètre ne couvre cette position",AMBIGUOUS_ZONE:"Plusieurs centres couvrent cette position",INACTIVE_CENTER:"Centre compétent inactif",LEGACY_UNASSIGNED:"Dossier historique à affecter"};
const next={NEW:"ACKNOWLEDGED",ACKNOWLEDGED:"EN_ROUTE",EN_ROUTE:"ON_SITE",ON_SITE:"COMPLETED"};
export function IncidentOperationsScreen({kind}) {
  const {token}=useAuth();
  const [items,setItems]=useState([]),[access,setAccess]=useState({coordinateAll:false,coordinateBaseIds:[],supervisorBaseIds:[]});
  const [filter,setFilter]=useState("ACTIVE"),[pageCursor,setPageCursor]=useState(""),[selected,setSelected]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [targets,setTargets]=useState([]),[target,setTarget]=useState(""),[reason,setReason]=useState(""),[mode,setMode]=useState("TRANSFER"),[authorize,setAuthorize]=useState(false);
  const alive=useRef(true),pending=useRef(false),generation=useRef(0);
  const request=(path,options={})=>apiFetch(path,{token,cache:false,queueOffline:false,...options});
  async function load(){
    if(pending.current)return;pending.current=true;const version=generation.current;
    try{const [data,rights]=await Promise.all([request(`/incidents/${kind}?${filter==="QUEUE"?"queue=1&":""}${pageCursor?`beforeId=${pageCursor}`:""}`),request("/incidents/access/mine")]);if(alive.current&&version===generation.current){setItems(data);setSelected(current=>current&&!data.some(x=>x.id===current.id)?null:current);setAccess(rights);setError("");}}
    catch(e){if(alive.current&&version===generation.current){setItems([]);setSelected(null);setError(e.message);}}finally{if(version===generation.current)pending.current=false;}
  }
  useEffect(()=>{alive.current=true;void load();const timer=setInterval(load,15000);return()=>{alive.current=false;generation.current++;pending.current=false;clearInterval(timer);};},[kind,token,filter,pageCursor]);
  const canManage=item=>access.coordinateAll||access.coordinateBaseIds.includes(item.assignedBaseId)||access.supervisorBaseIds.includes(item.assignedBaseId);
  async function open(item){
    setError("");setSelected(null);setTarget("");setReason("");setAuthorize(false);setTargets([]);
    try{const detail=await request(`/incidents/${kind}/${item.id}`);setSelected(detail);if(canManage(detail))setTargets(await request("/incidents/transfer-targets"));}catch(e){setError(e.message);}
  }
  function more(){if(items.length){setSelected(null);setPageCursor(items[items.length-1].id);}}

  async function change(status){
    if(busy)return;setBusy(true);setError("");
    try{
      let team={};
      if(kind==="medical"){
        let timer;
        try{if((await Location.requestForegroundPermissionsAsync()).status==="granted"){
          const fix=await Promise.race([Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("GPS équipe indisponible")),10000);})]);
          team={teamLatitude:fix.coords.latitude,teamLongitude:fix.coords.longitude};
        }}catch{}finally{clearTimeout(timer);}
      }
      await request(`/incidents/${kind}/${selected.id}/status`,{method:"PATCH",body:{status,reason,teamNote:reason,...team}});setSelected(await request(`/incidents/${kind}/${selected.id}`));await load();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function transfer(){
    if(busy)return;setBusy(true);setError("");
    try{await request(`/incidents/${kind}/${selected.id}/transfer`,{method:"POST",body:{mode,targetBaseId:target,reason,authorizeTarget:authorize}});setSelected(null);await load();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const visible=items.filter(x=>filter!=="ACTIVE"||["NEW","ACKNOWLEDGED","EN_ROUTE","ON_SITE"].includes(x.status));
  return <>
    <ScrollView contentContainerStyle={{padding:16,gap:14}}>
      <Text style={{fontSize:24,fontWeight:"800"}}>{kind==="medical"?"Urgences sanitaires":"Urgences de sécurité"}</Text>
      <Text>Signalements affectés à vos centres et renforts explicitement autorisés. Une notification ne vaut pas prise en charge.</Text>
      <View style={{flexDirection:"row",gap:12,flexWrap:"wrap"}}>{["ACTIVE","ALL",...(access.coordinateAll?["QUEUE"]:[])].map(f=><Pressable key={f} onPress={()=>{setFilter(f);setPageCursor("");setSelected(null);}}><Text style={{color:filter===f?C.red:C.primary,fontWeight:"700"}}>{f==="ACTIVE"?"Actifs":f==="ALL"?"Tous":"À affecter"}</Text></Pressable>)}<Pressable onPress={load}><Text style={{color:C.primary}}>Actualiser</Text></Pressable></View>
      {error?<Text accessibilityRole="alert" style={{color:C.red}}>{error}</Text>:null}
      {visible.length>0?<MapView style={{height:260}} initialRegion={{latitude:visible[0].latitude,longitude:visible[0].longitude,latitudeDelta:.15,longitudeDelta:.15}}>{visible.map(x=><Marker key={x.id} coordinate={x} title={`${labels[x.status]} · ${x.assignedBaseName||"À affecter"}`} onPress={()=>open(x)}/>)}</MapView>:null}
      {!visible.length&&!error?<Text>Aucun signalement pour ce filtre.</Text>:null}
      {visible.map(x=><Pressable key={x.id} onPress={()=>open(x)} style={{padding:16,backgroundColor:"white",borderRadius:12,gap:5}}>
        <Text style={{fontWeight:"800"}}>#{x.id} · {x.emergencyType||x.alertType} · {labels[x.status]}</Text><Text>{x.assignedBaseName||"À affecter"} · {x.pickupPointName||x.locationName}</Text>
        {x.probableDuplicate?<Text style={{color:C.orange}}>Doublon probable à vérifier — signalement conservé</Text>:null}
      </Pressable>)}
      {pageCursor?<Pressable onPress={()=>{setSelected(null);setPageCursor("");}}><Text style={{color:C.primary}}>Revenir aux signalements les plus récents</Text></Pressable>:null}
      {items.length>=300?<Pressable onPress={more}><Text style={{color:C.primary}}>Charger les signalements plus anciens</Text></Pressable>:null}
    </ScrollView>
    <Modal visible={!!selected} animationType="slide" onRequestClose={()=>setSelected(null)}><SafeAreaView style={{flex:1}}><ScrollView contentContainerStyle={{padding:18,gap:14}}>
      <Pressable onPress={()=>setSelected(null)}><Text style={{color:C.primary}}>‹ Retour</Text></Pressable>
      {selected?<>
        <Text style={{fontSize:22,fontWeight:"800"}}>#{selected.id} · {labels[selected.status]}</Text>
        <Text>{selected.assignedBaseName||"À affecter"}{assignmentReasons[selected.assignmentReason]?` · ${assignmentReasons[selected.assignmentReason]}`:""}</Text>
        <Text>{selected.description}</Text><Text>Repère : {selected.pickupPointName||selected.locationName}</Text><Text>Contact : {selected.phoneNumber} · Victimes estimées : {selected.victimCount??"inconnu"}</Text>
        <Text>GPS : {selected.latitude}, {selected.longitude} · précision {selected.accuracyMeters??"non disponible"} m</Text>
        <Pressable onPress={()=>Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude},${selected.longitude}&travelmode=driving`).catch(()=>setError("Impossible d’ouvrir la navigation."))}><Text style={{color:C.primary,fontWeight:"700"}}>Naviguer vers le lieu du signalement</Text></Pressable>
        {selected.photos.map((uri,i)=><Image key={i} source={{uri}} style={{width:"100%",height:200,resizeMode:"contain"}}/>)}
        <TextInput style={shared.input} value={reason} onChangeText={setReason} placeholder="Note ou motif (obligatoire pour non confirmé, doublon ou transfert)" multiline maxLength={1000}/>
        {next[selected.status]?<Pressable disabled={busy} onPress={()=>change(next[selected.status])}><Text style={{fontWeight:"800",color:C.primary}}>{labels[next[selected.status]]}</Text></Pressable>:null}
        {["NEW","ACKNOWLEDGED","EN_ROUTE","ON_SITE"].includes(selected.status)?<View style={{flexDirection:"row",gap:20}}>{["UNCONFIRMED","DUPLICATE"].map(s=><Pressable disabled={busy} key={s} onPress={()=>change(s)}><Text style={{color:C.orange}}>{labels[s]}</Text></Pressable>)}</View>:null}
        {canManage(selected)&&!["COMPLETED","UNCONFIRMED","DUPLICATE","CLOSED","RESOLVED"].includes(selected.status)?<View style={{gap:12,borderTopWidth:1,paddingTop:12}}>
          <Text style={{fontWeight:"800"}}>Transfert / demande de renfort</Text>
          <View style={{flexDirection:"row",gap:20}}>{["TRANSFER","REINFORCEMENT"].map(m=><Pressable key={m} onPress={()=>{setMode(m);setAuthorize(false);}}><Text style={{color:mode===m?C.red:C.primary}}>{m==="TRANSFER"?"Transférer":"Demander un renfort"}</Text></Pressable>)}</View>
          {targets.filter(b=>b.service_type===selected.targetService&&String(b.id)!==selected.assignedBaseId).map(b=><Pressable key={b.id} onPress={()=>{setTarget(String(b.id));setAuthorize(false);}}><Text style={{color:target===String(b.id)?C.red:C.primary}}>{target===String(b.id)?"●":"○"} {b.name} · {b.city}</Text></Pressable>)}
          <Pressable accessibilityRole="checkbox" accessibilityState={{checked:authorize}} onPress={()=>setAuthorize(!authorize)}><Text>{authorize?"☑":"☐"} J’autorise explicitement ce centre à consulter le dossier. Le transfert retire l’accès à mon centre.</Text></Pressable>
          <Pressable disabled={busy||!authorize||!target||reason.trim().length<5} onPress={transfer}><Text style={{fontWeight:"800",color:C.primary}}>Confirmer avec motif et historique</Text></Pressable>
        </View>:null}
        {error?<Text style={{color:C.red}}>{error}</Text>:null}
        <Text style={{fontWeight:"800"}}>Historique</Text>{(selected.history||[]).map(h=><Text key={h.id}>{new Date(h.created_at).toLocaleString("fr-FR")} · {h.actor_name||(h.event==="MIGRATED_TO_QUEUE"?"Système":"Compte supprimé")} · {events[h.event]||"Mise à jour"} · {labels[h.to_status]||h.to_status}{h.reason?` · ${h.reason}`:""}</Text>)}
      </>:null}
    </ScrollView></SafeAreaView></Modal>
  </>;
}
