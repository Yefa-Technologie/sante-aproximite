import { pool } from "../config/db.js";
import { buildFeedbackUrl } from "./qrFeedbackController.js";

const ESTABLISHMENT_TYPES = ["CONFESSIONNEL", "PRIVE", "PUBLIQUE"];
const CENTER_LEVELS = [
  "CHU",
  "CHR",
  "CH",
  "CHS",
  "CLINIQUE",
  "POLYCLINIQUE",
  "INFIRMERIE",
  "CLCC",
  "ESPC",
  "CENTRE_SANTE",
  "SSR",
  "EHPAD_USLD",
  "CENTRE_RADIOTHERAPIE",
  "CENTRE_CARDIOLOGIE"
];

const CENTER_LEVEL_ALIASES = new Map([
  ["CENTRE HOSPITALIER UNIVERSITAIRE", "CHU"],
  ["CENTRE HOSPITALIER REGIONAL", "CHR"],
  ["CENTRE HOSPITALIER", "CH"],
  ["CENTRE HOSPITALIER SPECIALISE", "CHS"],
  ["CLINIQUE", "CLINIQUE"],
  ["CLINIQUE PRIVEE", "CLINIQUE"],
  ["POLYCLINIQUE", "POLYCLINIQUE"],
  ["INFIRMERIE", "INFIRMERIE"],
  ["CENTRE DE LUTTE CONTRE LE CANCER", "CLCC"],
  ["ESPC", "ESPC"],
  ["ETABLISSEMENT SANITAIRE DE PREMIER CONTACT", "ESPC"],
  ["CENTRE DE SANTE", "CENTRE_SANTE"],
  ["CENTRES DE SANTE", "CENTRE_SANTE"],
  ["SSR", "SSR"],
  ["CENTRE DE READAPTATION", "SSR"],
  ["EHPAD", "EHPAD_USLD"],
  ["USLD", "EHPAD_USLD"],
  ["EHPAD USLD", "EHPAD_USLD"],
  ["CENTRE DE RADIOTHERAPIE", "CENTRE_RADIOTHERAPIE"],
  ["CENTRE DE CARDIOLOGIE", "CENTRE_CARDIOLOGIE"]
]);

const ETABLISSEMENT_ROLES = new Set(["ETABLISSEMENT", "CHEF_ETABLISSEMENT"]);
const ADMIN_ROLES = new Set(["DEVELOPER", "REGULATOR", "NATIONAL", "REGION", "DISTRICT"]);
const COMPLAINT_VIEW_ROLES = new Set(["DEVELOPER", "REGULATOR", "NATIONAL", "REGION", "DISTRICT", "ETABLISSEMENT", "CHEF_ETABLISSEMENT"]);

function isEtablissementRole(role) {
  return ETABLISSEMENT_ROLES.has(role);
}

function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

function getEffectiveRequestRoles(req) {
  const roles = Array.isArray(req.user?.roles)
    ? req.user.roles.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const primary = String(req.user?.role || "").trim().toUpperCase();
  return [...new Set([...roles, primary].filter(Boolean))];
}

function hasRequestRole(req, allowedRoles) {
  const effective = getEffectiveRequestRoles(req);
  return effective.some((role) => allowedRoles.has(role));
}

function normalizeGeoCode(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase();
  return cleaned ? cleaned : null;
}

async function validateRegionDistrict(regionCode, districtCode, queryable = pool) {
  if (!regionCode) {
    return { ok: false, message: "regionCode est obligatoire" };
  }

  const regionResult = await queryable.query(
    "SELECT code FROM regions WHERE code = $1 LIMIT 1",
    [regionCode]
  );
  if (regionResult.rowCount === 0) {
    return { ok: false, message: `Region introuvable: ${regionCode}` };
  }

  if (!districtCode) {
    return { ok: true };
  }

  const districtResult = await queryable.query(
    "SELECT code, region_code FROM districts WHERE code = $1 LIMIT 1",
    [districtCode]
  );
  if (districtResult.rowCount === 0) {
    return { ok: false, message: `District introuvable: ${districtCode}` };
  }
  const district = districtResult.rows[0];
  if (String(district.region_code || "").toUpperCase() !== regionCode) {
    return {
      ok: false,
      message: `Le district ${districtCode} n'appartient pas a la region ${regionCode}`
    };
  }
  return { ok: true };
}

