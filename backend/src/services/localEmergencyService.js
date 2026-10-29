import { pool } from "../config/db.js";
import { sendPushNotificationToUser } from "./notificationService.js";
import { baseScopeSql, serviceRoles, cityKey, mapBase } from "./serviceBaseService.js";
export { cityKey };
export const LOCAL_EMERGENCY_RADIUS_KM = 20;
export function validPosition(body) {
  return typeof body?.latitude === "number" && typeof body?.longitude === "number" && Number.isFinite(body.latitude) && Number.isFinite(body.longitude) && Math.abs(body.latitude)<=90 && Math.abs(body.longitude)<=180 && (body.latitude!==0 || body.longitude!==0);
}
// Compatibility with earlier APKs: personal positions no longer determine alert recipients.
export async function saveEmergencyLocation(req,res) { return res.status(403).json({message:"Les alertes sont réservées aux services affectés à une base."}); }
export async function removeEmergencyLocation(req,res) {
  await pool.query("DELETE FROM emergency_user_locations WHERE user_id=$1",[Number(req.user.id)]);
  res.json({enabled:false});
}
export async function getLocalEmergencyAlerts(req,res) {
  res.set("Cache-Control","no-store");
  const roles=serviceRoles(req.user);
  if (!roles.length) return res.status(403).json({message:"Alertes réservées aux comptes de secours et de sécurité affectés à une base."});
  try {
    const bases=await pool.query(`SELECT eb.* FROM emergency_bases eb JOIN user_service_bases usb ON usb.base_id=eb.id
      WHERE usb.user_id=$1 AND usb.service_type=ANY($2::text[]) AND eb.is_active=TRUE AND eb.approval_status='APPROVED'`,[Number(req.user.id),roles]);
    if (!bases.rows.length) return res.json({alerts:[],bases:[],needsAssignment:true});
    const params=[];
    const medical=baseScopeSql("er",req.user,params,["SAMU","SAPEUR_POMPIER"]);
    const security=baseScopeSql("sa",req.user,params,["POLICE","GENDARMERIE","PROTECTION_CIVILE"]);
    const result=await pool.query(`SELECT * FROM (
      SELECT er.id,er.city,er.status,er.created_at,er.target_service,'medical' AS kind FROM emergency_reports er
      WHERE er.status IN ('NEW','ACKNOWLEDGED','EN_ROUTE','ON_SITE') AND ${medical}
      UNION ALL
      SELECT sa.id,sa.city,sa.status,sa.created_at,sa.target_service,'security' AS kind FROM security_alerts sa
      WHERE sa.status IN ('NEW','ACKNOWLEDGED') AND ${security}
      ) alerts ORDER BY created_at DESC LIMIT 100`,params);
    res.json({needsAssignment:false,bases:bases.rows.map(mapBase),alerts:result.rows.map(r=>({id:String(r.id),city:r.city||null,status:r.status,createdAt:r.created_at,targetService:r.target_service,kind:r.kind}))});
  } catch { res.status(503).json({message:"Les alertes sont temporairement indisponibles."}); }
}
export async function notifyLocalEmergency(report,{query=(...args)=>pool.query(...args),send=sendPushNotificationToUser,kind="medical"}={}) {
  const table=kind==="security"?"security_alerts":"emergency_reports";
  const recipients=await query(`SELECT DISTINCT usb.user_id FROM user_service_bases usb
    JOIN emergency_bases eb ON eb.id=usb.base_id AND eb.is_active=TRUE AND eb.approval_status='APPROVED'
    JOIN users u ON u.id=usb.user_id AND u.is_active IS DISTINCT FROM false AND u.approval_status='APPROVED'
    JOIN ${table} er ON er.id=$1 AND er.target_service=usb.service_type AND eb.service_type=er.target_service
    WHERE usb.user_id<>er.user_id AND (u.role=usb.service_type OR EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role=usb.service_type))
    AND ((eb.city_key<>'' AND eb.city_key=er.city_key) OR
      6371*acos(LEAST(1.0,GREATEST(-1.0,sin(radians(eb.latitude))*sin(radians(er.latitude))+
      cos(radians(eb.latitude))*cos(radians(er.latitude))*cos(radians(eb.longitude-er.longitude)))))<=eb.radius_km)`,[report.id]);
  for(let i=0;i<recipients.rows.length;i+=10) await Promise.allSettled(recipients.rows.slice(i,i+10).map(r=>send(r.user_id,{
    title:kind==="security"?"Nouvelle alerte de sécurité":"Nouvelle urgence sanitaire",
    body:"Un signalement concerne la zone de votre base. Consultez votre espace opérationnel.",
    data:{type:"LOCAL_EMERGENCY_ALERT",reportId:String(report.id),kind}
  })));
}
