import { pool } from "../config/db.js";

export const SERVICE_ROLES = ["SAMU", "SAPEUR_POMPIER", "POLICE", "GENDARMERIE", "PROTECTION_CIVILE"];
export const MEDICAL_ROLES = ["SAMU", "SAPEUR_POMPIER"];
export const SECURITY_ROLES = ["POLICE", "GENDARMERIE", "PROTECTION_CIVILE"];
export const BASE_ADMIN_ROLES = ["DEVELOPER", "NATIONAL", "REGULATOR"];
export const roleKey = (r) => String(r || "").trim().toUpperCase().replace(/^SAPPEUR_POMPIER$/, "SAPEUR_POMPIER");
export const rolesOf = (user) => [...new Set([...(user?.roles || []), user?.role].map(roleKey).filter(Boolean))];
export const serviceRoles = (user, allowed = SERVICE_ROLES) => rolesOf(user).filter((r) => allowed.includes(r));
export const canManageBases = (user) => rolesOf(user).some((r) => BASE_ADMIN_ROLES.includes(r));
export const cityKey = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 100);
function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }

// Every operational query (including mutations by ID) uses this same base/service scope.
export function baseScopeSql(alias, user, params, allowed = SERVICE_ROLES) {
  const services = serviceRoles(user, allowed);
  if (!services.length) return "FALSE";
  params.push(Number(user.id), services);
  const id = `$${params.length - 1}`, types = `$${params.length}::text[]`;
  return `EXISTS (SELECT 1 FROM user_service_bases usb JOIN emergency_bases eb ON eb.id=usb.base_id
    WHERE usb.user_id=${id} AND usb.service_type=ANY(${types}) AND eb.service_type=${alias}.target_service
    AND eb.is_active=TRUE AND eb.approval_status='APPROVED'
    AND ((eb.city_key <> '' AND eb.city_key=${alias}.city_key) OR
      6371*acos(LEAST(1.0,GREATEST(-1.0,sin(radians(eb.latitude))*sin(radians(${alias}.latitude))+
      cos(radians(eb.latitude))*cos(radians(${alias}.latitude))*cos(radians(eb.longitude-${alias}.longitude))))) <= eb.radius_km))`;
}

export function mapBase(row) {
  return { id: String(row.id), name: row.name, serviceType: row.service_type, address: row.address,
    city: row.city || "", latitude: Number(row.latitude), longitude: Number(row.longitude),
    radiusKm: Number(row.radius_km || 20), isActive: row.is_active !== false };
}

export async function resolveServiceBases(db, actor, roles, payload, userId = null) {
  const required = roles.map(roleKey).filter((r) => SERVICE_ROLES.includes(r));
  let supplied = payload.serviceBases;
  if (supplied !== undefined && (!supplied || typeof supplied !== "object" || Array.isArray(supplied))) throw invalid("Affectation aux bases invalide.");
  if (supplied === undefined && userId) {
    const current = await db.query("SELECT service_type,base_id FROM user_service_bases WHERE user_id=$1", [userId]);
    supplied = Object.fromEntries(current.rows.map((r) => [r.service_type, String(r.base_id)]));
  }
  supplied ||= {};
  const assignments = {};
  for (const service of required) {
    const id = Number(supplied[service]);
    if (!Number.isSafeInteger(id) || id <= 0) throw invalid(`Une base ${service} est obligatoire pour ce compte.`);
    const found = await db.query("SELECT id,service_type FROM emergency_bases WHERE id=$1 AND is_active=TRUE AND approval_status='APPROVED' FOR SHARE", [id]);
    if (found.rows[0]?.service_type !== service) throw invalid(`La base sélectionnée ne correspond pas au rôle ${service}, ou elle est inactive.`);
    if (!canManageBases(actor)) {
      const own = await db.query("SELECT 1 FROM user_service_bases WHERE user_id=$1 AND base_id=$2 AND service_type=$3", [Number(actor.id), id, service]);
      if (!serviceRoles(actor).includes(service) || !own.rows.length) throw invalid("Vous ne pouvez affecter un compte qu’à votre propre base et service.", 403);
    }
    assignments[service] = id;
  }
  return assignments;
}