async function getRequesterScope(req) {
  const role = String(req.user?.role || "").toUpperCase();
  const normalizedUserRoles = Array.isArray(req.user?.roles)
    ? req.user.roles.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const scopePriority = [
    "DEVELOPER",
    "REGULATOR",
    "NATIONAL",
    "REGION",
    "DISTRICT",
    "CHEF_ETABLISSEMENT",
    "ETABLISSEMENT"
  ];
  const userId = Number(req.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return {
      role,
      userId: null,
      regionCode: null,
      districtCode: null,
      establishmentCode: null,
      centerId: null
    };
  }

  const found = await pool.query(
    `
      SELECT id, role, region_code, district_code, establishment_code, center_id
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [userId]
  );

  if (found.rowCount === 0) {
    return {
      role,
      userId,
      regionCode: null,
      districtCode: null,
      establishmentCode: null,
      centerId: null
    };
  }

  const row = found.rows[0];
  const dbRole = String(row.role || role).toUpperCase();
  const combinedRoles = [...new Set([...normalizedUserRoles, role, dbRole].filter(Boolean))];
  const scopedRole = scopePriority.find((value) => combinedRoles.includes(value)) || dbRole;
  return {
    role: scopedRole,
    userId: Number(row.id),
    regionCode: normalizeGeoCode(row.region_code),
    districtCode: normalizeGeoCode(row.district_code),
    establishmentCode: normalizeEstablishmentCode(row.establishment_code),
    centerId: Number.isInteger(Number(row.center_id)) && Number(row.center_id) > 0 ? Number(row.center_id) : null
  };
}

function applyCenterScope(whereParts, params, scope, centerAlias = "hc", options = {}) {
  const onlyApprovedForEstablishment = options?.onlyApprovedForEstablishment === true;
  if (scope.role === "ETABLISSEMENT" || scope.role === "CHEF_ETABLISSEMENT") {
    if (onlyApprovedForEstablishment) {
      whereParts.push(`${centerAlias}.approval_status = 'APPROVED'`);
    }
    const accessParts = [];
    if (scope.centerId) {
      accessParts.push(`${centerAlias}.id = $${params.length + 1}`);
      params.push(Number(scope.centerId));
    }
    if (scope.establishmentCode) {
      accessParts.push(`upper(${centerAlias}.establishment_code) = $${params.length + 1}`);
      params.push(scope.establishmentCode);
    }
    if (scope.userId) {
      accessParts.push(`${centerAlias}.created_by = $${params.length + 1}`);
      params.push(Number(scope.userId));
    }
    if (accessParts.length === 0) {
      whereParts.push("1 = 0");
      return;
    }
    whereParts.push(`(${accessParts.join(" OR ")})`);
    return;
  }
  if (scope.role === "DISTRICT") {
    if (!scope.districtCode) {
      whereParts.push("1 = 0");
      return;
    }
    whereParts.push(`upper(${centerAlias}.district_code) = $${params.length + 1}`);
    params.push(scope.districtCode);
    return;
  }
  if (scope.role === "REGION") {
    if (!scope.regionCode) {
      whereParts.push("1 = 0");
      return;
    }
    whereParts.push(`upper(${centerAlias}.region_code) = $${params.length + 1}`);
    params.push(scope.regionCode);
  }
}

async function canViewCenterByScope(scope, centerId, options = {}) {
  const onlyApprovedForEstablishment = options?.onlyApprovedForEstablishment === true;
  const centerResult = await pool.query(
    `
      SELECT id, created_by, region_code, district_code, establishment_code, approval_status
      FROM health_centers
      WHERE id = $1
      LIMIT 1;
    `,
    [centerId]
  );
  if (centerResult.rowCount === 0) {
    return { exists: false, allowed: false };
  }

  const center = centerResult.rows[0];
  if (scope.role === "DEVELOPER" || scope.role === "REGULATOR" || scope.role === "NATIONAL") {
    return { exists: true, allowed: true };
  }
  if (scope.role === "ETABLISSEMENT" || scope.role === "CHEF_ETABLISSEMENT") {
    if (onlyApprovedForEstablishment && String(center.approval_status || "").toUpperCase() !== "APPROVED") {
      return { exists: true, allowed: false };
    }
    const matchesCenterId = scope.centerId ? Number(center.id) === Number(scope.centerId) : false;
    const centerCode = normalizeEstablishmentCode(center.establishment_code);
    const matchesEstablishmentCode = scope.establishmentCode
      ? !!centerCode && centerCode === scope.establishmentCode
      : false;
    const matchesCreator = scope.userId ? String(center.created_by) === String(scope.userId) : false;
    return {
      exists: true,
      allowed: matchesCenterId || matchesEstablishmentCode || matchesCreator
    };
  }
  if (scope.role === "DISTRICT") {
    const centerDistrict = normalizeGeoCode(center.district_code);
    return { exists: true, allowed: !!scope.districtCode && centerDistrict === scope.districtCode };
  }
  if (scope.role === "REGION") {
    const centerRegion = normalizeGeoCode(center.region_code);
    return { exists: true, allowed: !!scope.regionCode && centerRegion === scope.regionCode };
  }
  return { exists: true, allowed: false };
}

function toNumber(value) {
  const normalized =
    typeof value === "string"
      ? value.trim().replace(",", ".")
      : value;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeEstablishmentType(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = stripDiacritics(value.trim()).toUpperCase();
  return ESTABLISHMENT_TYPES.includes(normalized) ? normalized : null;
}

function normalizeEstablishmentCode(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (["N/A", "NA", "NULL", "NONE", "SANS CODE", "AUCUN", "-"].includes(normalized)) {
    return null;
  }
  return normalized.length > 0 ? normalized : null;
}

function normalizeCenterLevel(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = stripDiacritics(value.trim())
    .toUpperCase()
    .replace(/[()]/g, " ")
    .replace(/[/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (CENTER_LEVELS.includes(normalized)) {
    return normalized;
  }

  if (CENTER_LEVEL_ALIASES.has(normalized)) {
    return CENTER_LEVEL_ALIASES.get(normalized);
  }

  if (normalized.includes("CHU")) return "CHU";
  if (normalized.includes("CHR")) return "CHR";
  if (normalized === "CH" || normalized.includes(" CENTRE HOSPITALIER")) return "CH";
  if (normalized.includes("CHS")) return "CHS";
  if (normalized.includes("CLCC") || normalized.includes("LUTTE CONTRE LE CANCER")) return "CLCC";
  if (normalized.includes("POLYCLINIQUE")) return "POLYCLINIQUE";
  if (normalized.includes("INFIRMERIE")) return "INFIRMERIE";
  if (normalized.includes("CLINIQUE")) return "CLINIQUE";
  if (normalized.includes("ESPC") || normalized.includes("PREMIER CONTACT")) return "ESPC";
  if (normalized.includes("CENTRE DE SANTE")) return "CENTRE_SANTE";
  if (normalized.includes("SSR") || normalized.includes("READAPTATION")) return "SSR";
  if (normalized.includes("EHPAD") || normalized.includes("USLD")) return "EHPAD_USLD";
  if (normalized.includes("RADIOTHERAPIE")) return "CENTRE_RADIOTHERAPIE";
  if (normalized.includes("CARDIOLOGIE")) return "CENTRE_CARDIOLOGIE";

  return null;
}

function mapCenterRow(row) {
  const ratingAverage = row.rating_average == null ? null : Number(row.rating_average);
  const ratingCount = row.rating_count == null ? 0 : Number(row.rating_count);
  const satisfactionRate = row.satisfaction_rate == null ? null : Number(row.satisfaction_rate);

  return {
    _id: String(row.id),
    name: row.name,
    address: row.address,
    establishmentCode: row.establishment_code,
    level: row.level,
    establishmentType: row.establishment_type,
    technicalPlatform: row.technical_platform,
    regionCode: row.region_code || null,
    districtCode: row.district_code || null,
    location: {
      type: "Point",
      coordinates: [Number(row.longitude), Number(row.latitude)]
    },
    createdBy: String(row.created_by),
    approvalStatus: row.approval_status || "PENDING",
    isActive: row.is_active !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    ratingAverage,
    ratingCount,
    satisfactionRate,
    myRating: row.my_rating == null ? null : Number(row.my_rating),
    mySatisfaction: row.my_satisfaction || null,
    services: row.services || [],
    ...(row.distance_km !== undefined ? { distanceKm: Number(row.distance_km) } : {})
  };
}

function mapServiceRow(row) {
  return {
    name: row.name,
    description: row.description,
    bedsAvailable: Number(row.beds_available) || 0,
    bedsOccupied: Number(row.beds_occupied) || 0,
    bedsOutOfService: Number(row.beds_out_of_service) || 0,
    isActive: row.is_active !== false,
  };
}

function csvCell(value, delimiter = ",") {
  const text = String(value ?? "");
  const delimiterPattern = delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`[${delimiterPattern}"\\n\\r]`).test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function sendCsv(res, filename, headers, rows, options = {}) {
  const delimiter = options.delimiter || ",";
  const content = [
    headers.map((value) => csvCell(value, delimiter)).join(delimiter),
    ...rows.map((row) => row.map((value) => csvCell(value, delimiter)).join(delimiter))
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(`\uFEFF${content}`);
}

function normalizeBedCount(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeServices(services) {
  if (typeof services === "string") {
    return services
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((name) => ({ name, bedsAvailable: 0, bedsOccupied: 0, bedsOutOfService: 0 }));
  }

  if (!Array.isArray(services)) {
    return [];
  }

  return services
    .map((service) => {
      if (typeof service === "string") {
        return { name: service.trim(), bedsAvailable: 0, bedsOccupied: 0, bedsOutOfService: 0 };
      }
      return {
        name: typeof service?.name === "string" ? service.name.trim() : "",
        description: typeof service?.description === "string" ? service.description.trim() : null,
        bedsAvailable: normalizeBedCount(service?.bedsAvailable),
        bedsOccupied: normalizeBedCount(service?.bedsOccupied),
        bedsOutOfService: normalizeBedCount(service?.bedsOutOfService),
        isActive: service?.isActive !== false
      };
    })
    .filter((service) => service.name.length > 0);
}

async function insertCenterWithServices(client, payload, createdBy, approvalStatus = "PENDING") {
  const insertedCenter = await client.query(
    `
      INSERT INTO health_centers (
        name,
        address,
        establishment_code,
        level,
        establishment_type,
        technical_platform,
        region_code,
        district_code,
        latitude,
        longitude,
        created_by,
        approval_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, name, address, establishment_code, level, establishment_type, technical_platform, region_code, district_code, latitude, longitude, created_by, approval_status;
    `,
    [
      payload.name.trim(),
      payload.address.trim(),
      payload.establishmentCode,
      payload.level.trim(),
      payload.establishmentType,
      payload.technicalPlatform.trim(),
      payload.regionCode,
      payload.districtCode,
      payload.latitude,
      payload.longitude,
      createdBy,
      approvalStatus
    ]
  );
  const center = insertedCenter.rows[0];

  const services = normalizeServices(payload.services);
  for (const service of services) {
    await client.query(
      `
        INSERT INTO health_center_services (center_id, name, description, beds_available, beds_occupied, beds_out_of_service)
        VALUES ($1, $2, $3, $4, $5, $6);
      `,
      [center.id, service.name, service.description || null, service.bedsAvailable, service.bedsOccupied, service.bedsOutOfService]
    );
  }

  return mapCenterRow({
    ...center,
    services
  });
}

export async function createCenter(req, res) {
  const {
    name,
    address,
    establishmentCode,
    level,
    establishmentType,
    technicalPlatform,
    services = [],
    regionCode,
    districtCode,
    latitude,
    longitude
  } = req.body;

  const lat = toNumber(latitude);
  const lon = toNumber(longitude);
  const normalizedCode = normalizeEstablishmentCode(establishmentCode);
  const normalizedLevel = normalizeCenterLevel(level);
  const normalizedType = normalizeEstablishmentType(establishmentType);
  const normalizedRegionCode = normalizeGeoCode(regionCode);
  const normalizedDistrictCode = normalizeGeoCode(districtCode);

  if (level && !normalizedLevel) {
    return res.status(400).json({
      message:
        "level invalide. Valeurs: CHU, CHR, CH, CHS, CLINIQUE, POLYCLINIQUE, INFIRMERIE, CLCC, ESPC, CENTRE_SANTE, SSR, EHPAD_USLD, CENTRE_RADIOTHERAPIE, CENTRE_CARDIOLOGIE"
    });
  }

  if (establishmentType && !normalizedType) {
    return res.status(400).json({
      message: "establishmentType invalide. Valeurs: CONFESSIONNEL, PRIVE, PUBLIQUE"
    });
  }

  if (
    !name ||
    !address ||
    !normalizedLevel ||
    !normalizedType ||
    !normalizedRegionCode ||
    !technicalPlatform ||
    lat === null ||
    lon === null
  ) {
    return res.status(400).json({
      message:
        "name, address, regionCode, level, establishmentType, technicalPlatform, latitude et longitude sont obligatoires"
    });
  }

  const requesterIsAdmin = isAdminRole(req.user?.role);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const geoValidation = await validateRegionDistrict(
      normalizedRegionCode,
      normalizedDistrictCode,
      client
    );
    if (!geoValidation.ok) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: geoValidation.message });
    }

    if (!requesterIsAdmin) {
      const existingCenter = await client.query(
        `
          SELECT id
          FROM health_centers
          WHERE created_by = $1
          LIMIT 1;
        `,
        [Number(req.user.id)]
      );
      if (existingCenter.rowCount > 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          message: "Un chef ne peut creer qu'un seul centre. Utilisez la modification du centre."
        });
      }
    }
    const center = await insertCenterWithServices(
      client,
      {
        name,
        address,
        establishmentCode: normalizedCode,
        level: normalizedLevel,
        establishmentType: normalizedType,
        technicalPlatform,
        regionCode: normalizedRegionCode,
        districtCode: normalizedDistrictCode,
        latitude: lat,
        longitude: lon,
        services
      },
      Number(req.user.id),
      "PENDING"
    );

    await client.query("COMMIT");
    return res.status(201).json(center);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimCenterByCode(req, res) {
  const normalizedCode = normalizeEstablishmentCode(
    typeof req.body?.code === "string" ? req.body.code : ""
  );
  if (!normalizedCode) {
    return res.status(400).json({ message: "Code etablissement requis" });
  }

  const found = await pool.query(
    `
      SELECT hc.id, hc.created_by, u.role AS creator_role
      FROM health_centers hc
      JOIN users u ON u.id = hc.created_by
      WHERE upper(hc.establishment_code) = $1
      LIMIT 1;
    `,
    [normalizedCode]
  );

  if (found.rowCount === 0) {
    return res.status(404).json({ found: false, message: "Aucun centre trouve avec ce code." });
  }

  const target = found.rows[0];
  const requesterId = Number(req.user.id);

  if (Number(target.created_by) === requesterId) {
    const mine = await pool.query(
      `SELECT id, name, address, establishment_code, level, establishment_type, technical_platform,
              region_code, district_code, latitude, longitude, created_by, approval_status,
              created_at, updated_at
       FROM health_centers WHERE id = $1 LIMIT 1;`,
      [target.id]
    );
    return res.json({ found: true, claimed: false, alreadyMine: true, center: mapCenterRow(mine.rows[0]) });
  }

  const existingOwn = await pool.query(
    `SELECT id FROM health_centers WHERE created_by = $1 LIMIT 1;`,
    [requesterId]
  );
  if (existingOwn.rowCount > 0) {
    return res.status(409).json({
      message: "Vous gerez deja un centre. Utilisez la modification de votre centre."
    });
  }

  const creatorRole = String(target.creator_role || "").toUpperCase();
  if (!isAdminRole(creatorRole)) {
    return res.status(409).json({
      found: true,
      claimed: false,
      message: "Ce centre est deja gere par un autre compte."
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE health_centers
       SET created_by = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, address, establishment_code, level, establishment_type, technical_platform,
                 region_code, district_code, latitude, longitude, created_by, approval_status,
                 created_at, updated_at;`,
      [target.id, requesterId]
    );
    await client.query("COMMIT");
    return res.json({ found: true, claimed: true, center: mapCenterRow(updated.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addService(req, res) {
  const { id } = req.params;
  const { name, description, bedsAvailable, bedsOccupied, bedsOutOfService } = req.body;
  const centerId = Number(id);

  if (!name) {
    return res.status(400).json({ message: "Le nom du service est obligatoire" });
  }
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const centerResult = await pool.query(
    `
      SELECT id, created_by
      FROM health_centers
      WHERE id = $1
      LIMIT 1;
    `,
    [centerId]
  );

  if (centerResult.rowCount === 0) {
    return res.status(404).json({ message: "Centre introuvable" });
  }

  const center = centerResult.rows[0];
  if (String(center.created_by) !== String(req.user.id)) {
    return res.status(403).json({ message: "Vous ne pouvez modifier que vos centres" });
  }

  await pool.query(
    `
      INSERT INTO health_center_services (center_id, name, description, beds_available, beds_occupied, beds_out_of_service)
      VALUES ($1, $2, $3, $4, $5, $6);
    `,
    [
      centerId,
      name.trim(),
      description?.trim() || null,
      normalizeBedCount(bedsAvailable),
      normalizeBedCount(bedsOccupied),
      normalizeBedCount(bedsOutOfService)
    ]
  );

  const fullResult = await pool.query(
    `
      SELECT
        hc.id,
        hc.name,
        hc.address,
        hc.establishment_code,
        hc.level,
        hc.establishment_type,
        hc.technical_platform,
        hc.latitude,
        hc.longitude,
        hc.created_by,
        hc.approval_status,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'name', s.name,
              'description', s.description,
              'bedsAvailable', s.beds_available,
              'bedsOccupied', s.beds_occupied,
              'bedsOutOfService', s.beds_out_of_service,
              'isActive', s.is_active
            )
            ORDER BY s.id
          )
          FROM health_center_services s
          WHERE s.center_id = hc.id
        ), '[]'::json) AS services
      FROM health_centers hc
      WHERE hc.id = $1;
    `,
    [centerId]
  );

  return res.json(mapCenterRow(fullResult.rows[0]));
}

export async function updateCenterService(req, res) {
  const centerId = Number(req.params.id);
  const serviceName = typeof req.params.serviceName === "string" ? req.params.serviceName.trim() : "";
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }
  if (!serviceName) {
    return res.status(400).json({ message: "Nom de service invalide" });
  }

  const centerResult = await pool.query(
    `SELECT id, created_by FROM health_centers WHERE id = $1 LIMIT 1;`,
    [centerId]
  );
  if (centerResult.rowCount === 0) {
    return res.status(404).json({ message: "Centre introuvable" });
  }
  const requesterIsOwner = String(centerResult.rows[0].created_by) === String(req.user.id);
  if (!requesterIsOwner && !isAdminRole(req.user?.role)) {
    return res.status(403).json({ message: "Vous ne pouvez modifier que vos centres" });
  }

  const serviceResult = await pool.query(
    `SELECT id, name, description, beds_available, beds_occupied, beds_out_of_service, is_active
     FROM health_center_services
     WHERE center_id = $1 AND name = $2
     LIMIT 1;`,
    [centerId, serviceName]
  );
  if (serviceResult.rowCount === 0) {
    return res.status(404).json({ message: "Service introuvable" });
  }
  const service = serviceResult.rows[0];

  const adjust = typeof req.body?.adjust === "string" ? req.body.adjust : null;

  if (adjust === "occupy" || adjust === "free") {
    if (service.is_active === false) {
      return res.status(400).json({ message: "Ce service est desactive" });
    }
    if (adjust === "occupy" && Number(service.beds_available) <= 0) {
      return res.status(400).json({ message: "Aucune place disponible" });
    }
    if (adjust === "free" && Number(service.beds_occupied) <= 0) {
      return res.status(400).json({ message: "Aucune place occupee a liberer" });
    }
    const delta = adjust === "occupy" ? 1 : -1;
    const updated = await pool.query(
      `UPDATE health_center_services
       SET beds_available = beds_available - $2, beds_occupied = beds_occupied + $2
       WHERE id = $1
       RETURNING name, description, beds_available, beds_occupied, beds_out_of_service, is_active;`,
      [service.id, delta]
    );
    return res.json({ success: true, service: mapServiceRow(updated.rows[0]) });
  }

  const nextName = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : service.name;
  const nextDescription = typeof req.body?.description === "string" ? req.body.description.trim() || null : service.description;
  const nextAvailable = req.body?.bedsAvailable !== undefined ? normalizeBedCount(req.body.bedsAvailable) : service.beds_available;
  const nextOccupied = req.body?.bedsOccupied !== undefined ? normalizeBedCount(req.body.bedsOccupied) : service.beds_occupied;
  const nextOutOfService = req.body?.bedsOutOfService !== undefined ? normalizeBedCount(req.body.bedsOutOfService) : service.beds_out_of_service;
  const nextActive = typeof req.body?.isActive === "boolean" ? req.body.isActive : service.is_active !== false;

  const updated = await pool.query(
    `UPDATE health_center_services
     SET name = $2, description = $3, beds_available = $4, beds_occupied = $5, beds_out_of_service = $6, is_active = $7
     WHERE id = $1
     RETURNING name, description, beds_available, beds_occupied, beds_out_of_service, is_active;`,
    [service.id, nextName, nextDescription, nextAvailable, nextOccupied, nextOutOfService, nextActive]
  );
  return res.json({ success: true, service: mapServiceRow(updated.rows[0]) });
}

export async function getNearbyCenters(req, res) {
  const lat = toNumber(req.query.latitude);
  const lon = toNumber(req.query.longitude);
  const requestedRadiusKm = toNumber(req.query.radiusKm);
  if (requestedRadiusKm != null && (requestedRadiusKm < 1 || requestedRadiusKm > 700)) {
    return res.status(400).json({
      message: "Rayon de recherche trop grand. Entrez une valeur comprise entre 1 et 700 km."
    });
  }
  const radiusKm = requestedRadiusKm == null ? 30 : requestedRadiusKm;
  const viewerId = Number(req.user.id);
  const scope = await getRequesterScope(req);

  if (lat === null || lon === null) {
    return res.status(400).json({ message: "latitude et longitude sont obligatoires" });
  }

  let enforceScopedFilter = true;
  if (isEtablissementRole(scope.role)) {
    if (scope.centerId) {
      const centerResult = await pool.query(
        `
          SELECT approval_status
          FROM health_centers
          WHERE id = $1
          LIMIT 1;
        `,
        [Number(scope.centerId)]
      );
      enforceScopedFilter = centerResult.rowCount > 0 && centerResult.rows[0].approval_status === "APPROVED";
    } else if (scope.establishmentCode) {
      const centerResult = await pool.query(
        `
          SELECT 1
          FROM health_centers
          WHERE upper(establishment_code) = $1
            AND approval_status = 'APPROVED'
          LIMIT 1;
        `,
        [scope.establishmentCode]
      );
      enforceScopedFilter = centerResult.rowCount > 0;
    } else {
      const centerResult = await pool.query(
        `
          SELECT 1
          FROM health_centers
          WHERE created_by = $1
            AND approval_status = 'APPROVED'
          LIMIT 1;
        `,
        [Number(scope.userId)]
      );
      enforceScopedFilter = centerResult.rowCount > 0;
    }
  }

  let filterClause = "WHERE cwd.distance_km <= $3";
  const params = [lat, lon, radiusKm, viewerId];
  const scopeParts = [];
  if (!isEtablissementRole(scope.role) || enforceScopedFilter) {
    applyCenterScope(scopeParts, params, scope, "cwd");
  }
  const shouldUsePublicVisibilityFilter =
    !isAdminRole(scope.role) && (!isEtablissementRole(scope.role) || !enforceScopedFilter);
  if (scopeParts.length && (!isEtablissementRole(scope.role) || enforceScopedFilter)) {
    filterClause += ` AND ${scopeParts.join(" AND ")}`;
  } else if (shouldUsePublicVisibilityFilter) {
    filterClause += " AND cwd.approval_status IN ('APPROVED', 'PENDING')";
    if (isEtablissementRole(scope.role) && !enforceScopedFilter && Number.isInteger(Number(scope.userId))) {
      filterClause += ` AND NOT (cwd.created_by = $${params.length + 1} AND cwd.approval_status = 'PENDING')`;
      params.push(Number(scope.userId));
    }
  }

  const result = await pool.query(
    `
      WITH centers_with_distance AS (
        SELECT
          hc.id,
          hc.name,
          hc.address,
          hc.establishment_code,
          hc.level,
          hc.establishment_type,
          hc.technical_platform,
          hc.region_code,
          hc.district_code,
          hc.latitude,
          hc.longitude,
          hc.created_by,
          hc.approval_status,
          (
            6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians($1)) * cos(radians(hc.latitude)) *
                cos(radians(hc.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(hc.latitude))
              ))
            )
          ) AS distance_km
        FROM health_centers hc
        WHERE hc.is_active = TRUE
      )
      SELECT
        cwd.id,
        cwd.name,
        cwd.address,
        cwd.establishment_code,
        cwd.level,
        cwd.establishment_type,
        cwd.technical_platform,
        cwd.region_code,
        cwd.district_code,
        cwd.latitude,
        cwd.longitude,
        cwd.created_by,
        cwd.approval_status,
        ROUND(cwd.distance_km::numeric, 2) AS distance_km,
        (
          SELECT ROUND(AVG(cr.rating)::numeric, 1)
          FROM center_ratings cr
          WHERE cr.center_id = cwd.id AND cr.rating IS NOT NULL
        ) AS rating_average,
        (
          SELECT COUNT(*)
          FROM center_ratings cr
          WHERE cr.center_id = cwd.id AND cr.rating IS NOT NULL
        ) AS rating_count,
        (
          SELECT ROUND(
            100.0 * SUM(CASE WHEN cr.satisfaction = 'SATISFIED' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(cr.satisfaction), 0),
            1
          )
          FROM center_ratings cr
          WHERE cr.center_id = cwd.id AND cr.satisfaction IS NOT NULL
        ) AS satisfaction_rate,
        (
          SELECT cr.rating
          FROM center_ratings cr
          WHERE cr.center_id = cwd.id AND cr.user_id = $4
          LIMIT 1
        ) AS my_rating,
        (
          SELECT cr.satisfaction
          FROM center_ratings cr
          WHERE cr.center_id = cwd.id AND cr.user_id = $4
          LIMIT 1
        ) AS my_satisfaction,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'name', s.name,
              'description', s.description,
              'bedsAvailable', s.beds_available,
              'bedsOccupied', s.beds_occupied,
              'bedsOutOfService', s.beds_out_of_service,
              'isActive', s.is_active
            )
            ORDER BY s.id
          )
          FROM health_center_services s
          WHERE s.center_id = cwd.id AND s.is_active
        ), '[]'::json) AS services
      FROM centers_with_distance cwd
      ${filterClause}
      ORDER BY cwd.distance_km ASC;
    `,
    params
  );

  return res.json(result.rows.map(mapCenterRow));
}

export async function getAllCenters(req, res) {
  const viewerId = Number(req.user.id);
  const scope = await getRequesterScope(req);
  const includeInactiveParam = String(req.query?.includeInactive || "").trim().toLowerCase();
  const includeInactive = ["1", "true", "yes"].includes(includeInactiveParam);
  const canIncludeInactive = includeInactive && (isAdminRole(scope.role) || isEtablissementRole(scope.role));
  const params = [viewerId];
  const whereParts = [];
  applyCenterScope(whereParts, params, scope, "hc");
  if (!canIncludeInactive) {
    whereParts.push("hc.is_active = TRUE");
  }
  if (!isAdminRole(scope.role) && !isEtablissementRole(scope.role)) {
    whereParts.push("hc.approval_status = 'APPROVED'");
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        hc.id,
        hc.name,
        hc.address,
        hc.establishment_code,
        hc.level,
        hc.establishment_type,
        hc.technical_platform,
        hc.region_code,
        hc.district_code,
        hc.latitude,
        hc.longitude,
        hc.created_by,
        hc.approval_status,
        hc.is_active,
        hc.created_at,
        hc.updated_at,
        (
          SELECT ROUND(AVG(cr.rating)::numeric, 1)
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.rating IS NOT NULL
        ) AS rating_average,
        (
          SELECT COUNT(*)
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.rating IS NOT NULL
        ) AS rating_count,
        (
          SELECT ROUND(
            100.0 * SUM(CASE WHEN cr.satisfaction = 'SATISFIED' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(cr.satisfaction), 0),
            1
          )
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.satisfaction IS NOT NULL
        ) AS satisfaction_rate,
        (
          SELECT cr.rating
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.user_id = $1
          LIMIT 1
        ) AS my_rating,
        (
          SELECT cr.satisfaction
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.user_id = $1
          LIMIT 1
        ) AS my_satisfaction,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'name', s.name,
              'description', s.description,
              'bedsAvailable', s.beds_available,
              'bedsOccupied', s.beds_occupied,
              'bedsOutOfService', s.beds_out_of_service,
              'isActive', s.is_active
            )
            ORDER BY s.id
          )
          FROM health_center_services s
          WHERE s.center_id = hc.id
        ), '[]'::json) AS services
      FROM health_centers hc
      ${whereClause}
      ORDER BY hc.created_at DESC;
    `,
    params
  );

  return res.json(result.rows.map(mapCenterRow));
}

