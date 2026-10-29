import { pool } from "../config/db.js";
import { MEDICAL_ROLES, SECURITY_ROLES, cityKey, serviceRoles } from "./serviceBaseService.js";
import { incidentScopeSql,incidentTable,getIncidentAccess,coordinatesBase,supervisesBase } from "./incidentAccess.js";
import { getIncidentPolicy,validateIncidentLocation,fail } from "./incidentPolicy.js";
import { chooseAssignment } from "./incidentGeometry.js";
import { enqueueIncidentNotifications } from "./incidentNotifications.js";

export const INCIDENT_STATUSES=["PENDING_ASSIGNMENT","NEW","ACKNOWLEDGED","EN_ROUTE","ON_SITE","COMPLETED","UNCONFIRMED","DUPLICATE","CLOSED","RESOLVED"];
const terminal=["COMPLETED","UNCONFIRMED","DUPLICATE","CLOSED","RESOLVED"];
const labels={PENDING_ASSIGNMENT:"À affecter",NEW:"Nouveau",ACKNOWLEDGED:"Pris en charge",EN_ROUTE:"Équipe envoyée",ON_SITE:"Sur place",COMPLETED:"Intervention terminée",UNCONFIRMED:"Non confirmé",DUPLICATE:"Doublon",CLOSED:"Clôturé",RESOLVED:"Intervention terminée"};
const services=kind=>kind==="medical"?MEDICAL_ROLES:SECURITY_ROLES;
const text=(v,max)=>typeof v==="string"?v.trim().slice(0,max):"";
const numericId=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw fail("Identifiant invalide.");return n;};
function arrivalEstimate(r) {
  if(["ON_SITE","COMPLETED","CLOSED"].includes(r.status))return 0;
  if(!["ACKNOWLEDGED","EN_ROUTE"].includes(r.status)||r.team_latitude==null||r.team_longitude==null)return null;
  const lat=Number(r.latitude),lon=Number(r.longitude),fromLat=Number(r.team_latitude),fromLon=Number(r.team_longitude);
  if(![lat,lon,fromLat,fromLon].every(Number.isFinite))return null;
  const p=Math.PI/180,a=Math.sin((lat-fromLat)*p/2)**2+Math.cos(fromLat*p)*Math.cos(lat*p)*Math.sin((lon-fromLon)*p/2)**2;
  const km=6371*2*Math.asin(Math.sqrt(Math.min(1,a)));
  return Math.max(1,Math.round(Math.max(.5,km*1.35)/(r.status==="ACKNOWLEDGED"?28:35)*60+(r.status==="ACKNOWLEDGED"?4:0)));
}
export function serializeIncident(r) {
  const estimatedArrivalMinutes=arrivalEstimate(r);
  const estimatedArrivalLabel=estimatedArrivalMinutes==null?null:estimatedArrivalMinutes<60?`${estimatedArrivalMinutes} min`:`${Math.floor(estimatedArrivalMinutes/60)} h ${estimatedArrivalMinutes%60} min`;
  return {id:String(r.id),userId:String(r.user_id),targetService:r.target_service,emergencyType:r.emergency_type,
    alertType:r.alert_type,pickupPointName:r.pickup_point_name,locationName:r.location_name,description:r.description,phoneNumber:r.phone_number,
    photos:r.photos||[],latitude:Number(r.latitude),longitude:Number(r.longitude),city:r.city,status:r.status,
    assignedBaseId:r.assigned_base_id==null?null:String(r.assigned_base_id),assignedBaseName:r.assigned_base_name||null,
    assignmentReason:r.assignment_reason,accuracyMeters:r.location_accuracy_meters==null?null:Number(r.location_accuracy_meters),
    locationTimestamp:r.location_timestamp,presenceConfirmed:r.presence_confirmed,victimCount:r.victim_count,estimatedArrivalMinutes,estimatedArrivalLabel,
    probableDuplicate:Array.isArray(r.probable_duplicate_ids)&&r.probable_duplicate_ids.length>0,
    handledBy:r.handled_by==null?null:String(r.handled_by),handledAt:r.handled_at,reporterName:r.reporter_name||null,
    handlerName:r.handler_name||null,handlerBaseName:r.assigned_base_name||null,teamLatitude:r.team_latitude==null?null:Number(r.team_latitude),
    teamLongitude:r.team_longitude==null?null:Number(r.team_longitude),teamNote:r.team_note||null,createdAt:r.created_at,
    userStatusMessage: r.status==="PENDING_ASSIGNMENT"?"Votre signalement attend l’affectation par la coordination.":`Votre signalement : ${labels[r.status]||r.status}.${r.assigned_base_name?` Centre : ${r.assigned_base_name}.`:""}${estimatedArrivalMinutes>0?` Arrivée estimée : ${estimatedArrivalLabel}, selon la dernière position communiquée par l’équipe.`:""}`};
}
export async function recordIncidentEvent(db,kind,id,actor,event,from,to,reason="") {
  await db.query(`INSERT INTO incident_history(kind,report_id,actor_id,event,from_status,to_status,from_base_id,to_base_id,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[kind,id,Number(actor.id),event,from?.status||null,to.status,from?.assigned_base_id||null,to.assigned_base_id||null,reason]);
}
async function operator(req,kind,db=pool) {
  const access=await getIncidentAccess(req.user,db);
  if(!serviceRoles(req.user,services(kind)).length&&!access.coordinateAll&&!access.coordinateBaseIds.length) throw fail("Accès réservé aux agents rattachés à un centre ou à la coordination habilitée.",403);
  return access;
}
function scope(alias,req,kind,params,owner=false) {
  const sql=incidentScopeSql(alias,req.user,params,services(kind),kind);
  if(!owner)return sql;
  params.push(Number(req.user.id));return `(${alias}.user_id=$${params.length} OR ${sql})`;
}
async function fetchScoped(db,req,kind,{owner=false,lock=false}={}) {
  const params=[numericId(req.params.id)],access=scope("r",req,kind,params,owner);
  const result=await db.query(`SELECT r.*,eb.name AS assigned_base_name FROM ${incidentTable(kind)} r LEFT JOIN emergency_bases eb ON eb.id=r.assigned_base_id WHERE r.id=$1 AND ${access}${lock?" FOR UPDATE OF r":""}`,params);
  if(!result.rows.length)throw fail("Signalement introuvable ou non autorisé.",404);
  return result.rows[0];
}
export async function createIncident(kind,req,res) {
  const table=incidentTable(kind),b=req.body||{},target=text(b.targetService,40).toUpperCase();
  const type=text(kind==="medical"?b.emergencyType:b.alertType,120),landmark=text(kind==="medical"?b.pickupPointName:b.locationName,200);
  const description=text(b.description,1000),phone=String(b.phoneNumber||"").replace(/\D/g,"");
  if(!services(kind).includes(target)||type.length<3||landmark.length<3||description.length<10||phone.length!==10)throw fail("Service, type d’incident, repère, description (10 caractères minimum) et téléphone de 10 chiffres obligatoires.");
  if(kind==="security"&&!["AGRESSION","ACCIDENT","INCENDIE","INTRUSION","AUTRE","VOL","ATTROUPEMENT_SUSPECT","DROGUE","AFFRONTEMENT","TROUBLE_URBAIN","ATTAQUE","BRAQUAGE","CONFLIT","COUPEUR_ROUTE","TERRORISME","INONDATION","EFFONDREMENT","FUITE_GAZ","SAUVETAGE"].includes(type))throw fail("Type d’incident de sécurité invalide.");
  const victims=b.victimCount==null?null:b.victimCount;
  if(victims!==null&&(!Number.isInteger(victims)||victims<0||victims>10000))throw fail("Nombre estimé de victimes invalide.");
  const photos=b.photos??[];
  if(!Array.isArray(photos)||photos.length>4||photos.some(p=>typeof p!=="string"||p.length>2500000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(p)))throw fail("Photos invalides : quatre images JPEG, PNG ou WebP maximum.");
  const key=text(b.clientRequestId,100);
  if(!/^[a-zA-Z0-9_-]{12,100}$/.test(key))throw fail("Identifiant d’envoi absent ou invalide. Actualisez le formulaire.");
  const policy=await getIncidentPolicy();
  validateIncidentLocation(b,policy);
  const db=await pool.connect();
  let report,replayed=false;
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock($1::bigint)",[Number(req.user.id)]);
    const prior=await db.query(`SELECT * FROM ${table} WHERE user_id=$1 AND client_request_id=$2`,[Number(req.user.id),key]);
    if(prior.rows.length){report=prior.rows[0];replayed=true;}
    else {
      const count=await db.query(`SELECT COUNT(*)::int AS count FROM (
        SELECT id FROM emergency_reports WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 minute'
        UNION ALL SELECT id FROM security_alerts WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 minute') recent`,[Number(req.user.id)]);
      if(count.rows[0].count>=policy.maxReportsPerMinute)throw fail("Plusieurs signalements ont déjà été envoyés. Attendez une minute et utilisez le suivi pour le même incident.",429);
      const zones=await db.query(`SELECT z.*,eb.is_active AS base_active,eb.approval_status FROM emergency_zones z JOIN emergency_bases eb ON eb.id=z.base_id
        WHERE eb.service_type=$1 AND z.is_active=TRUE AND (z.is_test=FALSE OR $2::boolean) FOR SHARE OF z,eb`,[target,process.env.NODE_ENV==="test"]);
      const assignment=chooseAssignment(zones.rows,[b.longitude,b.latitude]);
      const duplicates=await db.query(`SELECT id FROM ${table} WHERE target_service=$1 AND created_at>NOW()-make_interval(mins=>$2)
        AND status NOT IN ('COMPLETED','CLOSED','RESOLVED','DUPLICATE') AND
        6371000*acos(LEAST(1.0,GREATEST(-1.0,sin(radians(latitude))*sin(radians($3::float8))+
        cos(radians(latitude))*cos(radians($3::float8))*cos(radians(longitude-$4::float8)))))<=$5 ORDER BY created_at DESC LIMIT 10`,
        [target,policy.duplicateWindowMinutes,b.latitude,b.longitude,policy.duplicateDistanceMeters]);
      validateIncidentLocation(b,policy); // Also reject a fix which aged while waiting for locks.
      const columns=kind==="medical"?"emergency_type,pickup_point_name":"alert_type,location_name";
      report=(await db.query(`INSERT INTO ${table}(user_id,target_service,${columns},description,phone_number,photos,latitude,longitude,city,city_key,
        location_timestamp,location_accuracy_meters,presence_confirmed,victim_count,client_request_id,assigned_base_id,assignment_reason,status,probable_duplicate_ids)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [Number(req.user.id),target,type,landmark,description,phone,JSON.stringify(photos),b.latitude,b.longitude,text(b.city,100),cityKey(b.city),
          new Date(b.locationTimestamp),b.accuracyMeters,victims,key,assignment.baseId,assignment.reason,assignment.baseId?"NEW":"PENDING_ASSIGNMENT",JSON.stringify(duplicates.rows.map(r=>String(r.id)))])).rows[0];
      await recordIncidentEvent(db,kind,report.id,req.user,"CREATED",null,report,assignment.reason);
      await enqueueIncidentNotifications(db,kind,report.id,"CREATED");
    }
    await db.query("COMMIT");
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
  res.set("Cache-Control","no-store").status(replayed?200:201).json({message:replayed?"Ce signalement a déjà été reçu.":"Signalement reçu.",report:serializeIncident(report),alert:serializeIncident(report),
    warning:report.probable_duplicate_ids?.length?"Un signalement proche semble concerner le même incident. Votre signalement est conservé pour vérification.":null,replayed});
}
export async function listIncidents(kind,req,res,{mine=false,stats=false,exportCsv=false}={}) {
  if(!mine)await operator(req,kind);
  const params=[];let where;
  if(mine){params.push(Number(req.user.id));where="r.user_id=$1";}else where=scope("r",req,kind,params);
  if(req.query.queue==="1")where+=" AND r.status='PENDING_ASSIGNMENT'";
  if(req.query.status&&INCIDENT_STATUSES.includes(req.query.status)){params.push(req.query.status);where+=` AND r.status=$${params.length}`;}
  for(const [key,op,end] of [["dateFrom",">=","T00:00:00Z"],["dateTo","<=","T23:59:59.999Z"]]) if(/^\d{4}-\d{2}-\d{2}$/.test(req.query[key]||"")) {
    const date=new Date(req.query[key]+end);if(!Number.isNaN(date.getTime())){params.push(date);where+=` AND r.created_at${op}$${params.length}`;}
  }
  res.set("Cache-Control","no-store");
  if(stats){const r=await pool.query(`SELECT status,assigned_base_id,COUNT(*)::int AS count FROM ${incidentTable(kind)} r WHERE ${where} GROUP BY status,assigned_base_id`,params);return res.json(r.rows);}
  const cell=x=>{let value=String(x??"");if(/^\s*[=+@-]/.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"';};
  if(exportCsv) {
    const typeColumn=kind==="medical"?"emergency_type":"alert_type",landmarkColumn=kind==="medical"?"pickup_point_name":"location_name";
    const rows=await pool.query(`SELECT r.id,r.status,eb.name AS base_name,r.${typeColumn} AS incident_type,r.${landmarkColumn} AS landmark,r.created_at
      FROM ${incidentTable(kind)} r LEFT JOIN emergency_bases eb ON eb.id=r.assigned_base_id WHERE ${where} ORDER BY r.id DESC`,params);
    res.set("Content-Disposition",`attachment; filename="signalements-${kind}.csv"`).type("text/csv");
    return res.send("\ufeffid;statut;centre;type;repere;date\r\n"+rows.rows.map(x=>[x.id,x.status,x.base_name,x.incident_type,x.landmark,x.created_at].map(cell).join(";")).join("\r\n"));
  }
  if(req.query.beforeId){params.push(numericId(req.query.beforeId));where+=` AND r.id<$${params.length}`;}
  const commonColumns="id,user_id,target_service,description,phone_number,latitude,longitude,city,status,assigned_base_id,assignment_reason,location_timestamp,location_accuracy_meters,presence_confirmed,victim_count,probable_duplicate_ids,handled_by,handled_at,created_at";
  const fields=(commonColumns+","+(kind==="medical"?"emergency_type,pickup_point_name,team_latitude,team_longitude,team_note":"alert_type,location_name")).split(",").map(c=>`r.${c}`).join(",");
  // Photos are fetched only by an authorized detail/photo request, never in bulk lists.
  const r=await pool.query(`SELECT ${fields},eb.name AS assigned_base_name,u.full_name AS reporter_name,hu.full_name AS handler_name FROM ${incidentTable(kind)} r
    LEFT JOIN emergency_bases eb ON eb.id=r.assigned_base_id JOIN users u ON u.id=r.user_id LEFT JOIN users hu ON hu.id=r.handled_by
    WHERE ${where} ORDER BY r.id DESC LIMIT 300`,params);
  res.json(r.rows.map(serializeIncident));
}
export async function incidentDetail(kind,req,res,{photo=false}={}) {
  const r=await fetchScoped(pool,req,kind,{owner:true});
  res.set("Cache-Control","no-store");
  if(photo){const index=Number(req.params.index),data=r.photos?.[index];
    if(!Number.isInteger(index)||index<0||typeof data!=="string"||!/^data:image\/(jpeg|png|webp);base64,/.test(data))throw fail("Photo introuvable.",404);
    const [head,body]=data.split(",");return res.set("X-Content-Type-Options","nosniff").type(head.slice(5).split(";")[0]).send(Buffer.from(body,"base64"));}
  const history=await pool.query(`SELECT h.*,u.full_name AS actor_name FROM incident_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.kind=$1 AND h.report_id=$2 ORDER BY h.id`,[kind,r.id]);
  const mine=String(r.user_id)===String(req.user.id);
  res.json({...serializeIncident(r),history:history.rows.map(h=>mine?{event:h.event,to_status:h.to_status,created_at:h.created_at}:h)});
}
export async function changeIncidentStatus(kind,req,res,forcedStatus) {
  await operator(req,kind);
  const status=forcedStatus||(req.body?.status==="RESOLVED"?"COMPLETED":req.body?.status);
  if(!INCIDENT_STATUSES.includes(status)||["NEW","PENDING_ASSIGNMENT","CLOSED","RESOLVED"].includes(status))throw fail("Statut d’intervention invalide.");
  const db=await pool.connect();let updated;
  try {
    await db.query("BEGIN");const prior=await fetchScoped(db,req,kind,{lock:true});
    const access=await getIncidentAccess(req.user,db),coordinator=coordinatesBase(access,prior.assigned_base_id);
    const next={NEW:["ACKNOWLEDGED"],ACKNOWLEDGED:["EN_ROUTE"],EN_ROUTE:["ON_SITE"],ON_SITE:["COMPLETED"]};
    if(!coordinator && !(next[prior.status]||[]).includes(status) && !( !terminal.includes(prior.status) && ["UNCONFIRMED","DUPLICATE"].includes(status)))throw fail("Transition de statut non autorisée.",409);
    const note=text(req.body?.teamNote||req.body?.reason,1000);
    if(["UNCONFIRMED","DUPLICATE"].includes(status)&&note.length<5)throw fail("Un motif est obligatoire pour ce statut.");
    const lat=req.body?.teamLatitude,lon=req.body?.teamLongitude;
    if((lat!=null||lon!=null)&&!(typeof lat==="number"&&typeof lon==="number"&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180))throw fail("Position de l’équipe invalide.");
    const params=[prior.id,status,Number(req.user.id),note];
    let team="";
    if(kind==="medical"){params.push(lat??null,lon??null);team=",team_latitude=COALESCE($5,team_latitude),team_longitude=COALESCE($6,team_longitude),team_note=CASE WHEN $4='' THEN team_note ELSE $4 END";}
    // $4 is also typed for security reports even though they have no legacy team_note column.
    updated=(await db.query(`UPDATE ${incidentTable(kind)} SET status=$2,handled_by=COALESCE(handled_by,$3),handled_at=COALESCE(handled_at,NOW())${team} WHERE id=$1 AND $4::text IS NOT NULL RETURNING *`,params)).rows[0];
    await recordIncidentEvent(db,kind,prior.id,req.user,"STATUS",prior,updated,note);
    await db.query("COMMIT");
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
  res.set("Cache-Control","no-store").json({message:"Statut mis à jour.",report:serializeIncident(updated),alert:serializeIncident(updated)});
}
export async function transferIncident(kind,req,res) {
  const b=req.body||{},target=numericId(b.targetBaseId),reason=text(b.reason,1000);
  if(!["TRANSFER","REINFORCEMENT"].includes(b.mode)||reason.length<5||b.authorizeTarget!==true)throw fail("Choisissez transfert ou renfort, un motif et confirmez explicitement l’accès du centre destinataire.");
  const db=await pool.connect();let updated;
  try {
    await db.query("BEGIN");const prior=await fetchScoped(db,req,kind,{lock:true}),access=await getIncidentAccess(req.user,db);
    if(!supervisesBase(access,prior.assigned_base_id))throw fail("Transfert réservé à la coordination ou au responsable du centre affecté.",403);
    if(terminal.includes(prior.status))throw fail("Ce signalement est terminé.",409);
    const dest=(await db.query("SELECT * FROM emergency_bases WHERE id=$1 AND is_active=TRUE AND approval_status='APPROVED' FOR SHARE",[target])).rows[0];
    if(!dest||dest.service_type!==prior.target_service||String(prior.assigned_base_id)===String(target))throw fail("Le destinataire doit être un autre centre actif du même service.");
    if(b.mode==="TRANSFER") {
      updated=(await db.query(`UPDATE ${incidentTable(kind)} SET assigned_base_id=$2,assignment_reason='MANUAL_TRANSFER',status='NEW',handled_by=NULL,handled_at=NULL${kind==="medical"?",team_latitude=NULL,team_longitude=NULL,team_note=NULL":""} WHERE id=$1 RETURNING *`,[prior.id,target])).rows[0];
      await db.query("DELETE FROM incident_grants WHERE kind=$1 AND report_id=$2",[kind,prior.id]);
    }else {
      if(!prior.assigned_base_id)throw fail("Affectez d’abord le signalement à un centre.");
      await db.query(`INSERT INTO incident_grants(kind,report_id,base_id,granted_by,reason) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(kind,report_id,base_id) DO UPDATE SET granted_by=$4,reason=$5,created_at=NOW()`,[kind,prior.id,target,Number(req.user.id),reason]);
      updated=prior;
    }
    await recordIncidentEvent(db,kind,prior.id,req.user,b.mode,prior,{...updated,assigned_base_id:target},reason);
    const event=(await db.query("SELECT max(id)::text AS id FROM incident_history WHERE kind=$1 AND report_id=$2",[kind,prior.id])).rows[0].id;
    await enqueueIncidentNotifications(db,kind,prior.id,`${b.mode}_${event}`,target);
    await db.query("COMMIT");
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
  res.set("Cache-Control","no-store").json({message:b.mode==="TRANSFER"?"Signalement transféré ; l’ancien centre n’y a plus accès.":"Renfort autorisé : le centre destinataire peut maintenant consulter l’incident.",report:serializeIncident(updated)});
}
export async function transferTargets(req,res) {
  const access=await getIncidentAccess(req.user);
  if(!access.coordinateAll&&!access.coordinateBaseIds.length&&!access.supervisorBaseIds.length)throw fail("Réservé aux responsables habilités.",403);
  const r=await pool.query("SELECT id,name,city,service_type FROM emergency_bases WHERE is_active=TRUE AND approval_status='APPROVED' ORDER BY service_type,name");
  res.set("Cache-Control","no-store").json(r.rows);
}
export async function revokeReinforcement(kind,req,res) {
  const db=await pool.connect();
  try {
    await db.query("BEGIN");const prior=await fetchScoped(db,req,kind,{lock:true}),access=await getIncidentAccess(req.user,db);
    if(!supervisesBase(access,prior.assigned_base_id))throw fail("Accès refusé.",403);
    const baseId=numericId(req.body?.targetBaseId),reason=text(req.body?.reason,1000);
    if(reason.length<5)throw fail("Motif obligatoire.");
    const r=await db.query("DELETE FROM incident_grants WHERE kind=$1 AND report_id=$2 AND base_id=$3 RETURNING base_id",[kind,prior.id,baseId]);
    if(!r.rows.length)throw fail("Renfort introuvable.",404);
    await recordIncidentEvent(db,kind,prior.id,req.user,"REINFORCEMENT_REVOKED",prior,{...prior,assigned_base_id:baseId},reason);
    await db.query("COMMIT");res.json({ok:true});
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
}
