import { pool } from "../config/db.js";
import { canManageBases } from "../services/serviceBaseService.js";
import { getIncidentPolicy,fail } from "../services/incidentPolicy.js";
import { getIncidentAccess } from "../services/incidentAccess.js";
import { validatePolygon } from "../services/incidentGeometry.js";
export async function readPolicy(req,res) {res.set("Cache-Control","no-store").json(await getIncidentPolicy());}
export async function writePolicy(req,res) {
  if(!canManageBases(req.user)) throw fail("Gestion des paramètres réservée à l’administration.",403);
  const p=req.body||{};
  for(const [key,min,max] of [["maxAgeSeconds",5,600],["maxAccuracyMeters",1,5000],["maxReportsPerMinute",1,30],["duplicateWindowMinutes",1,120],["duplicateDistanceMeters",10,2000]]) {
    if(typeof p[key]!=="number" || !Number.isFinite(p[key]) || p[key]<min || p[key]>max || (key!=="maxAccuracyMeters" && !Number.isInteger(p[key]))) throw fail(`Paramètre ${key} invalide (${min} à ${max}).`);
  }
  await pool.query(`UPDATE incident_policy SET max_age_seconds=$1,max_accuracy_meters=$2,max_reports_per_minute=$3,duplicate_window_minutes=$4,duplicate_distance_meters=$5 WHERE id=1`,[p.maxAgeSeconds,p.maxAccuracyMeters,p.maxReportsPerMinute,p.duplicateWindowMinutes,p.duplicateDistanceMeters]);
  res.json(await getIncidentPolicy());
}
export async function readAccess(req,res) {res.set("Cache-Control","no-store").json(await getIncidentAccess(req.user));}
export async function listAccess(req,res) {
  if(!canManageBases(req.user)) throw fail("Accès refusé.",403);
  const r=await pool.query("SELECT user_id,coordinate_all,coordinate_base_ids,supervisor_base_ids FROM incident_access_roles ORDER BY user_id");res.json(r.rows);
}
export async function writeAccess(req,res) {
  if(!canManageBases(req.user)) throw fail("Gestion des droits réservée à l’administration.",403);
  const id=Number(req.params.userId),b=req.body||{};
  if(!Number.isSafeInteger(id)||id<=0||typeof b.coordinateAll!=="boolean") throw fail("Utilisateur ou droits invalides.");
  const lists=[];
  for(const name of ["coordinateBaseIds","supervisorBaseIds"]) {
    if(!Array.isArray(b[name]) || b[name].length>200 || !b[name].every(x=>Number.isSafeInteger(Number(x))&&Number(x)>0)) throw fail("Liste de centres invalide.");
    lists.push([...new Set(b[name].map(Number))]);
  }
  const all=[...new Set(lists.flat())];
  const db=await pool.connect();
  try {
    await db.query("BEGIN");
    const u=await db.query("SELECT id FROM users WHERE id=$1 AND is_active=TRUE FOR SHARE",[id]);
    const bases=await db.query("SELECT id FROM emergency_bases WHERE id=ANY($1::bigint[]) FOR SHARE",[all]);
    if(!u.rows.length||bases.rows.length!==all.length) throw fail("Utilisateur ou centre introuvable.");
    // A local supervisor must actually be attached to every supervised center.
    const linked=await db.query("SELECT base_id FROM user_service_bases WHERE user_id=$1 AND base_id=ANY($2::bigint[])",[id,lists[1]]);
    if(linked.rows.length!==lists[1].length) throw fail("Un responsable doit être rattaché aux centres qu’il supervise.");
    await db.query(`INSERT INTO incident_access_roles(user_id,coordinate_all,coordinate_base_ids,supervisor_base_ids,updated_by)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET coordinate_all=$2,coordinate_base_ids=$3,supervisor_base_ids=$4,updated_by=$5,updated_at=NOW()`,[id,b.coordinateAll,...lists,Number(req.user.id)]);
    await db.query("COMMIT");
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
  res.json({ok:true});
}
export async function listZones(req,res) {
  if(!canManageBases(req.user)) throw fail("Accès refusé.",403);
  const r=await pool.query(`SELECT z.*,eb.name AS base_name,eb.service_type FROM emergency_zones z JOIN emergency_bases eb ON eb.id=z.base_id ORDER BY z.id DESC`);res.json(r.rows);
}
export async function writeZone(req,res) {
  if(!canManageBases(req.user)) throw fail("Gestion des zones réservée à l’administration.",403);
  const b=req.body||{},name=String(b.name||"").trim().slice(0,160),baseId=Number(b.baseId);
  if(!name||!Number.isSafeInteger(baseId)||baseId<=0||typeof b.isActive!=="boolean"||typeof b.isTest!=="boolean") throw fail("Nom, centre, activation et indication de zone fictive obligatoires.");
  if(b.isTest && !/ficti|test/i.test(name)) throw fail("Une zone de test doit porter TEST ou FICTIF dans son nom.");
  try{validatePolygon(b.geometry);}catch(e){throw fail(e.message);}
  const db=await pool.connect();
  try {
    await db.query("BEGIN");
    if(!(await db.query("SELECT id FROM emergency_bases WHERE id=$1 FOR SHARE",[baseId])).rows.length) throw fail("Centre introuvable.");
    const values=[baseId,name,JSON.stringify(b.geometry),b.isActive,b.isTest,Number(req.user.id)];
    let r;
    if(req.params.id) {
      const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0) throw fail("Zone invalide.");
      r=await db.query("UPDATE emergency_zones SET base_id=$1,name=$2,geometry=$3,is_active=$4,is_test=$5,updated_by=$6,updated_at=NOW() WHERE id=$7 RETURNING *",[...values,id]);
      if(!r.rows.length) throw fail("Zone introuvable.",404);
    }else r=await db.query("INSERT INTO emergency_zones(base_id,name,geometry,is_active,is_test,updated_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",values);
    await db.query("COMMIT");res.status(req.params.id?200:201).json(r.rows[0]);
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
}