export async function exportEspcCenters(req, res) {
  const result = await pool.query(
    `
      SELECT
        hc.name,
        hc.address,
        hc.latitude,
        hc.longitude,
        hc.technical_platform,
        hc.level,
        hc.establishment_type,
        hc.establishment_code,
        hc.region_code,
        hc.district_code,
        COALESCE((
          SELECT string_agg(trim(s.name), ', ' ORDER BY trim(s.name))
          FROM health_center_services s
          WHERE s.center_id = hc.id AND s.is_active
            AND trim(coalesce(s.name, '')) <> ''
        ), '') AS services
      FROM health_centers hc
      WHERE
        hc.level IN ('ESPC', 'CENTRE_SANTE', 'CLINIQUE', 'POLYCLINIQUE', 'INFIRMERIE')
        OR upper(hc.name) LIKE '%ESPC%'
        OR upper(hc.name) LIKE '%PREMIER CONTACT%'
        OR upper(coalesce(hc.technical_platform, '')) LIKE '%ESPC%'
        OR upper(coalesce(hc.technical_platform, '')) LIKE '%PREMIER CONTACT%'
        OR upper(coalesce(hc.establishment_code, '')) LIKE '%ESPC%'
      ORDER BY hc.name ASC;
    `
  );

  return sendCsv(
    res,
    "espc_sante_aproximite.csv",
    [
      "name",
      "address",
      "latitude",
      "longitude",
      "technicalPlatform",
      "level",
      "establishmentType",
      "establishmentCode",
      "regionCode",
      "districtCode",
      "services"
    ],
    result.rows.map((row) => [
      row.name,
      row.address,
      row.latitude ?? "",
      row.longitude ?? "",
      row.technical_platform || "",
      row.level || "",
      row.establishment_type || "",
      row.establishment_code || "",
      row.region_code || "",
      row.district_code || "",
      row.services || ""
    ])
  );
}

