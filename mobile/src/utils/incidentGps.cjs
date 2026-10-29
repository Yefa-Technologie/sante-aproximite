function validateFix(fix,policy,now=Date.now()) {
  const c=fix?.coords,age=now-fix?.timestamp;
  if(!c||typeof c.latitude!=="number"||typeof c.longitude!=="number"||!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180) throw Error("Position GPS indisponible. Activez la localisation puis réessayez depuis un endroit sûr.");
  if(typeof fix.timestamp!=="number"||!Number.isFinite(age)||age< -5000||age>=policy.maxAgeSeconds*1000) throw Error("La position GPS n’est pas assez récente. Touchez « Actualiser la position » et réessayez.");
  if(typeof c.accuracy!=="number"||!Number.isFinite(c.accuracy)||c.accuracy<0||c.accuracy>policy.maxAccuracyMeters) throw Error(`Position trop imprécise. Attendez une précision de ${policy.maxAccuracyMeters} m maximum dans un endroit sûr et dégagé, puis réessayez.`);
  if(fix.mocked===true||c.mocked===true)throw Error("Le téléphone indique une position simulée. Désactivez la simulation GPS et réessayez.");
  return {latitude:c.latitude,longitude:c.longitude,lat:c.latitude,lon:c.longitude,accuracyMeters:c.accuracy,locationTimestamp:fix.timestamp,locationMocked:false};
}
async function captureIncidentPosition(location,policy) {
  const permission=await location.requestForegroundPermissionsAsync();
  if(permission.status!=="granted")throw Error("Localisation refusée : autorisez la position précise dans les paramètres du téléphone, revenez ici puis touchez « Actualiser la position ».");
  if(!await location.hasServicesEnabledAsync())throw Error("GPS désactivé. Activez la localisation du téléphone puis réessayez depuis un endroit sûr.");
  let timer;
  try {
    const fix=await Promise.race([location.getCurrentPositionAsync({accuracy:location.Accuracy.Highest}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Position GPS indisponible. Vérifiez la localisation, placez-vous en sécurité dans un endroit dégagé et réessayez.")),20000);})]);
    return validateFix(fix,policy);
  }finally{clearTimeout(timer);}
}
const newRequestId=()=>`incident_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
module.exports={validateFix,captureIncidentPosition,newRequestId};
