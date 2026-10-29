import { pool } from "../config/db.js";
import { cityKey, notifyLocalEmergency } from "../services/localEmergencyService.js";

const TARGET_SERVICE_MAP = {
  SAMU: "SAMU",
  SAPEUR_POMPIER: "SAPEUR_POMPIER",
  SAPEUR_POMPIER: "SAPEUR_POMPIER",  // ancienne orthographe (double P)
  POMPIER: "SAPEUR_POMPIER",
  POMPIERS: "SAPEUR_POMPIER",
  POLICE: "POLICE",
  GENDARMERIE: "GENDARMERIE",
  PROTECTION_CIVILE: "PROTECTION_CIVILE"
};

const BASE_STATUS_VALUES = ["NEW", "ACKNOWLEDGED", "EN_ROUTE", "ON_SITE", "COMPLETED", "CLOSED"];

const EMERGENCY_ALLOWED_ROLES = new Set([
  "DEVELOPER",
  "SAMU",
  "SAPEUR_POMPIER",
  "SAPEUR_POMPIER",  // ancienne orthographe DB (double P)
  "POLICE",
  "GENDARMERIE",
  "PROTECTION_CIVILE",
  "REGULATOR",
  "NATIONAL",
  "REGION",
  "DISTRICT"
]);

function serviceFromRole(role) {
  if (role === "SAMU") return "SAMU";
  if (role === "SAPEUR_POMPIER" || role === "SAPEUR_POMPIER") return "SAPEUR_POMPIER";
  if (role === "POLICE") return "POLICE";
  if (role === "GENDARMERIE") return "GENDARMERIE";
  if (role === "PROTECTION_CIVILE") return "PROTECTION_CIVILE";
  return null;
}

// Retourne toutes les variantes acceptees pour un service (compatibilite ancienne BD)
function serviceVariants(service) {
  if (service === "SAPEUR_POMPIER") return ["SAPEUR_POMPIER", "SAPEUR_POMPIER"];
  return [service];
}

function normalizeTargetService(raw) {
  const value = String(raw || "").trim().toUpperCase();
  return TARGET_SERVICE_MAP[value] || null;
}

function normalizeText(raw, max = 500) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.slice(0, max);
}

function normalizePhoneNumber(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 20);
}

function parseLatitude(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (value < -90 || value > 90) return null;
  return value;
}

function parseLongitude(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (value < -180 || value > 180) return null;
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

function normalizeEmergencyStatus(rawStatus) {
  const value = String(rawStatus || "").trim().toUpperCase();
  if (!BASE_STATUS_VALUES.includes(value)) return null;
  return value;
}

function parseDateBoundary(raw, endOfDay = false) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dateOnly) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const parsed = new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}${suffix}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function estimateArrivalMinutes(row) {
  const status = String(row?.status || "").toUpperCase();
  if (["ON_SITE", "COMPLETED", "CLOSED"].includes(status)) return 0;
  if (!["ACKNOWLEDGED", "EN_ROUTE"].includes(status)) return null;

  const toLat = toNumberOrNull(row?.latitude);
  const toLon = toNumberOrNull(row?.longitude);
  if (toLat == null || toLon == null) return null;

  // ETA must be based on the real-time responder position only.
  const fromLat = toNumberOrNull(row?.team_latitude);
  const fromLon = toNumberOrNull(row?.team_longitude);
  if (fromLat == null || fromLon == null) return null;

  const directKm = haversineKm(fromLat, fromLon, toLat, toLon);
  const roadKm = Math.max(0.5, directKm * 1.35);
  const speedKmH = status === "ACKNOWLEDGED" ? 28 : 35;
  const prepMinutes = status === "ACKNOWLEDGED" ? 4 : 0;
  const eta = Math.round((roadKm / speedKmH) * 60 + prepMinutes);
  return Math.max(1, eta);
}