export async function getCentersSync(req, res) {
  const viewerId = Number(req.user.id);
  const sinceRaw = typeof req.query?.since === "string" ? req.query.since.trim() : "";
  const sinceDate = sinceRaw ? new Date(sinceRaw) : null;
  const hasValidSince = sinceDate instanceof Date && !Number.isNaN(sinceDate?.getTime?.());
  const params = [viewerId];
  const whereParts = hasValidSince ? [] : ["hc.is_active = TRUE", "hc.approval_status = 'APPROVED'"];

  if (hasValidSince) {
    whereParts.push(`hc.updated_at > $${params.length + 1}`);
    params.push(sinceDate.toISOString());
  }

  const result = await pool.query(
    `
      SELECT
        hc.id,
        hc.name,
        hc.address,
        hc.establishment_code,
        hc.level,
        hc.establishment_type,
        hc.technical_platform,
        hc.region_code,
        hc.district_code,
        hc.latitude,
        hc.longitude,
        hc.created_by,
        hc.approval_status,
        hc.is_active,
        hc.created_at,
        hc.updated_at,
        (
          SELECT ROUND(AVG(cr.rating)::numeric, 1)
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.rating IS NOT NULL
        ) AS rating_average,
        (
          SELECT COUNT(*)
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.rating IS NOT NULL
        ) AS rating_count,
        (
          SELECT ROUND(
            100.0 * SUM(CASE WHEN cr.satisfaction = 'SATISFIED' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(cr.satisfaction), 0),
            1
          )
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.satisfaction IS NOT NULL
        ) AS satisfaction_rate,
        (
          SELECT cr.rating
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.user_id = $1
          LIMIT 1
        ) AS my_rating,
        (
          SELECT cr.satisfaction
          FROM center_ratings cr
          WHERE cr.center_id = hc.id AND cr.user_id = $1
          LIMIT 1
        ) AS my_satisfaction,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'name', s.name,
              'description', s.description,
              'bedsAvailable', s.beds_available,
              'bedsOccupied', s.beds_occupied,
              'bedsOutOfService', s.beds_out_of_service,
              'isActive', s.is_active
            )
            ORDER BY s.id
          )
          FROM health_center_services s
          WHERE s.center_id = hc.id AND s.is_active
        ), '[]'::json) AS services
      FROM health_centers hc
      WHERE ${whereParts.join(" AND ")}
      ORDER BY hc.updated_at ASC, hc.id ASC;
    `,
    params
  );

  return res.json({
    serverTime: new Date().toISOString(),
    centers: result.rows.map(mapCenterRow)
  });
}

