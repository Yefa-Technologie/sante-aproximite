import { pool } from "../config/db.js";
import { validPoint } from "./incidentGeometry.js";
export const fail = (message,status=400) => Object.assign(new Error(message),{status});
export async function getIncidentPolicy(db=pool) {
  const {rows}=await db.query("SELECT * FROM incident_policy WHERE id=1");
  const p=rows[0];
  return {maxAgeSeconds:p.max_age_seconds,maxAccuracyMeters:Number(p.max_accuracy_meters),maxReportsPerMinute:p.max_reports_per_minute,duplicateWindowMinutes:p.duplicate_window_minutes,duplicateDistanceMeters:p.duplicate_distance_meters};
}
export function validateIncidentLocation(body,policy,now=Date.now()) {
  if(!validPoint([body?.longitude,body?.latitude])) throw fail("Position GPS absente ou invalide. Activez la localisation et réessayez sur les lieux.");
  if(body.presenceConfirmed!==true) throw fail("Confirmez votre présence sur les lieux ou à proximité immédiate de l’incident.");
  const timestamp=body.locationTimestamp, accuracy=body.accuracyMeters;
  if(typeof timestamp!=="number" || !Number.isFinite(timestamp) || timestamp>now+5000 || now-timestamp>=policy.maxAgeSeconds*1000) throw fail(`Position GPS périmée ou horodatage invalide. Reprenez une position de moins de ${policy.maxAgeSeconds} secondes.`);
  if(typeof accuracy!=="number" || !Number.isFinite(accuracy) || accuracy<0 || accuracy>policy.maxAccuracyMeters) throw fail(`Précision GPS insuffisante. Attendez une précision de ${policy.maxAccuracyMeters} mètres maximum, depuis un endroit sûr et dégagé.`);
  if(body.locationMocked===true) throw fail("Le téléphone indique une position simulée. Désactivez la simulation GPS puis réessayez.");
  return {latitude:body.latitude,longitude:body.longitude,timestamp,accuracy};
}
