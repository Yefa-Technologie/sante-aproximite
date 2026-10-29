import { enqueueIncidentNotifications } from "./incidentNotifications.js";
export async function requeueInactiveCenter(db,baseId,actorId) {
  for(const [kind,table] of [["medical","emergency_reports"],["security","security_alerts"]]) {
    const active=await db.query(`SELECT id,status FROM ${table} WHERE assigned_base_id=$1 AND status IN ('NEW','ACKNOWLEDGED','EN_ROUTE','ON_SITE') FOR UPDATE`,[baseId]);
    for(const prior of active.rows) {
      await db.query(`UPDATE ${table} SET assigned_base_id=NULL,assignment_reason='INACTIVE_CENTER',status='PENDING_ASSIGNMENT',handled_by=NULL,handled_at=NULL${kind==="medical"?",team_latitude=NULL,team_longitude=NULL,team_note=NULL":""} WHERE id=$1`,[prior.id]);
      await db.query("DELETE FROM incident_grants WHERE kind=$1 AND report_id=$2",[kind,prior.id]);
      const event=await db.query(`INSERT INTO incident_history(kind,report_id,actor_id,event,from_status,to_status,from_base_id,reason)
        VALUES($1,$2,$3,'CENTER_DEACTIVATED',$4,'PENDING_ASSIGNMENT',$5,'Centre affecté désactivé : réaffectation nécessaire') RETURNING id`,[kind,prior.id,actorId,prior.status,baseId]);
      await enqueueIncidentNotifications(db,kind,prior.id,`CENTER_DEACTIVATED_${event.rows[0].id}`);
    }
  }
}