export async function importCenters(req, res) {
  const payload = Array.isArray(req.body?.centers) ? req.body.centers : req.body;
  const centers = Array.isArray(payload) ? payload : [];

  if (centers.length === 0) {
    return res.status(400).json({
      message: "Envoyez un tableau de centres dans le body ou dans la cle 'centers'"
    });
  }

  const normalizedCenters = [];
  const errors = [];

  centers.forEach((center, index) => {
    const lat = toNumber(center?.latitude);
    const lon = toNumber(center?.longitude);
    const name = typeof center?.name === "string" ? center.name.trim() : "";
    const addressRaw = typeof center?.address === "string" ? center.address.trim() : "";
    const address = addressRaw || "Adresse non renseignee";
    const rawCode = center?.establishmentCode ?? center?.codeEtablissement ?? center?.code;
    const establishmentCode = normalizeEstablishmentCode(rawCode);
    const level = typeof center?.level === "string" ? center.level.trim() : "";
    const regionCode = normalizeGeoCode(center?.regionCode ?? center?.region ?? center?.region_code);
    const districtCode = normalizeGeoCode(center?.districtCode ?? center?.district ?? center?.district_code);
    const rawEstablishmentType =
      center?.establishmentType ?? center?.typeEtablissement ?? center?.type;
    const establishmentType = normalizeEstablishmentType(rawEstablishmentType);
    const technicalPlatformRaw =
      typeof center?.technicalPlatform === "string" ? center.technicalPlatform.trim() : "";
    const technicalPlatform = technicalPlatformRaw || "Non renseigne";

    const missingFields = [];
    if (!name) missingFields.push("name");
    if (!regionCode) missingFields.push("regionCode");
    if (lat === null) missingFields.push("latitude");
    if (lon === null) missingFields.push("longitude");

    if (missingFields.length > 0) {
      errors.push({
        index,
        message: `Champs obligatoires manquants: ${missingFields.join(", ")}`
      });
      return;
    }

    if (center?.level != null && !normalizeCenterLevel(center.level)) {
      errors.push({
        index,
        message:
          "level invalide. Valeurs: CHU, CHR, CH, CHS, CLINIQUE, POLYCLINIQUE, INFIRMERIE, CLCC, ESPC, CENTRE_SANTE, SSR, EHPAD_USLD, CENTRE_RADIOTHERAPIE, CENTRE_CARDIOLOGIE"
      });
      return;
    }

    if (rawEstablishmentType != null && !establishmentType) {
      errors.push({
        index,
        message: "establishmentType invalide. Valeurs: CONFESSIONNEL, PRIVE, PUBLIQUE"
      });
      return;
    }

    normalizedCenters.push({
      name,
      address,
      establishmentCode,
      level: normalizeCenterLevel(level) || "CENTRE_SANTE",
      establishmentType: establishmentType || "PUBLIQUE",
      technicalPlatform,
      regionCode,
      districtCode,
      latitude: lat,
      longitude: lon,
      services: center.services ?? []
    });
  });

  if (errors.length > 0) {
    return res.status(400).json({
      message: "Certaines lignes sont invalides",
      errors
    });
  }

  const allRegions = await pool.query("SELECT code, name FROM regions");
  const regionSet = new Set();
  const regionNameToCode = new Map();
  allRegions.rows.forEach((row) => {
    const code = String(row.code || "").toUpperCase();
    const name = String(row.name || "").trim().toUpperCase();
    if (code) {
      regionSet.add(code);
      regionNameToCode.set(code, code);
    }
    if (name) {
      regionNameToCode.set(name, code);
    }
  });
  const allDistricts = await pool.query("SELECT code, region_code FROM districts");
  const districtToRegion = new Map(
    allDistricts.rows.map((row) => [
      String(row.code || "").toUpperCase(),
      String(row.region_code || "").toUpperCase()
    ])
  );

  normalizedCenters.forEach((center, index) => {
    const normalizedRegionInput = String(center.regionCode || "").toUpperCase();
    const resolvedRegion = regionNameToCode.get(normalizedRegionInput) || normalizedRegionInput;
    center.regionCode = resolvedRegion;

    if (resolvedRegion && !regionSet.has(resolvedRegion)) {
      // Some legacy files use numeric region codes (for example "01") that are
      // not present in the regions table. Keep the imported value instead of
      // blocking the whole file so export/import round-trips stay possible.
      return;
    }

    const normalizedDistrict = String(center.districtCode || "").toUpperCase();
    if (!normalizedDistrict) return;
    const districtRegion = districtToRegion.get(normalizedDistrict);
    if (!districtRegion) {
      // Same tolerance as region codes: preserve unknown legacy district codes.
      return;
    }
    if (resolvedRegion && regionSet.has(resolvedRegion) && districtRegion !== resolvedRegion) {
      errors.push({
        index,
        message: `Le district ${normalizedDistrict} n'appartient pas a la region ${resolvedRegion}`
      });
    }
  });

  if (errors.length > 0) {
    return res.status(400).json({
      message: "Certaines lignes sont invalides",
      errors
    });
  }

  const client = await pool.connect();
  const importedCenters = [];
  try {
    await client.query("BEGIN");
    const importStatus = isAdminRole(req.user.role) ? "APPROVED" : "PENDING";

    for (const center of normalizedCenters) {
      const imported = await insertCenterWithServices(
        client,
        center,
        Number(req.user.id),
        importStatus
      );
      importedCenters.push(imported);
    }

    await client.query("COMMIT");
    return res.status(201).json({
      importedCount: importedCenters.length,
      centers: importedCenters
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createComplaintInternal(req, res, centerIdInput) {
  if (isEtablissementRole(req.user.role)) {
    return res.status(403).json({
      message: "Un chef d'etablissement ne peut pas poser de plainte depuis son compte"
    });
  }

  const centerId = centerIdInput == null ? null : Number(centerIdInput);
  const hasCenter = centerId !== null;
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (hasCenter && (!Number.isInteger(centerId) || centerId <= 0)) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  if (!subject || !message) {
    return res.status(400).json({ message: "subject et message sont obligatoires" });
  }

  if (hasCenter) {
    const center = await pool.query("SELECT id FROM health_centers WHERE id = $1 LIMIT 1", [centerId]);
    if (center.rowCount === 0) {
      return res.status(404).json({ message: "Centre introuvable" });
    }
  }

  const inserted = await pool.query(
    `
      INSERT INTO center_complaints (center_id, user_id, subject, message, status)
      VALUES ($1, $2, $3, $4, 'NEW')
      RETURNING id, center_id, user_id, subject, message, status, handled_by, handled_at, created_at;
    `,
    [hasCenter ? centerId : null, Number(req.user.id), subject, message]
  );
  await pool.query(
    `
      INSERT INTO complaint_updates (complaint_id, user_id, status, message)
      VALUES ($1, $2, 'NEW', $3);
    `,
    [inserted.rows[0].id, Number(req.user.id), "Plainte enregistree"]
  );

  return res.status(201).json({
    id: String(inserted.rows[0].id),
    centerId: inserted.rows[0].center_id == null ? null : String(inserted.rows[0].center_id),
    userId: String(inserted.rows[0].user_id),
    subject: inserted.rows[0].subject,
    message: inserted.rows[0].message,
    status: inserted.rows[0].status,
    handledBy: inserted.rows[0].handled_by == null ? null : String(inserted.rows[0].handled_by),
    handledAt: inserted.rows[0].handled_at,
    createdAt: inserted.rows[0].created_at
  });
}

export async function updateCenter(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const {
    name,
    address,
    establishmentCode,
    level,
    establishmentType,
    technicalPlatform,
    services = [],
    regionCode,
    districtCode,
    latitude,
    longitude
  } = req.body;

  const lat = toNumber(latitude);
  const lon = toNumber(longitude);
  const normalizedCode = normalizeEstablishmentCode(establishmentCode);
  const normalizedLevel = normalizeCenterLevel(level);
  const normalizedType = normalizeEstablishmentType(establishmentType);
  const normalizedRegionCode = normalizeGeoCode(regionCode);
  const normalizedDistrictCode = normalizeGeoCode(districtCode);

  if (!name || !address || !normalizedRegionCode || !technicalPlatform || lat === null || lon === null) {
    return res.status(400).json({
      message: "name, address, regionCode, technicalPlatform, latitude et longitude sont obligatoires"
    });
  }
  if (!normalizedLevel || !normalizedType) {
    return res.status(400).json({ message: "level ou establishmentType invalide" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const geoValidation = await validateRegionDistrict(
      normalizedRegionCode,
      normalizedDistrictCode,
      client
    );
    if (!geoValidation.ok) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: geoValidation.message });
    }

    const owned = await client.query(
      `
        SELECT id, name, address, establishment_code, level, establishment_type,
               region_code, district_code, latitude, longitude
        FROM health_centers
        WHERE id = $1 AND created_by = $2
        LIMIT 1;
      `,
      [centerId, Number(req.user.id)]
    );
    if (owned.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Vous ne pouvez modifier que votre centre" });
    }

    // Plateau technique, services et places sont modifiables sans repasser par la validation
    // centrale ; seuls les champs identitaires/de classification ci-dessous la declenchent.
    const existing = owned.rows[0];
    const sensitiveFieldsChanged =
      String(existing.name || "") !== name.trim() ||
      String(existing.address || "") !== address.trim() ||
      String(existing.establishment_code || "") !== String(normalizedCode || "") ||
      String(existing.level || "") !== normalizedLevel ||
      String(existing.establishment_type || "") !== normalizedType ||
      String(existing.region_code || "") !== normalizedRegionCode ||
      String(existing.district_code || "") !== String(normalizedDistrictCode || "") ||
      Number(existing.latitude) !== lat ||
      Number(existing.longitude) !== lon;

    await client.query(
      `
        UPDATE health_centers
        SET
          name = $2,
          address = $3,
          establishment_code = $4,
          level = $5,
          establishment_type = $6,
          technical_platform = $7,
          region_code = $8,
          district_code = $9,
          latitude = $10,
          longitude = $11,
          updated_at = NOW()
          ${sensitiveFieldsChanged ? ", approval_status = 'PENDING', approved_by = NULL, approved_at = NULL" : ""}
        WHERE id = $1;
      `,
      [
        centerId,
        name.trim(),
        address.trim(),
        normalizedCode,
        normalizedLevel,
        normalizedType,
        technicalPlatform.trim(),
        normalizedRegionCode,
        normalizedDistrictCode,
        lat,
        lon
      ]
    );

    await client.query("DELETE FROM health_center_services WHERE center_id = $1", [centerId]);
    const normalizedServices = normalizeServices(services);
    for (const service of normalizedServices) {
      await client.query(
        `
          INSERT INTO health_center_services (center_id, name, description, beds_available, beds_occupied, beds_out_of_service, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7);
        `,
        [centerId, service.name, service.description || null, service.bedsAvailable, service.bedsOccupied, service.bedsOutOfService, service.isActive !== false]
      );
    }

    const updated = await client.query(
      `
        SELECT
          hc.id,
          hc.name,
          hc.address,
          hc.establishment_code,
          hc.level,
          hc.establishment_type,
          hc.technical_platform,
          hc.region_code,
          hc.district_code,
          hc.latitude,
          hc.longitude,
          hc.created_by,
          hc.approval_status,
          COALESCE((
            SELECT json_agg(
              json_build_object(
              'name', s.name,
              'description', s.description,
              'bedsAvailable', s.beds_available,
              'bedsOccupied', s.beds_occupied,
              'bedsOutOfService', s.beds_out_of_service,
              'isActive', s.is_active
            )
              ORDER BY s.id
            )
            FROM health_center_services s
            WHERE s.center_id = hc.id
          ), '[]'::json) AS services
        FROM health_centers hc
        WHERE hc.id = $1;
      `,
      [centerId]
    );

    await client.query("COMMIT");
    return res.json(mapCenterRow(updated.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCenterByAdmin(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const {
    name,
    address,
    establishmentCode,
    level,
    establishmentType,
    technicalPlatform,
    services = [],
    regionCode,
    districtCode,
    latitude,
    longitude
  } = req.body;

  const lat = toNumber(latitude);
  const lon = toNumber(longitude);
  const normalizedCode = normalizeEstablishmentCode(establishmentCode);
  const normalizedLevel = normalizeCenterLevel(level);
  const normalizedType = normalizeEstablishmentType(establishmentType);
  const normalizedRegionCode = normalizeGeoCode(regionCode);
  const normalizedDistrictCode = normalizeGeoCode(districtCode);

  if (!name || !address || !normalizedRegionCode || !technicalPlatform || lat === null || lon === null) {
    return res.status(400).json({
      message: "name, address, regionCode, technicalPlatform, latitude et longitude sont obligatoires"
    });
  }
  if (!normalizedLevel || !normalizedType) {
    return res.status(400).json({ message: "level ou establishmentType invalide" });
  }

  const scope = await getRequesterScope(req);
  const access = await canViewCenterByScope(scope, centerId);
  if (!access.exists) {
    return res.status(404).json({ message: "Centre introuvable" });
  }
  if (!access.allowed) {
    return res.status(403).json({ message: "Acces refuse a ce centre" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const geoValidation = await validateRegionDistrict(
      normalizedRegionCode,
      normalizedDistrictCode,
      client
    );
    if (!geoValidation.ok) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: geoValidation.message });
    }

    await client.query(
      `
        UPDATE health_centers
        SET
          name = $2,
          address = $3,
          establishment_code = $4,
          level = $5,
          establishment_type = $6,
          technical_platform = $7,
          region_code = $8,
          district_code = $9,
          latitude = $10,
          longitude = $11,
          updated_at = NOW()
        WHERE id = $1;
      `,
      [
        centerId,
        name.trim(),
        address.trim(),
        normalizedCode,
        normalizedLevel,
        normalizedType,
        technicalPlatform.trim(),
        normalizedRegionCode,
        normalizedDistrictCode,
        lat,
        lon
      ]
    );

    await client.query("DELETE FROM health_center_services WHERE center_id = $1", [centerId]);
    const normalizedServices = normalizeServices(services);
    for (const service of normalizedServices) {
      await client.query(
        `
          INSERT INTO health_center_services (center_id, name, description, beds_available, beds_occupied, beds_out_of_service, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7);
        `,
        [centerId, service.name, service.description || null, service.bedsAvailable, service.bedsOccupied, service.bedsOutOfService, service.isActive !== false]
      );
    }

    const updated = await client.query(
      `
        SELECT
          hc.id,
          hc.name,
          hc.address,
          hc.establishment_code,
          hc.level,
          hc.establishment_type,
          hc.technical_platform,
          hc.region_code,
          hc.district_code,
          hc.latitude,
          hc.longitude,
          hc.created_by,
          hc.approval_status,
          hc.is_active,
          COALESCE((
            SELECT json_agg(
              json_build_object(
              'name', s.name,
              'description', s.description,
              'bedsAvailable', s.beds_available,
              'bedsOccupied', s.beds_occupied,
              'bedsOutOfService', s.beds_out_of_service,
              'isActive', s.is_active
            )
              ORDER BY s.id
            )
            FROM health_center_services s
            WHERE s.center_id = hc.id
          ), '[]'::json) AS services
        FROM health_centers hc
        WHERE hc.id = $1;
      `,
      [centerId]
    );

    await client.query("COMMIT");
    return res.json(mapCenterRow(updated.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setCenterActiveByAdmin(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const isActive = req.body?.isActive;
  if (typeof isActive !== "boolean") {
    return res.status(400).json({ message: "isActive (boolean) est obligatoire" });
  }

  const scope = await getRequesterScope(req);
  const access = await canViewCenterByScope(scope, centerId);
  if (!access.exists) {
    return res.status(404).json({ message: "Centre introuvable" });
  }
  if (!access.allowed) {
    return res.status(403).json({ message: "Acces refuse a ce centre" });
  }

  const updated = await pool.query(
    `
      UPDATE health_centers
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        name,
        address,
        establishment_code,
        level,
        establishment_type,
        technical_platform,
        region_code,
        district_code,
        latitude,
        longitude,
        created_by,
        approval_status,
        is_active;
    `,
    [centerId, isActive]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ message: "Centre introuvable" });
  }

  return res.json(mapCenterRow({ ...updated.rows[0], services: [] }));
}

export async function deleteCenterByAdmin(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const scope = await getRequesterScope(req);
  const access = await canViewCenterByScope(scope, centerId);
  if (!access.exists) {
    return res.status(404).json({ message: "Centre introuvable" });
  }
  if (!access.allowed) {
    return res.status(403).json({ message: "Acces refuse a ce centre" });
  }

  await pool.query("DELETE FROM health_centers WHERE id = $1", [centerId]);
  return res.json({ id: String(centerId), deleted: true });
}

export async function reviewCenter(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const action = req.body?.action === "REJECT" ? "REJECT" : "APPROVE";
  const status = action === "APPROVE" ? "APPROVED" : "REJECTED";

  const updated = await pool.query(
    `
      UPDATE health_centers
      SET
        approval_status = $2,
        approved_by = $3,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        name,
        address,
        establishment_code,
        level,
        establishment_type,
        technical_platform,
        region_code,
        district_code,
        latitude,
        longitude,
        created_by,
        approval_status;
    `,
    [centerId, status, Number(req.user.id)]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ message: "Centre introuvable" });
  }

  return res.json(mapCenterRow({ ...updated.rows[0], services: [] }));
}

export async function listPendingCenters(req, res) {
  const scope = await getRequesterScope(req);
  const whereParts = ["hc.approval_status = 'PENDING'"];
  const params = [];
  if (scope.role === "DISTRICT" && scope.districtCode) {
    whereParts.push(`upper(hc.district_code) = $${params.length + 1}`);
    params.push(scope.districtCode);
  } else if (scope.role === "REGION" && scope.regionCode) {
    whereParts.push(`upper(hc.region_code) = $${params.length + 1}`);
    params.push(scope.regionCode);
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const result = await pool.query(
    `
      SELECT
        hc.id,
        hc.name,
        hc.address,
        hc.establishment_code,
        hc.level,
        hc.establishment_type,
        hc.technical_platform,
        hc.region_code,
        hc.district_code,
        hc.latitude,
        hc.longitude,
        hc.created_by,
        hc.approval_status,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'name', s.name,
              'description', s.description,
              'bedsAvailable', s.beds_available,
              'bedsOccupied', s.beds_occupied,
              'bedsOutOfService', s.beds_out_of_service,
              'isActive', s.is_active
            )
            ORDER BY s.id
          )
          FROM health_center_services s
          WHERE s.center_id = hc.id
        ), '[]'::json) AS services
      FROM health_centers hc
      ${whereClause}
      ORDER BY hc.created_at ASC;
    `,
    params
  );

  return res.json(result.rows.map(mapCenterRow));
}

export async function deleteAllCenters(req, res) {
  const confirmation = String(req.body?.confirm || "").trim();
  if (confirmation !== "DELETE_ALL_CENTERS") {
    return res.status(400).json({
      message: "Confirmation requise: envoyez confirm=DELETE_ALL_CENTERS"
    });
  }

  const deleted = await pool.query("DELETE FROM health_centers;");
  return res.json({
    message: "Tous les centres ont ete supprimes",
    deletedCount: Number(deleted.rowCount || 0)
  });
}

export async function getMyVisits(req, res) {
  const result = await pool.query(
    `SELECT center_id, visited_at, confirmation_type
     FROM center_visits
     WHERE user_id = $1
     ORDER BY visited_at DESC`,
    [req.user.id]
  );
  return res.json({
    visits: result.rows.map((r) => ({
      centerId: String(r.center_id),
      visitedAt: r.visited_at,
      type: r.confirmation_type,
    })),
  });
}

export async function selfDeclareVisit(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }
  const center = await pool.query(`SELECT id FROM health_centers WHERE id = $1 LIMIT 1`, [centerId]);
  if (center.rowCount === 0) return res.status(404).json({ message: "Centre introuvable" });

  await pool.query(
    `INSERT INTO center_visits (center_id, user_id, confirmation_type)
     VALUES ($1, $2, 'SELF_DECLARED')
     ON CONFLICT (center_id, user_id)
     DO NOTHING`,
    [centerId, req.user.id]
  );
  return res.json({ success: true, message: "Visite declaree" });
}

export async function checkinByCode(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
  if (!code) return res.status(400).json({ message: "Code requis" });

  const result = await pool.query(
    `SELECT id FROM health_centers WHERE id = $1 AND UPPER(checkin_code) = $2 LIMIT 1`,
    [centerId, code]
  );
  if (result.rowCount === 0) {
    return res.status(400).json({ message: "Code incorrect" });
  }

  await pool.query(
    `INSERT INTO center_visits (center_id, user_id, confirmation_type)
     VALUES ($1, $2, 'CODE')
     ON CONFLICT (center_id, user_id)
     DO UPDATE SET visited_at = NOW(), confirmation_type = 'CODE'`,
    [centerId, req.user.id]
  );
  return res.json({ success: true, message: "Visite enregistree" });
}

export async function confirmVisitByPro(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  let patientId = Number(req.body?.patientId);
  const patientPhone = typeof req.body?.patientPhone === "string" ? req.body.patientPhone.trim() : "";

  if ((!Number.isInteger(patientId) || patientId <= 0) && patientPhone) {
    const found = await pool.query(
      `SELECT id FROM users WHERE phone_number = $1 LIMIT 1`,
      [patientPhone]
    );
    if (found.rowCount === 0) return res.status(404).json({ message: "Aucun patient avec ce numero de telephone" });
    patientId = found.rows[0].id;
  }

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return res.status(400).json({ message: "patientId ou patientPhone requis" });
  }

  const center = await pool.query(`SELECT id FROM health_centers WHERE id = $1 LIMIT 1`, [centerId]);
  if (center.rowCount === 0) return res.status(404).json({ message: "Centre introuvable" });

  await pool.query(
    `INSERT INTO center_visits (center_id, user_id, confirmation_type, confirmed_by)
     VALUES ($1, $2, 'PROFESSIONAL', $3)
     ON CONFLICT (center_id, user_id)
     DO UPDATE SET visited_at = NOW(), confirmation_type = 'PROFESSIONAL', confirmed_by = $3`,
    [centerId, patientId, req.user.id]
  );
  return res.json({ success: true, message: "Visite confirmee" });
}

export async function getCheckinCode(req, res) {
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }
  const result = await pool.query(
    `SELECT checkin_code FROM health_centers WHERE id = $1 LIMIT 1`,
    [centerId]
  );
  if (result.rowCount === 0) return res.status(404).json({ message: "Centre introuvable" });
  const checkinCode = result.rows[0].checkin_code;
  return res.json({ checkinCode, feedbackUrl: buildFeedbackUrl(req, centerId, checkinCode) });
}

export async function rateCenter(req, res) {
  if (isEtablissementRole(req.user.role)) {
    return res.status(403).json({ message: "Un chef d'etablissement ne peut pas noter un centre" });
  }

  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const rawRating = req.body?.rating;
  const rating = rawRating == null || rawRating === "" ? null : Number(rawRating);
  const rawSatisfaction =
    typeof req.body?.satisfaction === "string" ? req.body.satisfaction.trim().toUpperCase() : "";
  const satisfaction =
    rawSatisfaction === "SATISFIED" || rawSatisfaction === "UNSATISFIED" ? rawSatisfaction : null;
  const feedbackMessage =
    typeof req.body?.message === "string" && req.body.message.trim() ? req.body.message.trim() : null;

  if (rating === null && satisfaction === null) {
    return res.status(400).json({ message: "Fournissez une note (1-5) ou une satisfaction" });
  }
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return res.status(400).json({ message: "La note doit etre un entier entre 1 et 5" });
  }

  const center = await pool.query(
    `SELECT id FROM health_centers WHERE id = $1 LIMIT 1`,
    [centerId]
  );
  if (center.rowCount === 0) {
    return res.status(404).json({ message: "Centre introuvable" });
  }

  const visit = await pool.query(
    `SELECT id FROM center_visits WHERE center_id = $1 AND user_id = $2 LIMIT 1`,
    [centerId, Number(req.user.id)]
  );
  if (visit.rowCount === 0) {
    return res.status(403).json({ message: "Vous devez avoir visite ce centre pour laisser un avis" });
  }

  await pool.query(
    `
      INSERT INTO center_ratings (center_id, user_id, rating, satisfaction, feedback_message)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (center_id, user_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        satisfaction = EXCLUDED.satisfaction,
        feedback_message = EXCLUDED.feedback_message,
        updated_at = NOW();
    `,
    [centerId, Number(req.user.id), rating, satisfaction, feedbackMessage]
  );
  await pool.query(
    `
      UPDATE health_centers
      SET updated_at = NOW()
      WHERE id = $1;
    `,
    [centerId]
  );

  const stats = await pool.query(
    `
      SELECT
        (
          SELECT ROUND(AVG(cr.rating)::numeric, 1)
          FROM center_ratings cr
          WHERE cr.center_id = $1 AND cr.rating IS NOT NULL
        ) AS rating_average,
        (
          SELECT COUNT(*)
          FROM center_ratings cr
          WHERE cr.center_id = $1 AND cr.rating IS NOT NULL
        ) AS rating_count,
        (
          SELECT ROUND(
            100.0 * SUM(CASE WHEN cr.satisfaction = 'SATISFIED' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(cr.satisfaction), 0),
            1
          )
          FROM center_ratings cr
          WHERE cr.center_id = $1 AND cr.satisfaction IS NOT NULL
        ) AS satisfaction_rate,
        (
          SELECT cr.rating
          FROM center_ratings cr
          WHERE cr.center_id = $1 AND cr.user_id = $2
          LIMIT 1
        ) AS my_rating,
        (
          SELECT cr.satisfaction
          FROM center_ratings cr
          WHERE cr.center_id = $1 AND cr.user_id = $2
          LIMIT 1
        ) AS my_satisfaction;
    `,
    [centerId, Number(req.user.id)]
  );

  const row = stats.rows[0];
  return res.json({
    centerId: String(centerId),
    ratingAverage: row.rating_average == null ? null : Number(row.rating_average),
    ratingCount: Number(row.rating_count || 0),
    satisfactionRate: row.satisfaction_rate == null ? null : Number(row.satisfaction_rate),
    myRating: row.my_rating == null ? null : Number(row.my_rating),
    mySatisfaction: row.my_satisfaction || null
  });
}

export async function createComplaint(req, res) {
  return createComplaintInternal(req, res, req.params.id);
}

export async function createComplaintGeneric(req, res) {
  const centerId = req.body?.centerId;
  return createComplaintInternal(req, res, centerId == null || centerId === "" ? null : centerId);
}

export async function getCenterComplaints(req, res) {
  if (!hasRequestRole(req, COMPLAINT_VIEW_ROLES)) {
    return res.status(403).json({ message: "Acces refuse" });
  }
  const centerId = Number(req.params.id);

  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const scope = await getRequesterScope(req);
  const access = await canViewCenterByScope(scope, centerId, {
    onlyApprovedForEstablishment: true
  });
  if (!access.exists) {
    return res.status(404).json({ message: "Centre introuvable" });
  }
  if (!access.allowed) {
    return res.status(403).json({ message: "Acces refuse a ce centre" });
  }

  const complaints = await pool.query(
    `
      SELECT
        c.id,
        c.center_id,
        c.user_id,
        c.subject,
        c.message,
        c.status,
        c.handled_by,
        c.handled_at,
        c.created_at,
        u.full_name AS user_full_name
      FROM center_complaints c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.center_id = $1
      ORDER BY c.created_at DESC;
    `,
    [centerId]
  );

  return res.json(
    complaints.rows.map((row) => ({
      id: String(row.id),
      centerId: String(row.center_id),
      userId: String(row.user_id),
      userFullName: row.user_full_name,
      subject: row.subject,
      message: row.message,
      status: row.status,
      handledBy: row.handled_by == null ? null : String(row.handled_by),
      handledAt: row.handled_at,
      createdAt: row.created_at
    }))
  );
}

export async function getAllComplaints(req, res) {
  if (!hasRequestRole(req, COMPLAINT_VIEW_ROLES)) {
    return res.status(403).json({ message: "Acces refuse" });
  }
  const requesterRoles = getEffectiveRequestRoles(req);
  const canViewJustifications = requesterRoles.some((role) => isAdminRole(role));
  const scope = await getRequesterScope(req);
  const status = typeof req.query?.status === "string" ? req.query.status.trim().toUpperCase() : "";
  const allowed = ["NEW", "IN_PROGRESS", "RESOLVED", "REJECTED"];
  const whereParts = [];
  const params = [];
  if (allowed.includes(status)) {
    whereParts.push(`c.status = $${params.length + 1}`);
    params.push(status);
  }
  applyCenterScope(whereParts, params, scope, "hc", {
    onlyApprovedForEstablishment: true
  });
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        c.id,
        c.center_id,
        c.user_id,
        c.subject,
        c.message,
        c.status,
        c.handled_by,
        c.handled_at,
        c.created_at,
        u.full_name AS user_full_name,
        hc.name AS center_name,
        hc.establishment_code AS center_code,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', cu.id,
              'status', cu.status,
              'message', cu.message,
              'createdAt', cu.created_at
            )
            ORDER BY cu.created_at ASC
          )
          FROM complaint_updates cu
          WHERE cu.complaint_id = c.id
        ), '[]'::json) AS updates
      FROM center_complaints c
      INNER JOIN users u ON u.id = c.user_id
      LEFT JOIN health_centers hc ON hc.id = c.center_id
      ${whereClause}
      ORDER BY
        CASE c.status
          WHEN 'NEW' THEN 1
          WHEN 'IN_PROGRESS' THEN 2
          WHEN 'REJECTED' THEN 3
          ELSE 4
        END,
        c.created_at DESC;
    `,
    params
  );

  return res.json(
    result.rows.map((row) => ({
      id: String(row.id),
      centerId: row.center_id == null ? null : String(row.center_id),
      centerName: row.center_name || null,
      centerCode: row.center_code || null,
      userId: String(row.user_id),
      userFullName: row.user_full_name,
      subject: row.subject,
      message: row.message,
      status: row.status,
      handledBy: row.handled_by == null ? null : String(row.handled_by),
      handledAt: row.handled_at,
      createdAt: row.created_at,
      ...(canViewJustifications ? { updates: row.updates || [] } : {})
    }))
  );
}

export async function getComplaintsSummary(req, res) {
  if (!hasRequestRole(req, COMPLAINT_VIEW_ROLES)) {
    return res.status(403).json({ message: "Acces refuse" });
  }
  const scope = await getRequesterScope(req);
  const whereParts = [];
  const params = [];
  applyCenterScope(whereParts, params, scope, "hc", {
    onlyApprovedForEstablishment: true
  });
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const complaintsAgg = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE c.status = 'NEW')::int AS new_count,
        COUNT(*) FILTER (WHERE c.status = 'IN_PROGRESS')::int AS in_progress_count,
        COUNT(*) FILTER (WHERE c.status = 'RESOLVED')::int AS resolved_count,
        COUNT(*) FILTER (WHERE c.status = 'REJECTED')::int AS rejected_count
      FROM center_complaints c
      LEFT JOIN health_centers hc ON hc.id = c.center_id
      ${whereClause};
    `,
    params
  );

  const aggregateByAllScopedCenters = ["DEVELOPER", "DISTRICT", "REGION", "NATIONAL", "REGULATOR"].includes(scope.role);
  const ratingsAgg = aggregateByAllScopedCenters
    ? await pool.query(
        `
          WITH centers_scope AS (
            SELECT hc.id
            FROM health_centers hc
            ${whereClause}
          ),
          per_center AS (
            SELECT
              cs.id AS center_id,
              ROUND(AVG(cr.rating)::numeric, 1) AS center_rating_average,
              ROUND(
                100.0 * SUM(CASE WHEN cr.satisfaction = 'SATISFIED' THEN 1 ELSE 0 END)
                / NULLIF(COUNT(cr.satisfaction), 0),
                1
              ) AS center_satisfaction_rate,
              COUNT(cr.rating)::int AS center_rating_count
            FROM centers_scope cs
            LEFT JOIN center_ratings cr ON cr.center_id = cs.id
            GROUP BY cs.id
          ),
          totals AS (
            SELECT
              COUNT(cr.rating)::int AS rating_count,
              COUNT(DISTINCT cs.id)::int AS center_count,
              COUNT(DISTINCT cs.id) FILTER (
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM center_ratings cr2
                  WHERE cr2.center_id = cs.id
                )
              )::int AS centers_without_evaluation
            FROM centers_scope cs
            LEFT JOIN center_ratings cr ON cr.center_id = cs.id
          )
          SELECT
            ROUND(AVG(COALESCE(pc.center_rating_average, 0))::numeric, 1) AS rating_average,
            MAX(t.rating_count) AS rating_count,
            ROUND(AVG(COALESCE(pc.center_satisfaction_rate, 0))::numeric, 1) AS satisfaction_rate,
            MAX(t.centers_without_evaluation) AS centers_without_evaluation
          FROM per_center pc
          CROSS JOIN totals t;
        `,
        params
      )
    : await pool.query(
        `
          SELECT
            ROUND(AVG(cr.rating)::numeric, 1) AS rating_average,
            COUNT(cr.rating)::int AS rating_count,
            ROUND(
              100.0 * SUM(CASE WHEN cr.satisfaction = 'SATISFIED' THEN 1 ELSE 0 END)
              / NULLIF(COUNT(cr.satisfaction), 0),
              1
            ) AS satisfaction_rate,
            COUNT(DISTINCT hc.id) FILTER (
              WHERE NOT EXISTS (
                SELECT 1
                FROM center_ratings cr2
                WHERE cr2.center_id = hc.id
              )
            )::int AS centers_without_evaluation
          FROM center_ratings cr
          JOIN health_centers hc ON hc.id = cr.center_id
          ${whereClause};
        `,
        params
      );

  const centersAgg = await pool.query(
    `
      SELECT
        COUNT(*)::int AS center_count
      FROM health_centers hc
      ${whereClause};
    `,
    params
  );

  const scopeLabel =
    scope.role === "DISTRICT"
      ? "DISTRICT"
      : scope.role === "REGION"
        ? "REGION"
        : scope.role === "ETABLISSEMENT" || scope.role === "CHEF_ETABLISSEMENT"
          ? "CENTER"
          : "NATIONAL";

  const c = complaintsAgg.rows[0] || {};
  const r = ratingsAgg.rows[0] || {};
  const centerCount = Number(centersAgg.rows[0]?.center_count || 0);

  return res.json({
    scope: scopeLabel,
    regionCode: scope.regionCode || null,
    districtCode: scope.districtCode || null,
    centerCount,
    complaints: {
      total: Number(c.total || 0),
      newCount: Number(c.new_count || 0),
      inProgressCount: Number(c.in_progress_count || 0),
      resolvedCount: Number(c.resolved_count || 0),
      rejectedCount: Number(c.rejected_count || 0)
    },
    ratingAverage: r.rating_average == null ? null : Number(r.rating_average),
    ratingCount: Number(r.rating_count || 0),
    satisfactionRate: r.satisfaction_rate == null ? null : Number(r.satisfaction_rate),
    centersWithoutEvaluation: Number(r.centers_without_evaluation || 0)
  });
}