function formatDurationFr(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours} h`;
  return `${hours} h ${remaining} min`;
}

function serviceLabel(service) {
  if (service === "SAMU") return "SAMU";
  if (service === "SAPEUR_POMPIER" || service === "SAPEUR_POMPIER") return "SAPEUR-POMPIER";
  if (service === "POLICE") return "Police";
  if (service === "GENDARMERIE") return "Gendarmerie";
  if (service === "PROTECTION_CIVILE") return "Protection Civile";
  return "service d'urgence";
}

function buildUserStatusMessage(row) {
  const status = String(row?.status || "").toUpperCase();
  const handlerName = normalizeText(row?.handler_name, 120);
  const baseName = normalizeText(row?.handler_base_name, 160);
  const service = serviceLabel(row?.target_service);
  const teamPart = handlerName ? `Une equipe (${handlerName}) du ${service}` : `Une equipe du ${service}`;
  const basePart = baseName ? ` de la caserne ${baseName}` : "";
  const eta = estimateArrivalMinutes(row);
  const etaLabel = formatDurationFr(eta);

  if (status === "NEW") {
    return "Votre requete est en attente de prise en charge.";
  }
  if (status === "ACKNOWLEDGED" || status === "EN_ROUTE") {
    if (eta != null && etaLabel) {
      return `${teamPart}${basePart} a pris en charge votre requete et est en route. Arrivee estimee: ${etaLabel}.`;
    }
    return `${teamPart}${basePart} a pris en charge votre requete et est en route.`;
  }
  if (status === "ON_SITE") {
    return `${teamPart}${basePart} est sur place pour votre prise en charge.`;
  }
  if (status === "COMPLETED") {
    return "Votre alerte a ete traitee.";
  }
  if (status === "CLOSED") {
    return "Votre alerte a ete cloturee.";
  }
  return "Mise a jour de votre alerte.";
}

function normalizeReportRow(row) {
  const estimatedArrivalMinutes = estimateArrivalMinutes(row);
  const estimatedArrivalLabel = formatDurationFr(estimatedArrivalMinutes);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    targetService: row.target_service,
    emergencyType: row.emergency_type,
    pickupPointName: row.pickup_point_name || null,
    description: row.description,
    phoneNumber: row.phone_number,
    photos: Array.isArray(row.photos) ? row.photos : [],
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    status: row.status,
    handledBy: row.handled_by == null ? null : String(row.handled_by),
    handledAt: row.handled_at || null,
    handlerBaseName: row.handler_base_name || null,
    estimatedArrivalMinutes,
    estimatedArrivalLabel: estimatedArrivalLabel || null,
    userStatusMessage: buildUserStatusMessage(row),
    teamLatitude: row.team_latitude == null ? null : Number(row.team_latitude),
    teamLongitude: row.team_longitude == null ? null : Number(row.team_longitude),
    teamNote: row.team_note || null,
    reporterName: row.reporter_name || null,
    handlerName: row.handler_name || null,
    createdAt: row.created_at
  };
}

function normalizeBaseRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    serviceType: row.service_type,
    address: row.address,
    location: {
      type: "Point",
      coordinates: [Number(row.longitude), Number(row.latitude)]
    },
    approvalStatus: row.approval_status,
    distanceKm: row.distance_km == null ? undefined : Number(row.distance_km),
    createdAt: row.created_at
  };
}

export async function createEmergencyReport(req, res) {
  const targetService = normalizeTargetService(req.body?.targetService);
  const emergencyType = normalizeText(req.body?.emergencyType, 120);
  const pickupPointName = normalizeText(req.body?.pickupPointName, 180);
  const description = normalizeText(req.body?.description, 2000);
  const phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);
  const photos = normalizePhotos(req.body?.photos);
  const latitude = parseLatitude(req.body?.latitude);
  const longitude = parseLongitude(req.body?.longitude);

  if (!targetService) {
    return res.status(400).json({ message: "Service d'urgence invalide (SAMU ou SAPEUR_POMPIER)." });
  }
  if (phoneNumber.length !== 10) {
    return res.status(400).json({ message: "Numero de telephone invalide (10 chiffres requis)." });
  }
  if (emergencyType.length < 3) {
    return res.status(400).json({ message: "Type d'urgence obligatoire." });
  }
  if (pickupPointName.length < 3) {
    return res.status(400).json({ message: "Nom du point de prise en charge obligatoire." });
  }
  if (description.length < 10) {
    return res.status(400).json({ message: "Description trop courte (minimum 10 caracteres)." });
  }
  if (latitude == null || longitude == null) {
    return res.status(400).json({ message: "Position GPS invalide." });
  }

  const result = await pool.query(
    `
      INSERT INTO emergency_reports (
        user_id,
        target_service,
        emergency_type,
        pickup_point_name,
        description,
        phone_number,
        photos,
        latitude,
        longitude, city, city_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
      RETURNING *;
    `,
    [
      Number(req.user.id),
      targetService,
      emergencyType,
      pickupPointName,
      description,
      phoneNumber,
      JSON.stringify(photos),
      latitude,
      longitude,
      String(req.body?.city || "").trim().slice(0, 100),
      cityKey(req.body?.city)
    ]
  );

  void notifyLocalEmergency(result.rows[0]).catch(() => {});
  return res.status(201).json({
    message: "Signalement d'urgence envoye.",
    report: normalizeReportRow(result.rows[0])
  });
}

export async function getEmergencyReports(req, res) {
  if (!EMERGENCY_ALLOWED_ROLES.has(req.user?.role)) {
    return res.status(403).json({ message: "Acces refuse" });
  }

  const role = String(req.user.role || "").toUpperCase();
  const roleService = serviceFromRole(role);
  const whereParts = [];
  const params = [];

  // Chaque service ne voit que ses propres alertes
  if (roleService) {
    whereParts.push(`er.target_service = ANY($${params.length + 1}::text[])`);
    params.push(serviceVariants(roleService));
  }
  const status = normalizeEmergencyStatus(req.query?.status);
  if (status) {
    whereParts.push(`er.status = $${params.length + 1}`);
    params.push(status);
  }
  const dateFrom = parseDateBoundary(req.query?.dateFrom, false);
  const dateTo = parseDateBoundary(req.query?.dateTo, true);
  if (dateFrom) {
    whereParts.push(`er.created_at >= $${params.length + 1}`);
    params.push(dateFrom.toISOString());
  }
  if (dateTo) {
    whereParts.push(`er.created_at <= $${params.length + 1}`);
    params.push(dateTo.toISOString());
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        er.*,
        u.full_name AS reporter_name,
        hu.full_name AS handler_name,
        hb.name AS handler_base_name,
        hb.latitude AS handler_base_latitude,
        hb.longitude AS handler_base_longitude
      FROM emergency_reports er
      JOIN users u ON u.id = er.user_id
      LEFT JOIN users hu ON hu.id = er.handled_by
      LEFT JOIN LATERAL (
        SELECT eb.name, eb.latitude, eb.longitude
        FROM emergency_bases eb
        WHERE eb.created_by = er.handled_by
          AND eb.service_type = er.target_service
          AND eb.approval_status = 'APPROVED'
        ORDER BY
          (
            6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians(er.latitude)) * cos(radians(eb.latitude)) *
                cos(radians(eb.longitude) - radians(er.longitude)) +
                sin(radians(er.latitude)) * sin(radians(eb.latitude))
              ))
            )
          ) ASC
        LIMIT 1
      ) hb ON true
      ${whereClause}
      ORDER BY
        CASE er.status
          WHEN 'NEW' THEN 1
          WHEN 'ACKNOWLEDGED' THEN 2
          WHEN 'EN_ROUTE' THEN 3
          WHEN 'ON_SITE' THEN 4
          WHEN 'COMPLETED' THEN 5
          ELSE 6
        END,
        er.created_at DESC
      LIMIT 300;
    `,
    params
  );

  return res.json(result.rows.map(normalizeReportRow));
}