export async function saveServiceBases(db, userId, assignments) {
  await db.query("DELETE FROM user_service_bases WHERE user_id=$1", [userId]);
  for (const [service, id] of Object.entries(assignments)) {
    await db.query("INSERT INTO user_service_bases(user_id,service_type,base_id) VALUES ($1,$2,$3)", [userId, service, id]);
  }
}

export async function listServiceBases(req, res) {
  const params = [];
  let scope = "TRUE";
  if (!canManageBases(req.user)) {
    params.push(Number(req.user.id), serviceRoles(req.user)); scope = "eb.is_active=TRUE AND EXISTS(SELECT 1 FROM user_service_bases usb WHERE usb.base_id=eb.id AND usb.user_id=$1 AND usb.service_type=ANY($2::text[]))";
  }
  const rows = await pool.query(`SELECT eb.* FROM emergency_bases eb WHERE ${scope} ORDER BY eb.service_type,eb.name`, params);
  res.json(rows.rows.map(mapBase));
}

export async function myServiceBases(req, res) {
  const rows = await pool.query(`SELECT eb.* FROM emergency_bases eb JOIN user_service_bases usb ON usb.base_id=eb.id
    WHERE usb.user_id=$1 AND usb.service_type=ANY($2::text[]) AND eb.is_active=TRUE AND eb.approval_status='APPROVED'`, [Number(req.user.id), serviceRoles(req.user)]);
  res.json(rows.rows.map(mapBase));
}

export async function writeServiceBase(req, res) {
  if (!canManageBases(req.user)) return res.status(403).json({ message: "La gestion des bases est réservée à l’administration habilitée." });
  const body = req.body || {}, type = roleKey(body.serviceType);
  const name = String(body.name || "").trim().slice(0,160), city = String(body.city || "").trim().slice(0,100);
  const address = String(body.address || "").trim().slice(0,320), lat = body.latitude, lon = body.longitude, radius = Number(body.radiusKm ?? 20);
  if (!SERVICE_ROLES.includes(type) || !name || !city || !address || typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180 || (lat===0 && lon===0) || !Number.isFinite(radius) || radius<1 || radius>200) {
    return res.status(400).json({ message: "Renseignez le service, le nom, la ville, l’adresse, des coordonnées GPS valides et un rayon de 1 à 200 km." });
  }
  const values = [name,type,address,lat,lon,Number(req.user.id),city,cityKey(city),radius,body.isActive !== false];
  let result;
  if (req.params.id) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id<=0) return res.sendStatus(400);
    // Service is immutable, so an assigned SAMU base cannot become a police station.
    result = await pool.query(`UPDATE emergency_bases SET name=$1,address=$3,latitude=$4,longitude=$5,
      city=$6,city_key=$7,radius_km=$8,is_active=$9,updated_at=NOW()
      WHERE id=$10 AND service_type=$2 RETURNING *`, [...values.filter((_,i)=>i!==5),id]);
    if (!result.rows.length) return res.status(400).json({ message: "Base introuvable ou changement de service interdit. Créez une autre base pour un autre service." });
  } else result = await pool.query(`INSERT INTO emergency_bases(name,service_type,address,latitude,longitude,created_by,city,city_key,radius_km,is_active,approval_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'APPROVED') RETURNING *`, values);
  res.status(req.params.id ? 200 : 201).json(mapBase(result.rows[0]));
}

// Operational account managers may only modify accounts of their own base/service.
export async function canManageServiceAccount(actor, userId) {
  if (canManageBases(actor) || !serviceRoles(actor).length) return true;
  const result = await pool.query(`SELECT u.role,
    ARRAY(SELECT role FROM user_roles WHERE user_id=u.id) AS roles,
    EXISTS(SELECT 1 FROM user_service_bases t JOIN user_service_bases a ON a.base_id=t.base_id AND a.service_type=t.service_type WHERE t.user_id=u.id AND a.user_id=$2) AS same_base
    FROM users u WHERE u.id=$1`, [Number(userId),Number(actor.id)]);
  const target=result.rows[0], own=serviceRoles(actor);
  return !!target?.same_base && rolesOf(target).every(r=>own.includes(r));
}