export async function updateComplaintStatus(req, res) {
  const complaintId = Number(req.params.id);
  const requesterRoles = getEffectiveRequestRoles(req);
  const requested = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
  const nextStatus = ["IN_PROGRESS", "RESOLVED", "REJECTED"].includes(requested)
    ? requested
    : "IN_PROGRESS";

  if (!Number.isInteger(complaintId) || complaintId <= 0) {
    return res.status(400).json({ message: "ID de plainte invalide" });
  }

  const found = await pool.query(
    `
      SELECT id, center_id
      FROM center_complaints
      WHERE id = $1
      LIMIT 1;
    `,
    [complaintId]
  );
  if (found.rowCount === 0) {
    return res.status(404).json({ message: "Plainte introuvable" });
  }

  const complaint = found.rows[0];
  const complaintCenterId =
    Number.isInteger(Number(complaint.center_id)) && Number(complaint.center_id) > 0
      ? Number(complaint.center_id)
      : null;
  const scope = await getRequesterScope(req);

  if (complaintCenterId) {
    const access = await canViewCenterByScope(scope, complaintCenterId);
    if (!access.allowed) {
      return res.status(403).json({ message: "Acces refuse a cette plainte" });
    }
  } else if (!requesterRoles.some((role) => ["DEVELOPER", "NATIONAL", "REGULATOR"].includes(role))) {
    return res.status(403).json({ message: "Acces refuse a cette plainte" });
  }

  const updated = await pool.query(
    `
      UPDATE center_complaints
      SET
        status = $2,
        handled_by = $3,
        handled_at = NOW()
      WHERE id = $1
      RETURNING id, center_id, user_id, subject, message, status, handled_by, handled_at, created_at;
    `,
    [complaintId, nextStatus, Number(req.user.id)]
  );

  const updateMessage =
    nextStatus === "IN_PROGRESS"
      ? "Votre plainte est prise en charge"
      : nextStatus === "RESOLVED"
        ? "Votre plainte est marquee resolue"
        : "Votre plainte a ete rejetee";
  const customMessage =
    typeof req.body?.message === "string" && req.body.message.trim() ? req.body.message.trim() : updateMessage;

  await pool.query(
    `
      INSERT INTO complaint_updates (complaint_id, user_id, status, message)
      VALUES ($1, $2, $3, $4);
    `,
    [complaintId, Number(req.user.id), nextStatus, customMessage]
  );

  const row = updated.rows[0];
  return res.json({
    id: String(row.id),
    centerId: row.center_id == null ? null : String(row.center_id),
    userId: String(row.user_id),
    subject: row.subject,
    message: row.message,
    status: row.status,
    handledBy: row.handled_by == null ? null : String(row.handled_by),
    handledAt: row.handled_at,
    createdAt: row.created_at
  });
}

