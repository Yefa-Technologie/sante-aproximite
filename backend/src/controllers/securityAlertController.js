import { baseScopeSql, serviceRoles, SECURITY_ROLES, cityKey } from "../services/serviceBaseService.js";
import { notifyLocalEmergency } from "../services/localEmergencyService.js";
import { pool } from "../config/db.js";

const VALID_ALERT_TYPES = ["AGRESSION", "ACCIDENT", "INCENDIE", "INTRUSION", "AUTRE"];
const VALID_STATUSES = ["NEW", "ACKNOWLEDGED", "RESOLVED", "CLOSED"];
const VALID_TARGET_SERVICES = ["POLICE", "GENDARMERIE", "PROTECTION_CIVILE"];

function normalizeText(raw, max = 500) {
  const value = String(raw || "").trim();
  return value.slice(0, max);
}

function normalizePhoneNumber(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 20);
}

function parseLatitude(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < -90 || value > 90) return null;
  return value;
}

function parseLongitude(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < -180 || value > 180) return null;
  return value;
}

function normalizePhotos(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .filter((item) => item.length <= 2_500_000);
}

function normalizeAlertRow(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    targetService: row.target_service,
    alertType: row.alert_type,
    locationName: row.location_name,
    description: row.description,
    phoneNumber: row.phone_number,
    photos: Array.isArray(row.photos) ? row.photos : [],
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    status: row.status,
    handledBy: row.handled_by == null ? null : String(row.handled_by),
    handledAt: row.handled_at || null,
    reporterName: row.reporter_name || null,
    handlerName: row.handler_name || null,
    createdAt: row.created_at
  };
}

export async function createSecurityAlert(req, res) {
  const targetService = String(req.body?.targetService || "").trim().toUpperCase();
  const alertType     = String(req.body?.alertType     || "").trim().toUpperCase();
  const locationName  = normalizeText(req.body?.locationName, 200);
  const description   = normalizeText(req.body?.description, 2000);
  const phoneNumber   = normalizePhoneNumber(req.body?.phoneNumber);
  const photos        = normalizePhotos(req.body?.photos);
  const latitude      = parseLatitude(req.body?.latitude);
  const longitude     = parseLongitude(req.body?.longitude);

  if (!VALID_TARGET_SERVICES.includes(targetService)) {
    return res.status(400).json({ message: "Service destinataire invalide (POLICE, GENDARMERIE ou PROTECTION_CIVILE)." });
  }
  if (!VALID_ALERT_TYPES.includes(alertType)) {
    return res.status(400).json({ message: "Type d'alerte invalide." });
  }
  if (locationName.length < 3) {
    return res.status(400).json({ message: "Nom du lieu obligatoire (min 3 caracteres)." });
  }
  if (description.length < 10) {
    return res.status(400).json({ message: "Description trop courte (minimum 10 caracteres)." });
  }
  if (phoneNumber.length !== 10) {
    return res.status(400).json({ message: "Numero de telephone invalide (10 chiffres requis)." });
  }
  if (latitude == null || longitude == null) {
    return res.status(400).json({ message: "Position GPS invalide." });
  }

  const result = await pool.query(
    `
      INSERT INTO security_alerts (
        user_id, target_service, alert_type, location_name, description,
        phone_number, photos, latitude, longitude, city, city_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
      RETURNING *;
    `,
    [
      Number(req.user.id),
      targetService,
      alertType,
      locationName,
      description,
      phoneNumber,
      JSON.stringify(photos),
      latitude,
      longitude, String(req.body?.city || "").trim().slice(0,100), cityKey(req.body?.city)
    ]
  );

  void notifyLocalEmergency(result.rows[0], { kind: "security" }).catch(() => {});
  return res.status(201).json({
    message: "Alerte securite envoyee.",
    alert: normalizeAlertRow(result.rows[0])
  });
}

export async function getAllSecurityAlerts(req, res) {
  if (!serviceRoles(req.user, SECURITY_ROLES).length) {
    return res.status(403).json({ message: "Acces refuse." });
  }

  const statusFilter = VALID_STATUSES.includes(String(req.query?.status || "").toUpperCase())
    ? String(req.query.status).toUpperCase()
    : null;

  const params = [];
  const where  = [];

  where.push(baseScopeSql("sa", req.user, params, SECURITY_ROLES));
  if (statusFilter) {
    where.push(`sa.status = $${params.length + 1}`);
    params.push(statusFilter);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT sa.*, u.full_name AS reporter_name, hu.full_name AS handler_name
      FROM security_alerts sa
      JOIN users u ON u.id = sa.user_id
      LEFT JOIN users hu ON hu.id = sa.handled_by
      ${whereClause}
      ORDER BY
        CASE sa.status WHEN 'NEW' THEN 1 WHEN 'ACKNOWLEDGED' THEN 2 WHEN 'RESOLVED' THEN 3 ELSE 4 END,
        sa.created_at DESC
      LIMIT 300;
    `,
    params
  );

  return res.json(result.rows.map(normalizeAlertRow));
}

export async function updateSecurityAlertStatus(req, res) {
  if (!serviceRoles(req.user, SECURITY_ROLES).length) {
    return res.status(403).json({ message: "Acces refuse." });
  }

  const alertId = Number(req.params.id);
  if (!Number.isInteger(alertId) || alertId <= 0) {
    return res.status(400).json({ message: "ID alerte invalide." });
  }

  const status = String(req.body?.status || "").trim().toUpperCase();
  if (!VALID_STATUSES.includes(status) || status === "NEW") {
    return res.status(400).json({ message: "Statut invalide (ACKNOWLEDGED, RESOLVED ou CLOSED)." });
  }

  const queryParams = [alertId, status, Number(req.user.id)];
  const scope = baseScopeSql("sa", req.user, queryParams, SECURITY_ROLES);
  const updated = await pool.query(
    `
      UPDATE security_alerts sa
      SET
        status     = $2,
        handled_by = COALESCE(sa.handled_by, $3),
        handled_at = COALESCE(sa.handled_at, NOW())
      WHERE sa.id = $1
        AND ${scope} AND (sa.handled_by IS NULL OR sa.handled_by=$3)
      RETURNING *;
    `,
    queryParams
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ message: "Alerte introuvable ou non attribuee a votre service." });
  }

  return res.json({ message: "Alerte mise a jour.", alert: normalizeAlertRow(updated.rows[0]) });
}

export async function getMySecurityAlerts(req, res) {
  const result = await pool.query(
    `
      SELECT sa.*
      FROM security_alerts sa
      WHERE sa.user_id = $1
      ORDER BY sa.created_at DESC
      LIMIT 100;
    `,
    [Number(req.user.id)]
  );

  return res.json(result.rows.map(normalizeAlertRow));
}
