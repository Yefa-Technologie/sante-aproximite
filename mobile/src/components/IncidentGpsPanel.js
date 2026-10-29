import { Pressable,Text,TextInput,View } from "react-native";
import MapView,{Marker,Circle} from "react-native-maps";
import { C,shared } from "../theme";
export function IncidentGpsPanel({position,busy,onRefresh,presence,onPresence,victims,onVictims}) {
  return <View style={{gap:12,padding:16,backgroundColor:"white",borderRadius:16}}>
    <Text style={{fontWeight:"800",color:C.red}}>Mettez-vous en sécurité avant de signaler. Ne vous exposez pas pour prendre une photo.</Text>
    <Text style={{fontWeight:"700"}}>Position GPS automatique du téléphone</Text>
    {position?<>
      <Text>Précision annoncée : {Math.round(position.accuracyMeters)} m · relevée à {new Date(position.locationTimestamp).toLocaleTimeString("fr-FR")}</Text>
      <MapView style={{height:220,width:"100%"}} region={{latitude:position.latitude,longitude:position.longitude,latitudeDelta:0.008,longitudeDelta:0.008}}>
        <Marker coordinate={position} title="Position détectée du déclarant"/>
        <Circle center={position} radius={position.accuracyMeters} fillColor="rgba(30,100,255,0.12)" strokeColor={C.primary}/>
      </MapView>
    </>:<Text>Aucune position valide. L’envoi est bloqué jusqu’à l’obtention d’une position GPS récente et suffisamment précise.</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={onRefresh}><Text style={{color:C.primary,fontWeight:"700"}}>{busy?"Localisation en cours…":"Actualiser la position"}</Text></Pressable>
    <Text>Une connexion Internet est nécessaire. Aucun signalement n’est envoyé plus tard avec une ancienne position GPS.</Text>
    <Text>La position sera vérifiée de nouveau juste avant l’envoi. Le repère décrit le lieu mais ne change pas la position GPS.</Text>
    <Text>Nombre estimé de victimes (facultatif)</Text>
    <TextInput accessibilityLabel="Nombre estimé de victimes" keyboardType="number-pad" maxLength={5} placeholder="Inconnu" value={victims} onChangeText={onVictims} style={shared.input}/>
    <Pressable accessibilityRole="checkbox" accessibilityState={{checked:presence}} onPress={()=>onPresence(!presence)} style={{flexDirection:"row",gap:10,paddingVertical:8}}>
      <Text style={{color:C.primary,fontSize:20}}>{presence?"☑":"☐"}</Text><Text style={{flex:1}}>Je confirme être sur les lieux ou à proximité immédiate de l’incident signalé.</Text>
    </Pressable>
  </View>;
}