export async function addComplaintExplanation(req, res) {
  const complaintId = Number(req.params.id);
  const requesterRoles = getEffectiveRequestRoles(req);
  const explanation =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!Number.isInteger(complaintId) || complaintId <= 0) {
    return res.status(400).json({ message: "ID de plainte invalide" });
  }
  if (!explanation) {
    return res.status(400).json({ message: "Le message d'explication est obligatoire" });
  }

  const found = await pool.query(
    `
      SELECT id, center_id, status
      FROM center_complaints
      WHERE id = $1
      LIMIT 1;
    `,
    [complaintId]
  );
  if (found.rowCount === 0) {
    return res.status(404).json({ message: "Plainte introuvable" });
  }

  const complaint = found.rows[0];
  const complaintCenterId =
    Number.isInteger(Number(complaint.center_id)) && Number(complaint.center_id) > 0
      ? Number(complaint.center_id)
      : null;
  const scope = await getRequesterScope(req);

  if (complaintCenterId) {
    const access = await canViewCenterByScope(scope, complaintCenterId, {
      onlyApprovedForEstablishment: true
    });
    if (!access.allowed) {
      return res.status(403).json({ message: "Acces refuse a cette plainte" });
    }
  } else if (!requesterRoles.some((role) => ["DEVELOPER", "NATIONAL", "REGULATOR"].includes(role))) {
    return res.status(403).json({ message: "Acces refuse a cette plainte" });
  }

  await pool.query(
    `
      INSERT INTO complaint_updates (complaint_id, user_id, status, message)
      VALUES ($1, $2, $3, $4);
    `,
    [complaintId, Number(req.user.id), complaint.status, explanation]
  );

  return res.json({
    complaintId: String(complaintId),
    status: complaint.status,
    message: explanation
  });
}