export async function getMyEmergencyReports(req, res) {
  const result = await pool.query(
    `
      SELECT
        er.*,
        hu.full_name AS handler_name,
        hb.name AS handler_base_name,
        hb.latitude AS handler_base_latitude,
        hb.longitude AS handler_base_longitude
      FROM emergency_reports er
      LEFT JOIN users hu ON hu.id = er.handled_by
      LEFT JOIN LATERAL (
        SELECT eb.name, eb.latitude, eb.longitude
        FROM emergency_bases eb
        WHERE eb.created_by = er.handled_by
          AND eb.service_type = er.target_service
          AND eb.approval_status = 'APPROVED'
        ORDER BY
          (
            6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians(er.latitude)) * cos(radians(eb.latitude)) *
                cos(radians(eb.longitude) - radians(er.longitude)) +
                sin(radians(er.latitude)) * sin(radians(eb.latitude))
              ))
            )
          ) ASC
        LIMIT 1
      ) hb ON true
      WHERE er.user_id = $1
      ORDER BY er.created_at DESC
      LIMIT 200;
    `,
    [Number(req.user.id)]
  );

  return res.json(result.rows.map(normalizeReportRow));
}

export async function acknowledgeEmergencyReport(req, res) {
  const reportId = Number(req.params.id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ message: "ID alerte invalide" });
  }

  const roleService = serviceFromRole(String(req.user.role || "").toUpperCase());
  if (!roleService && String(req.user.role || "").toUpperCase() !== "DEVELOPER") {
    return res.status(403).json({ message: "Seuls SAMU et SAPEUR_POMPIER peuvent prendre en charge." });
  }
  const teamLatitude = req.body?.teamLatitude == null ? null : parseLatitude(req.body?.teamLatitude);
  const teamLongitude = req.body?.teamLongitude == null ? null : parseLongitude(req.body?.teamLongitude);
  if ((teamLatitude == null) !== (teamLongitude == null)) {
    return res.status(400).json({ message: "Fournissez teamLatitude et teamLongitude ensemble." });
  }

  const updated = await pool.query(
    `
      UPDATE emergency_reports
      SET
        status = CASE WHEN status = 'NEW' THEN 'ACKNOWLEDGED' ELSE status END,
        handled_by = COALESCE(handled_by, $3),
        handled_at = COALESCE(handled_at, NOW()),
        team_latitude = COALESCE($4, team_latitude),
        team_longitude = COALESCE($5, team_longitude)
      WHERE id = $1
        AND ($2::text[] IS NULL OR target_service = ANY($2::text[]))
      RETURNING *;
    `,
    [reportId, roleService ? serviceVariants(roleService) : null, Number(req.user.id), teamLatitude, teamLongitude]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ message: "Alerte introuvable pour votre service." });
  }

  return res.json({
    message: "Alerte prise en charge.",
    report: normalizeReportRow(updated.rows[0])
  });
}

