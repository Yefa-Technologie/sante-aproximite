import { pool } from "../config/db.js";
import { sendPushNotificationToUser } from "./notificationService.js";
import { incidentScopeSql,incidentTable } from "./incidentAccess.js";
import { SERVICE_ROLES } from "./serviceBaseService.js";

export async function enqueueIncidentNotifications(db,kind,reportId,eventKey,targetBaseId=null) {
  const table=incidentTable(kind);
  await db.query(`INSERT INTO incident_notification_outbox(kind,report_id,user_id,event_key)
    SELECT $1,$2,u.id,$3 FROM users u JOIN ${table} r ON r.id=$2
    WHERE u.is_active=TRUE AND u.approval_status='APPROVED' AND (
      EXISTS(SELECT 1 FROM incident_access_roles iar WHERE iar.user_id=u.id AND
        (iar.coordinate_all OR r.assigned_base_id=ANY(iar.coordinate_base_ids) OR
         EXISTS(SELECT 1 FROM incident_grants g WHERE g.kind=$1 AND g.report_id=r.id AND g.base_id=ANY(iar.coordinate_base_ids))))
      OR EXISTS(SELECT 1 FROM user_service_bases usb JOIN emergency_bases eb ON eb.id=usb.base_id
        WHERE usb.user_id=u.id AND eb.is_active=TRUE AND eb.approval_status='APPROVED' AND eb.service_type=r.target_service
        AND (u.role=usb.service_type OR EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role=usb.service_type))
        AND ($4::bigint IS NULL OR eb.id=$4)
        AND (eb.id=r.assigned_base_id OR EXISTS(SELECT 1 FROM incident_grants g WHERE g.kind=$1 AND g.report_id=r.id AND g.base_id=eb.id)))
    ) ON CONFLICT(kind,report_id,user_id,event_key) DO NOTHING`,[kind,reportId,eventKey,targetBaseId]);
}
export async function deliverIncidentNotifications({db=pool,send=sendPushNotificationToUser}={}) {
  // Claim a bounded batch with a lease: another worker cannot send the same row concurrently.
  const batch=await db.query(`UPDATE incident_notification_outbox SET attempts=attempts+1,next_attempt_at=NOW()+INTERVAL '1 minute'
    WHERE id IN (SELECT id FROM incident_notification_outbox WHERE delivered_at IS NULL AND attempts<12 AND next_attempt_at<=NOW() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING *`);
  for(const n of batch.rows) {
    try {
      const viewer=(await db.query(`SELECT u.id,u.role,ARRAY(SELECT role FROM user_roles WHERE user_id=u.id) AS roles
        FROM users u WHERE u.id=$1 AND u.is_active=TRUE AND u.approval_status='APPROVED'`,[n.user_id])).rows[0];
      const params=[n.report_id];
      const scope=viewer?incidentScopeSql("r",viewer,params,SERVICE_ROLES,n.kind):"FALSE";
      const allowed=viewer&&(await db.query(`SELECT r.id FROM ${incidentTable(n.kind)} r WHERE r.id=$1 AND ${scope}`,params)).rows.length;
      if(!allowed){await db.query("DELETE FROM incident_notification_outbox WHERE id=$1",[n.id]);continue;}
      const accepted=await send(n.user_id,{title:n.kind==="medical"?"Signalement sanitaire":"Signalement de sécurité",
        body:"Un signalement est disponible pour votre centre ou votre coordination. Ouvrez l’application pour le consulter.",
        data:{type:"LOCAL_EMERGENCY_ALERT",reportId:String(n.report_id),kind:n.kind}});
      if(accepted===true)await db.query("UPDATE incident_notification_outbox SET delivered_at=NOW() WHERE id=$1",[n.id]);
    }catch{ /* Durable retry; never acknowledge or mutate an incident on push delivery. */ }
  }
}
export function startIncidentNotificationWorker() {
  let busy=false;
  const tick=async()=>{if(busy)return;busy=true;try{await deliverIncidentNotifications();}catch{ /* retry next tick */ }finally{busy=false;}};
  void tick();const timer=setInterval(tick,15000);timer.unref();return()=>clearInterval(timer);
}