export async function submitComplaintFeedback(req, res) {
  const complaintId = Number(req.params.id);
  if (!Number.isInteger(complaintId) || complaintId <= 0) {
    return res.status(400).json({ message: "ID de plainte invalide" });
  }

  const rawStatus = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
  if (!["SATISFIED", "UNSATISFIED"].includes(rawStatus)) {
    return res.status(400).json({ message: "status doit etre SATISFIED ou UNSATISFIED" });
  }
  const feedbackMessage =
    typeof req.body?.message === "string" && req.body.message.trim() ? req.body.message.trim() : null;

  const found = await pool.query(
    `
      SELECT id, user_id, status
      FROM center_complaints
      WHERE id = $1
      LIMIT 1;
    `,
    [complaintId]
  );
  if (found.rowCount === 0) {
    return res.status(404).json({ message: "Plainte introuvable" });
  }

  const complaint = found.rows[0];
  if (String(complaint.user_id) !== String(req.user.id)) {
    return res.status(403).json({ message: "Vous ne pouvez valider que vos propres plaintes" });
  }
  if (!["RESOLVED", "REJECTED"].includes(complaint.status)) {
    return res.status(400).json({ message: "La plainte n'est pas encore traitee" });
  }

  const updated = await pool.query(
    `
      UPDATE center_complaints
      SET
        user_feedback_status = $2,
        user_feedback_message = $3,
        user_feedback_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        center_id,
        user_id,
        subject,
        message,
        status,
        handled_by,
        handled_at,
        user_feedback_status,
        user_feedback_message,
        user_feedback_at,
        created_at;
    `,
    [complaintId, rawStatus, feedbackMessage]
  );

  await pool.query(
    `
      INSERT INTO complaint_updates (complaint_id, user_id, status, message)
      VALUES ($1, $2, $3, $4);
    `,
    [
      complaintId,
      Number(req.user.id),
      complaint.status,
      rawStatus === "SATISFIED"
        ? "Usager satisfait du traitement de la plainte"
        : "Usager insatisfait du traitement de la plainte"
    ]
  );

  const row = updated.rows[0];
  return res.json({
    id: String(row.id),
    centerId: row.center_id == null ? null : String(row.center_id),
    userId: String(row.user_id),
    subject: row.subject,
    message: row.message,
    status: row.status,
    handledBy: row.handled_by == null ? null : String(row.handled_by),
    handledAt: row.handled_at,
    userFeedbackStatus: row.user_feedback_status || null,
    userFeedbackMessage: row.user_feedback_message || null,
    userFeedbackAt: row.user_feedback_at || null,
    createdAt: row.created_at
  });
}

export async function getMyComplaints(req, res) {
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.center_id,
        c.user_id,
        c.subject,
        c.message,
        c.status,
        c.handled_by,
        c.handled_at,
        c.user_feedback_status,
        c.user_feedback_message,
        c.user_feedback_at,
        c.created_at,
        hc.name AS center_name,
        hc.establishment_code AS center_code,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', u.id,
              'status', u.status,
              'message', u.message,
              'createdAt', u.created_at
            )
            ORDER BY u.created_at ASC
          )
          FROM complaint_updates u
          WHERE u.complaint_id = c.id
        ), '[]'::json) AS updates
      FROM center_complaints c
      LEFT JOIN health_centers hc ON hc.id = c.center_id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC;
    `,
    [Number(req.user.id)]
  );

  return res.json(
    result.rows.map((row) => ({
      id: String(row.id),
      centerId: row.center_id == null ? null : String(row.center_id),
      centerName: row.center_name || null,
      centerCode: row.center_code || null,
      userId: String(row.user_id),
      subject: row.subject,
      message: row.message,
      status: row.status,
      handledBy: row.handled_by == null ? null : String(row.handled_by),
      handledAt: row.handled_at,
      userFeedbackStatus: row.user_feedback_status || null,
      userFeedbackMessage: row.user_feedback_message || null,
      userFeedbackAt: row.user_feedback_at || null,
      createdAt: row.created_at,
      updates: row.updates || []
    }))
  );
}

async function createSuggestionInternal(req, res, centerIdInput) {
  if (isEtablissementRole(req.user.role)) {
    return res.status(403).json({
      message: "Un chef d'etablissement ne peut pas soumettre d'observation depuis son compte"
    });
  }

  const centerId = Number(centerIdInput);
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }
  if (!message) {
    return res.status(400).json({ message: "message est obligatoire" });
  }

  const center = await pool.query("SELECT id FROM health_centers WHERE id = $1 LIMIT 1", [centerId]);
  if (center.rowCount === 0) {
    return res.status(404).json({ message: "Centre introuvable" });
  }

  const inserted = await pool.query(
    `
      INSERT INTO center_suggestions (center_id, user_id, message)
      VALUES ($1, $2, $3)
      RETURNING id, center_id, user_id, message, is_read, read_at, created_at;
    `,
    [centerId, Number(req.user.id), message]
  );

  const row = inserted.rows[0];
  return res.status(201).json({
    id: String(row.id),
    centerId: String(row.center_id),
    userId: String(row.user_id),
    message: row.message,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at
  });
}

export async function createSuggestion(req, res) {
  return createSuggestionInternal(req, res, req.params.id);
}

export async function getCenterSuggestions(req, res) {
  if (!hasRequestRole(req, COMPLAINT_VIEW_ROLES)) {
    return res.status(403).json({ message: "Acces refuse" });
  }
  const centerId = Number(req.params.id);
  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "ID de centre invalide" });
  }

  const scope = await getRequesterScope(req);
  const access = await canViewCenterByScope(scope, centerId, { onlyApprovedForEstablishment: true });
  if (!access.exists) {
    return res.status(404).json({ message: "Centre introuvable" });
  }
  if (!access.allowed) {
    return res.status(403).json({ message: "Acces refuse a ce centre" });
  }

  const suggestions = await pool.query(
    `
      SELECT
        s.id, s.center_id, s.user_id, s.message, s.is_read, s.read_at, s.created_at,
        u.full_name AS user_full_name
      FROM center_suggestions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.center_id = $1
      ORDER BY s.created_at DESC;
    `,
    [centerId]
  );

  return res.json(
    suggestions.rows.map((row) => ({
      id: String(row.id),
      centerId: String(row.center_id),
      userId: String(row.user_id),
      userFullName: row.user_full_name,
      message: row.message,
      isRead: row.is_read,
      readAt: row.read_at,
      createdAt: row.created_at
    }))
  );
}

export async function getAllSuggestions(req, res) {
  if (!hasRequestRole(req, COMPLAINT_VIEW_ROLES)) {
    return res.status(403).json({ message: "Acces refuse" });
  }
  const scope = await getRequesterScope(req);
  const whereParts = [];
  const params = [];
  applyCenterScope(whereParts, params, scope, "hc", { onlyApprovedForEstablishment: true });
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        s.id, s.center_id, s.user_id, s.message, s.is_read, s.read_at, s.created_at,
        u.full_name AS user_full_name,
        hc.name AS center_name,
        hc.establishment_code AS center_code
      FROM center_suggestions s
      INNER JOIN health_centers hc ON hc.id = s.center_id
      INNER JOIN users u ON u.id = s.user_id
      ${whereClause}
      ORDER BY s.created_at DESC;
    `,
    params
  );

  return res.json(
    result.rows.map((row) => ({
      id: String(row.id),
      centerId: String(row.center_id),
      centerName: row.center_name || null,
      centerCode: row.center_code || null,
      userId: String(row.user_id),
      userFullName: row.user_full_name,
      message: row.message,
      isRead: row.is_read,
      readAt: row.read_at,
      createdAt: row.created_at
    }))
  );
}

export async function getMySuggestions(req, res) {
  const result = await pool.query(
    `
      SELECT
        s.id, s.center_id, s.message, s.is_read, s.read_at, s.created_at,
        hc.name AS center_name,
        hc.establishment_code AS center_code
      FROM center_suggestions s
      LEFT JOIN health_centers hc ON hc.id = s.center_id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC;
    `,
    [Number(req.user.id)]
  );

  return res.json(
    result.rows.map((row) => ({
      id: String(row.id),
      centerId: row.center_id == null ? null : String(row.center_id),
      centerName: row.center_name || null,
      centerCode: row.center_code || null,
      message: row.message,
      isRead: row.is_read,
      readAt: row.read_at,
      createdAt: row.created_at
    }))
  );
}

export async function getSuggestionsSummary(req, res) {
  if (!hasRequestRole(req, COMPLAINT_VIEW_ROLES)) {
    return res.status(403).json({ message: "Acces refuse" });
  }
  const scope = await getRequesterScope(req);
  const whereParts = [];
  const params = [];
  applyCenterScope(whereParts, params, scope, "hc", { onlyApprovedForEstablishment: true });
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE s.is_read = FALSE)::int AS unread_count
      FROM center_suggestions s
      INNER JOIN health_centers hc ON hc.id = s.center_id
      ${whereClause};
    `,
    params
  );

  const row = result.rows[0] || {};
  return res.json({
    total: Number(row.total || 0),
    unreadCount: Number(row.unread_count || 0)
  });
}

export async function markSuggestionRead(req, res) {
  const suggestionId = Number(req.params.id);
  if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
    return res.status(400).json({ message: "ID d'observation invalide" });
  }

  const found = await pool.query(
    `SELECT id, center_id FROM center_suggestions WHERE id = $1 LIMIT 1`,
    [suggestionId]
  );
  if (found.rowCount === 0) {
    return res.status(404).json({ message: "Observation introuvable" });
  }

  const scope = await getRequesterScope(req);
  const access = await canViewCenterByScope(scope, Number(found.rows[0].center_id));
  if (!access.allowed) {
    return res.status(403).json({ message: "Acces refuse a cette observation" });
  }

  const updated = await pool.query(
    `
      UPDATE center_suggestions
      SET is_read = TRUE, read_at = NOW()
      WHERE id = $1
      RETURNING id, center_id, user_id, message, is_read, read_at, created_at;
    `,
    [suggestionId]
  );

  const row = updated.rows[0];
  return res.json({
    id: String(row.id),
    centerId: String(row.center_id),
    userId: String(row.user_id),
    message: row.message,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at
  });
}