export async function updateEmergencyProgress(req, res) {
  const reportId = Number(req.params.id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ message: "ID alerte invalide" });
  }

  const roleService = serviceFromRole(String(req.user.role || "").toUpperCase());
  if (!roleService && String(req.user.role || "").toUpperCase() !== "DEVELOPER") {
    return res.status(403).json({ message: "Seuls SAMU et SAPEUR_POMPIER peuvent mettre a jour une alerte." });
  }

  const status = normalizeEmergencyStatus(req.body?.status);
  const teamLatitude = req.body?.teamLatitude == null ? null : parseLatitude(req.body?.teamLatitude);
  const teamLongitude = req.body?.teamLongitude == null ? null : parseLongitude(req.body?.teamLongitude);
  const teamNote = normalizeText(req.body?.teamNote, 600);

  if (!status || !["ACKNOWLEDGED", "EN_ROUTE", "ON_SITE", "COMPLETED", "CLOSED"].includes(status)) {
    return res.status(400).json({ message: "Statut d'avancement invalide." });
  }
  if ((teamLatitude == null) !== (teamLongitude == null)) {
    return res.status(400).json({ message: "Fournissez teamLatitude et teamLongitude ensemble." });
  }

  const updated = await pool.query(
    `
      UPDATE emergency_reports
      SET
        status = $4,
        handled_by = COALESCE(handled_by, $3),
        handled_at = COALESCE(handled_at, NOW()),
        team_latitude = COALESCE($5, team_latitude),
        team_longitude = COALESCE($6, team_longitude),
        team_note = CASE WHEN $7 = '' THEN team_note ELSE $7 END
      WHERE id = $1
        AND ($2::text[] IS NULL OR target_service = ANY($2::text[]))
        AND (handled_by IS NULL OR handled_by = $3)
      RETURNING *;
    `,
    [reportId, roleService ? serviceVariants(roleService) : null, Number(req.user.id), status, teamLatitude, teamLongitude, teamNote]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ message: "Alerte introuvable ou deja affectee a une autre equipe." });
  }

  return res.json({
    message: "Avancement mis a jour.",
    report: normalizeReportRow(updated.rows[0])
  });
}

