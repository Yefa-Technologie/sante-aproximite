import { pool } from "../config/db.js";
import { serviceRoles, SERVICE_ROLES } from "./serviceBaseService.js";
export const incidentTable = kind => {
  if(kind!=="medical" && kind!=="security") throw new Error("Invalid incident kind");
  return kind==="medical"?"emergency_reports":"security_alerts";
};
export function incidentScopeSql(alias,user,params,allowed=SERVICE_ROLES,kind="medical") {
  incidentTable(kind);
  params.push(Number(user.id),serviceRoles(user,allowed));
  const uid=`$${params.length-1}`, roles=`$${params.length}::text[]`;
  const bases=`(eb.id=${alias}.assigned_base_id OR EXISTS(SELECT 1 FROM incident_grants ig WHERE ig.kind='${kind}' AND ig.report_id=${alias}.id AND ig.base_id=eb.id))`;
  return `(EXISTS(SELECT 1 FROM incident_access_roles iar WHERE iar.user_id=${uid} AND
    (iar.coordinate_all OR ${alias}.assigned_base_id=ANY(iar.coordinate_base_ids) OR EXISTS(
      SELECT 1 FROM incident_grants cg WHERE cg.kind='${kind}' AND cg.report_id=${alias}.id AND cg.base_id=ANY(iar.coordinate_base_ids))))
    OR EXISTS(SELECT 1 FROM user_service_bases usb JOIN emergency_bases eb ON eb.id=usb.base_id
      WHERE usb.user_id=${uid} AND usb.service_type=ANY(${roles}) AND eb.service_type=${alias}.target_service
      AND eb.is_active=TRUE AND eb.approval_status='APPROVED' AND ${bases}))`;
}
export async function getIncidentAccess(user,db=pool) {
  const {rows}=await db.query("SELECT coordinate_all,coordinate_base_ids,supervisor_base_ids FROM incident_access_roles WHERE user_id=$1",[Number(user.id)]);
  const r=rows[0]||{};
  return {coordinateAll:r.coordinate_all===true,coordinateBaseIds:(r.coordinate_base_ids||[]).map(String),supervisorBaseIds:(r.supervisor_base_ids||[]).map(String)};
}
export const coordinatesBase = (access,id) => access.coordinateAll || (id!=null && access.coordinateBaseIds.includes(String(id)));
export const supervisesBase = (access,id) => coordinatesBase(access,id) || (id!=null && access.supervisorBaseIds.includes(String(id)));