export async function createEmergencyBase(req, res) {
  const role = String(req.user.role || "").toUpperCase();
  const roleService = serviceFromRole(role);
  const requestedService = normalizeTargetService(req.body?.serviceType);
  const name = normalizeText(req.body?.name, 160);
  const address = normalizeText(req.body?.address, 320);
  const latitude = parseLatitude(req.body?.latitude);
  const longitude = parseLongitude(req.body?.longitude);

  if (!roleService && !["DEVELOPER", "REGULATOR", "NATIONAL", "REGION", "DISTRICT"].includes(role)) {
    return res.status(403).json({ message: "Acces refuse" });
  }

  const serviceType = roleService || requestedService;
  if (!serviceType) {
    return res.status(400).json({ message: "serviceType invalide (SAMU ou SAPEUR_POMPIER)." });
  }
  if (!name || !address || latitude == null || longitude == null) {
    return res.status(400).json({ message: "name, address, latitude et longitude sont obligatoires." });
  }

  const inserted = await pool.query(
    `
      INSERT INTO emergency_bases (
        name,
        service_type,
        address,
        latitude,
        longitude,
        created_by,
        approval_status,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', NOW())
      RETURNING *;
    `,
    [name, serviceType, address, latitude, longitude, Number(req.user.id)]
  );

  return res.status(201).json(normalizeBaseRow(inserted.rows[0]));
}

export async function getEmergencyBases(req, res) {
  const requestedService = normalizeTargetService(req.query?.serviceType);
  const where = [];
  const params = [];

  where.push(`eb.approval_status = 'APPROVED'`);
  if (requestedService) {
    where.push(`eb.service_type = $${params.length + 1}`);
    params.push(requestedService);
  }

  const result = await pool.query(
    `
      SELECT eb.*
      FROM emergency_bases eb
      WHERE ${where.join(" AND ")}
      ORDER BY eb.created_at DESC
      LIMIT 400;
    `,
    params
  );

  return res.json(result.rows.map(normalizeBaseRow));
}

export async function getNearbyEmergencyBases(req, res) {
  const latitude = parseLatitude(req.query?.latitude);
  const longitude = parseLongitude(req.query?.longitude);
  const radiusKm = Number(req.query?.radiusKm);
  const validRadius = Number.isFinite(radiusKm) && radiusKm > 0
    ? Math.min(700, Math.max(1, radiusKm))
    : 30;
  const requestedService = normalizeTargetService(req.query?.serviceType);

  if (latitude == null || longitude == null) {
    return res.status(400).json({ message: "latitude et longitude sont obligatoires." });
  }

  const params = [latitude, longitude, validRadius];
  const whereParts = [`distance_km <= $3`, `approval_status = 'APPROVED'`];

  if (requestedService) {
    whereParts.push(`service_type = $4`);
    params.push(requestedService);
  }

  const result = await pool.query(
    `
      WITH bases AS (
        SELECT
          eb.*,
          (
            6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians($1)) * cos(radians(eb.latitude)) *
                cos(radians(eb.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(eb.latitude))
              ))
            )
          ) AS distance_km
        FROM emergency_bases eb
      )
      SELECT *
      FROM bases
      WHERE ${whereParts.join(" AND ")}
      ORDER BY distance_km ASC
      LIMIT 200;
    `,
    params
  );

  return res.json(result.rows.map(normalizeBaseRow));
}
