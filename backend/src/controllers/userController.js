import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";

const ALLOWED_ADMIN_ROLES = new Set([
  "USER",
  "REGULATOR",
  "NATIONAL",
  "REGION",
  "DISTRICT",
  "ETABLISSEMENT",
  "SAPEUR_POMPIER",
  "SAMU",
  "POLICE",
  "GENDARMERIE",
  "PROTECTION_CIVILE"
]);
const SPECIAL_PERMISSIONS = new Set(["MANAGE_PUBLIC_USERS"]);
const PRIMARY_ROLES = [...ALLOWED_ADMIN_ROLES];

function normalizePermission(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SPECIAL_PERMISSIONS.has(normalized) ? normalized : "";
}

function normalizeRole(role) {
  const normalized = typeof role === "string" ? role.trim().toUpperCase() : "";
  if (!normalized) return "USER";
  if (normalized === "CHEF_ETABLISSEMENT") return "ETABLISSEMENT";
  if (normalized === "SAPEUR_POMPIER") return "SAPEUR_POMPIER";
  return ALLOWED_ADMIN_ROLES.has(normalized) ? normalized : "USER";
}

function normalizeRolesInput(rawRoles, fallbackRole = "USER") {
  const list = Array.isArray(rawRoles) ? rawRoles : [fallbackRole];
  const normalizedPrimaryRoles = [];
  const normalizedPermissions = [];

  for (const entry of list) {
    const permission = normalizePermission(entry);
    if (permission) {
      normalizedPermissions.push(permission);
      continue;
    }
    normalizedPrimaryRoles.push(normalizeRole(entry));
  }

  if (!normalizedPrimaryRoles.length) {
    normalizedPrimaryRoles.push(normalizeRole(fallbackRole));
  }

  return [...new Set([...normalizedPrimaryRoles, ...normalizedPermissions].filter(Boolean))];
}

function extractPrimaryRole(roles, fallbackRole = "USER") {
  const normalizedRoles = Array.isArray(roles) ? roles : [];
  return normalizedRoles.find((entry) => PRIMARY_ROLES.includes(entry)) || normalizeRole(fallbackRole);
}

function hasManagePublicUsersPermission(userLike) {
  const roles = Array.isArray(userLike?.roles) ? userLike.roles : [userLike?.role];
  return roles.some((entry) => normalizePermission(entry) === "MANAGE_PUBLIC_USERS");
}

function mapUser(row) {
  const roles =
    Array.isArray(row.roles) && row.roles.length
      ? row.roles
      : [row.role].filter(Boolean);
  return {
    id: String(row.id),
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    roles,
    isActive: row.is_active !== false,
    establishmentCode: row.establishment_code,
    regionCode: row.region_code || null,
    districtCode: row.district_code || null,
    centerId: row.center_id == null ? null : String(row.center_id),
    centerName: row.center_name || null,
    approvalStatus: row.approval_status,
    createdAt: row.created_at
  };
}

function normalizeGeoCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function normalizeCenterId(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

async function resolveUserAssignment(input, queryable = pool) {
  const payload = input || {};
  let establishmentCode =
    typeof payload.establishmentCode === "string" && payload.establishmentCode.trim()
      ? payload.establishmentCode.trim().toUpperCase()
      : null;
  let regionCode = normalizeGeoCode(payload.regionCode);
  let districtCode = normalizeGeoCode(payload.districtCode);
  const centerId = normalizeCenterId(payload.centerId);

  let regionFromDistrict = null;
  if (districtCode) {
    const districtResult = await queryable.query(
      "SELECT code, region_code FROM districts WHERE code = $1 LIMIT 1",
      [districtCode]
    );
    if (districtResult.rowCount === 0) {
      const error = new Error(`District introuvable: ${districtCode}`);
      error.status = 400;
      throw error;
    }
    regionFromDistrict = String(districtResult.rows[0].region_code || "").toUpperCase();
    if (regionCode && regionCode !== regionFromDistrict) {
      const error = new Error(`Le district ${districtCode} n'appartient pas a la region ${regionCode}`);
      error.status = 400;
      throw error;
    }
    regionCode = regionCode || regionFromDistrict;
  }

  if (regionCode) {
    const regionResult = await queryable.query("SELECT code FROM regions WHERE code = $1 LIMIT 1", [regionCode]);
    if (regionResult.rowCount === 0) {
      const error = new Error(`Region introuvable: ${regionCode}`);
      error.status = 400;
      throw error;
    }
  }

  let centerRow = null;
  if (centerId) {
    const centerResult = await queryable.query(
      `
        SELECT id, name, establishment_code, region_code, district_code
        FROM health_centers
        WHERE id = $1
        LIMIT 1;
      `,
      [centerId]
    );
    if (centerResult.rowCount === 0) {
      const error = new Error(`Centre introuvable: ${centerId}`);
      error.status = 400;
      throw error;
    }
    centerRow = centerResult.rows[0];
    const centerRegion = normalizeGeoCode(centerRow.region_code);
    const centerDistrict = normalizeGeoCode(centerRow.district_code);
    const centerCode =
      typeof centerRow.establishment_code === "string" && centerRow.establishment_code.trim()
        ? centerRow.establishment_code.trim().toUpperCase()
        : null;

    if (regionCode && centerRegion && regionCode !== centerRegion) {
      const error = new Error(
        `Le centre ${centerId} n'appartient pas a la region ${regionCode}`
      );
      error.status = 400;
      throw error;
    }
    if (districtCode && centerDistrict && districtCode !== centerDistrict) {
      const error = new Error(
        `Le centre ${centerId} n'appartient pas au district ${districtCode}`
      );
      error.status = 400;
      throw error;
    }

    regionCode = regionCode || centerRegion || null;
    districtCode = districtCode || centerDistrict || null;
    establishmentCode = establishmentCode || centerCode || null;
  }

  return {
    establishmentCode,
    regionCode,
    districtCode,
    centerId,
    centerName: centerRow?.name || null
  };
}

async function saveUserRoles(client, userId, roles) {
  await client.query("DELETE FROM user_roles WHERE user_id = $1", [Number(userId)]);
  for (const role of roles) {
    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING`,
      [Number(userId), role]
    );
  }
}

export async function listUsers(req, res) {
  const requesterRoles = Array.isArray(req.user?.roles)
    ? req.user.roles.map((r) => String(r || "").toUpperCase())
    : [String(req.user?.role || "").toUpperCase()];
  const canManagePublicUsers = hasManagePublicUsersPermission(req.user);

  // Priorité de rôle la plus haute du requérant
  const ROLE_PRIORITY = [
    "DEVELOPER", "NATIONAL", "REGULATOR", "REGION", "DISTRICT",
    "ETABLISSEMENT", "CHEF_ETABLISSEMENT", "SAMU", "SAPEUR_POMPIER"
  ];
  const effectiveRole =
    ROLE_PRIORITY.find((r) => requesterRoles.includes(r)) ||
    requesterRoles[0] || "USER";

  const ADMIN_SCOPED_ROLES = [
    "NATIONAL","REGULATOR","REGION","DISTRICT",
    "ETABLISSEMENT","CHEF_ETABLISSEMENT",
    "SAPEUR_POMPIER","SAMU","POLICE","GENDARMERIE","PROTECTION_CIVILE"
  ];

  const whereParts = [];
  const params = [];

  // Rôles que NATIONAL peut gérer : uniquement les comptes du système de santé
  // (pas SAMU opérationnel, pas Police, Gendarmerie - chaînes de commandement distinctes)
  const NATIONAL_HEALTH_ROLES = [
    "NATIONAL","REGULATOR","REGION","DISTRICT","ETABLISSEMENT","CHEF_ETABLISSEMENT","USER"
  ];

  if (effectiveRole === "DEVELOPER") {
    // DEVELOPER voit tous les comptes sans restriction de périmètre
  } else if (effectiveRole === "NATIONAL") {
    // NATIONAL voit uniquement les comptes du système de santé
    whereParts.push(`u.role = ANY($${params.length + 1}::text[])`);
    params.push(NATIONAL_HEALTH_ROLES);
  } else if (effectiveRole === "REGULATOR") {
    // Voit tous les comptes admin (exclut les USER publics)
    if (canManagePublicUsers) {
      whereParts.push(`(u.role = ANY($${params.length + 1}::text[]) OR u.role = 'USER')`);
    } else {
      whereParts.push(`u.role = ANY($${params.length + 1}::text[])`);
    }
    params.push(ADMIN_SCOPED_ROLES);
  } else if (effectiveRole === "REGION") {
    const regionCode = req.user?.regionCode || null;
    if (!regionCode && !canManagePublicUsers) return res.json([]);
    const regionScopedParts = [];
    if (regionCode) {
      regionScopedParts.push(`(upper(u.region_code) = $${params.length + 1} AND u.role = ANY($${params.length + 2}::text[]))`);
      params.push(regionCode, ADMIN_SCOPED_ROLES);
    }
    if (canManagePublicUsers) {
      regionScopedParts.push(`u.role = 'USER'`);
    }
    whereParts.push(`(${regionScopedParts.join(" OR ")})`);
  } else if (effectiveRole === "DISTRICT") {
    const districtCode = req.user?.districtCode || null;
    if (!districtCode && !canManagePublicUsers) return res.json([]);
    const districtScopedParts = [];
    if (districtCode) {
      districtScopedParts.push(`(upper(u.district_code) = $${params.length + 1} AND u.role = ANY($${params.length + 2}::text[]))`);
      params.push(districtCode, ADMIN_SCOPED_ROLES);
    }
    if (canManagePublicUsers) {
      districtScopedParts.push(`u.role = 'USER'`);
    }
    whereParts.push(`(${districtScopedParts.join(" OR ")})`);
  } else if (effectiveRole === "ETABLISSEMENT" || effectiveRole === "CHEF_ETABLISSEMENT") {
    // Voit les comptes admin liés à son centre ou son code établissement
    const centerId = req.user?.centerId || null;
    const estCode = req.user?.establishmentCode || null;
    if (!centerId && !estCode && !canManagePublicUsers) return res.json([]);
    const orParts = [];
    if (centerId) {
      orParts.push(`u.center_id = $${params.length + 1}`);
      params.push(Number(centerId));
    }
    if (estCode) {
      orParts.push(`upper(u.establishment_code) = $${params.length + 1}`);
      params.push(estCode);
    }
    const etablissementScopedParts = [];
    if (orParts.length) {
      etablissementScopedParts.push(`((${orParts.join(" OR ")}) AND u.role = ANY($${params.length + 1}::text[]))`);
      params.push(ADMIN_SCOPED_ROLES);
    }
    if (canManagePublicUsers) {
      etablissementScopedParts.push(`u.role = 'USER'`);
    }
    whereParts.push(`(${etablissementScopedParts.join(" OR ")})`);
  } else if (effectiveRole === "SAMU" || effectiveRole === "SAPEUR_POMPIER") {
    // Voit les comptes de son propre service dans sa région
    const regionCode = req.user?.regionCode || null;
    const emergencyScopedParts = [];
    let emergencyClause = `u.role = $${params.length + 1}`;
    params.push(effectiveRole);
    if (regionCode) {
      emergencyClause += ` AND upper(u.region_code) = $${params.length + 1}`;
      params.push(regionCode);
    }
    emergencyScopedParts.push(`(${emergencyClause})`);
    if (canManagePublicUsers) {
      emergencyScopedParts.push(`u.role = 'USER'`);
    }
    whereParts.push(`(${emergencyScopedParts.join(" OR ")})`);
  } else {
    return res.json([]);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        u.id, u.full_name, u.email, u.role, u.is_active, u.created_at,
        u.establishment_code, u.region_code, u.district_code, u.center_id, u.approval_status,
        hc.name AS center_name,
        COALESCE(
          (
            SELECT array_agg(ur.role ORDER BY ur.role)
            FROM user_roles ur
            WHERE ur.user_id = u.id
          ),
          ARRAY[u.role]
        ) AS roles
      FROM users u
      LEFT JOIN health_centers hc ON hc.id = u.center_id
      ${whereClause}
      ORDER BY u.created_at DESC;
    `,
    params
  );

  return res.json(result.rows.map(mapUser));
}

// Rôles qu'un niveau peut créer (hiérarchie descendante uniquement)
const CREATABLE_ROLES_BY_LEVEL = {
  DEVELOPER:         null,
  // NATIONAL gère uniquement le système de santé - pas les services d'urgence/sécurité
  NATIONAL:          ["NATIONAL","REGULATOR","REGION","DISTRICT","ETABLISSEMENT","CHEF_ETABLISSEMENT","USER"],
  REGULATOR:         ["REGULATOR","REGION","DISTRICT","ETABLISSEMENT","CHEF_ETABLISSEMENT","SAMU","SAPEUR_POMPIER","USER"],
  REGION:            ["DISTRICT","ETABLISSEMENT","CHEF_ETABLISSEMENT","SAMU","SAPEUR_POMPIER"],
  DISTRICT:          ["ETABLISSEMENT","CHEF_ETABLISSEMENT","SAMU","SAPEUR_POMPIER"],
  ETABLISSEMENT:     ["ETABLISSEMENT","CHEF_ETABLISSEMENT"],
  CHEF_ETABLISSEMENT:["ETABLISSEMENT","CHEF_ETABLISSEMENT"],
  SAMU:              ["SAMU"],
  SAPEUR_POMPIER:    ["SAPEUR_POMPIER"],
};

export async function createUser(req, res) {
  const { fullName, email, password, role, roles } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: "fullName, email et password sont obligatoires" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await pool.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [normalizedEmail]);
  if (existing.rowCount > 0) {
    return res.status(409).json({ message: "Email deja utilise" });
  }

  const normalizedRoles = normalizeRolesInput(roles, role);
  const primaryRole = extractPrimaryRole(normalizedRoles, role);

  // Vérifier que le créateur a le droit de créer ce niveau de rôle
  const creatorRoles = Array.isArray(req.user?.roles)
    ? req.user.roles.map((r) => String(r || "").toUpperCase())
    : [String(req.user?.role || "").toUpperCase()];
  const ROLE_PRIORITY = ["DEVELOPER","NATIONAL","REGULATOR","REGION","DISTRICT","ETABLISSEMENT","CHEF_ETABLISSEMENT","SAMU","SAPEUR_POMPIER"];
  const creatorLevel = ROLE_PRIORITY.find((r) => creatorRoles.includes(r)) || creatorRoles[0];
  const allowedToCreate = CREATABLE_ROLES_BY_LEVEL[creatorLevel];
  if (allowedToCreate !== null && allowedToCreate !== undefined) {
    const forbidden = normalizedRoles.find(
      (r) => PRIMARY_ROLES.includes(r) && !allowedToCreate.includes(r)
    );
    if (forbidden) {
      return res.status(403).json({ message: `Vous n'avez pas le droit de créer un compte de type ${forbidden}` });
    }
  }
  if (normalizedRoles.includes("DEVELOPER") && creatorLevel !== "DEVELOPER") {
    return res.status(403).json({ message: "Seul un compte Developer peut attribuer le rôle Developer." });
  }
  if (normalizedRoles.includes("USER") && !["NATIONAL", "DEVELOPER"].includes(creatorLevel) && !hasManagePublicUsersPermission(req.user)) {
    return res.status(403).json({
      message: "Vous devez disposer du droit de gestion des utilisateurs publics pour creer un compte USER."
    });
  }

  let assignment;
  try {
    assignment = await resolveUserAssignment(req.body);
  } catch (error) {
    return res.status(Number(error?.status || 400)).json({ message: error.message || "Affectation invalide" });
  }

  if (normalizedRoles.includes("REGION") && !assignment.regionCode) {
    return res.status(400).json({ message: "regionCode est obligatoire pour le role REGION" });
  }
  if (normalizedRoles.includes("DISTRICT") && !assignment.districtCode) {
    return res.status(400).json({ message: "districtCode est obligatoire pour le role DISTRICT" });
  }
  if (normalizedRoles.includes("ETABLISSEMENT") && !assignment.centerId && !assignment.establishmentCode) {
    return res.status(400).json({
      message: "centerId ou establishmentCode est obligatoire pour le role ETABLISSEMENT"
    });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const approvalStatus = "APPROVED";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `
        INSERT INTO users (
          full_name,
          email,
          password_hash,
          role,
          establishment_code,
          region_code,
          district_code,
          center_id,
          approval_status,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        RETURNING id, full_name, email, role, establishment_code, region_code, district_code, center_id, approval_status, is_active, created_at;
      `,
      [
        fullName.trim(),
        normalizedEmail,
        passwordHash,
        primaryRole,
        assignment.establishmentCode,
        assignment.regionCode,
        assignment.districtCode,
        assignment.centerId,
        approvalStatus
      ]
    );
    const user = created.rows[0];
    await saveUserRoles(client, user.id, normalizedRoles);
    await client.query("COMMIT");
    user.roles = normalizedRoles;
    user.center_name = assignment.centerName;
    return res.status(201).json(mapUser(user));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUser(req, res) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "ID utilisateur invalide" });
  }

  const {
    fullName,
    email,
    password,
    role,
    roles,
    establishmentCode,
    isActive
  } = req.body || {};

  const currentResult = await pool.query(
    `
      SELECT id, full_name, email, role, establishment_code, region_code, district_code, center_id, is_active, approval_status, created_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [userId]
  );
  if (currentResult.rowCount === 0) {
    return res.status(404).json({ message: "Utilisateur introuvable" });
  }

  const current = currentResult.rows[0];

  // Récupérer les rôles actuels de la cible
  const currentRolesResult = await pool.query(
    "SELECT role FROM user_roles WHERE user_id = $1",
    [userId]
  );
  const currentTargetRoles = currentRolesResult.rows.map((r) => r.role);
  const targetIsDeveloper = currentTargetRoles.includes("DEVELOPER") || String(current.role || "").toUpperCase() === "DEVELOPER";

  // Un compte Developer est intouchable - aucun compte ne peut modifier ses rôles
  if (targetIsDeveloper) {
    return res.status(403).json({ message: "Les rôles d'un compte Developer sont verrouillés et ne peuvent pas être modifiés." });
  }

  const normalizedRoles = normalizeRolesInput(roles, role || current.role);
  const primaryRole = extractPrimaryRole(normalizedRoles, role || current.role);
  const requesterRole = String(req.user?.role || "").toUpperCase();
  if (normalizedRoles.includes("DEVELOPER") && requesterRole !== "DEVELOPER") {
    return res.status(403).json({ message: "Seul un compte Developer peut attribuer le rôle Developer." });
  }
  if (
    normalizedRoles.includes("USER") &&
    !hasManagePublicUsersPermission(req.user) &&
    !["DEVELOPER", "NATIONAL"].includes(requesterRole)
  ) {
    return res.status(403).json({
      message: "Vous devez disposer du droit de gestion des utilisateurs publics pour creer ou modifier un compte USER."
    });
  }
  const nextFullName = typeof fullName === "string" && fullName.trim() ? fullName.trim() : current.full_name;
  const nextEmail = typeof email === "string" && email.trim() ? email.toLowerCase().trim() : current.email;
  const nextEstablishmentCode = hasOwn(req.body, "establishmentCode")
    ? (typeof establishmentCode === "string" && establishmentCode.trim()
      ? establishmentCode.trim().toUpperCase()
      : null)
    : current.establishment_code;
  const nextRegionCode = hasOwn(req.body, "regionCode")
    ? normalizeGeoCode(req.body.regionCode)
    : normalizeGeoCode(current.region_code);
  const nextDistrictCode = hasOwn(req.body, "districtCode")
    ? normalizeGeoCode(req.body.districtCode)
    : normalizeGeoCode(current.district_code);
  const nextCenterId = hasOwn(req.body, "centerId")
    ? normalizeCenterId(req.body.centerId)
    : normalizeCenterId(current.center_id);
  const nextIsActive = typeof isActive === "boolean" ? isActive : current.is_active !== false;

  let assignment;
  try {
    assignment = await resolveUserAssignment({
      establishmentCode: nextEstablishmentCode,
      regionCode: nextRegionCode,
      districtCode: nextDistrictCode,
      centerId: nextCenterId
    });
  } catch (error) {
    return res.status(Number(error?.status || 400)).json({ message: error.message || "Affectation invalide" });
  }

  if (normalizedRoles.includes("REGION") && !assignment.regionCode) {
    return res.status(400).json({ message: "regionCode est obligatoire pour le role REGION" });
  }
  if (normalizedRoles.includes("DISTRICT") && !assignment.districtCode) {
    return res.status(400).json({ message: "districtCode est obligatoire pour le role DISTRICT" });
  }
  if (normalizedRoles.includes("ETABLISSEMENT") && !assignment.centerId && !assignment.establishmentCode) {
    return res.status(400).json({
      message: "centerId ou establishmentCode est obligatoire pour le role ETABLISSEMENT"
    });
  }
  if (String(req.user.id) === String(userId) && nextIsActive === false) {
    return res.status(400).json({ message: "Vous ne pouvez pas desactiver votre propre compte" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingEmail = await client.query(
      "SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1",
      [nextEmail, userId]
    );
    if (existingEmail.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Email deja utilise" });
    }

    const passwordHash =
      typeof password === "string" && password.trim()
        ? await bcrypt.hash(password.trim(), 10)
        : null;

    const updated = await client.query(
      `
        UPDATE users
        SET
          full_name = $2,
          email = $3,
          role = $4,
          establishment_code = $5,
          region_code = $6,
          district_code = $7,
          center_id = $8,
          is_active = $9,
          password_hash = COALESCE($10, password_hash),
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, full_name, email, role, establishment_code, region_code, district_code, center_id, approval_status, is_active, created_at;
      `,
      [
        userId,
        nextFullName,
        nextEmail,
        primaryRole,
        assignment.establishmentCode,
        assignment.regionCode,
        assignment.districtCode,
        assignment.centerId,
        nextIsActive,
        passwordHash
      ]
    );

    await saveUserRoles(client, userId, normalizedRoles);
    await client.query("COMMIT");
    const user = updated.rows[0];
    user.roles = normalizedRoles;
    user.center_name = assignment.centerName;
    return res.json(mapUser(user));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setUserActiveStatus(req, res) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "ID utilisateur invalide" });
  }
  const isActive = !!req.body?.isActive;
  if (String(req.user.id) === String(userId) && isActive === false) {
    return res.status(400).json({ message: "Vous ne pouvez pas desactiver votre propre compte" });
  }

  const updated = await pool.query(
    `
      UPDATE users
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, full_name, email, role, establishment_code, region_code, district_code, center_id, approval_status, is_active, created_at;
    `,
    [userId, isActive]
  );
  if (updated.rowCount === 0) {
    return res.status(404).json({ message: "Utilisateur introuvable" });
  }
  const user = updated.rows[0];
  const roles = await pool.query("SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role ASC", [userId]);
  user.roles = roles.rows.map((r) => r.role);
  return res.json(mapUser(user));
}

export async function deleteUser(req, res) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "ID utilisateur invalide" });
  }

  if (String(req.user.id) === String(userId)) {
    return res.status(400).json({ message: "Vous ne pouvez pas supprimer votre propre compte" });
  }

  const deleted = await pool.query(
    `
      DELETE FROM users
      WHERE id = $1
      RETURNING id;
    `,
    [userId]
  );

  if (deleted.rowCount === 0) {
    return res.status(404).json({ message: "Utilisateur introuvable" });
  }

  return res.status(204).send();
}

export async function listPendingChefs(req, res) {
  const result = await pool.query(
    `
      SELECT id, full_name, email, role, establishment_code, region_code, district_code, center_id, approval_status, is_active, created_at
      FROM users
      WHERE role = 'ETABLISSEMENT' AND approval_status = 'PENDING'
      ORDER BY created_at ASC;
    `
  );

  return res.json(result.rows.map(mapUser));
}

export async function reviewChef(req, res) {
  const userId = Number(req.params.id);
  const action = req.body?.action === "REJECT" ? "REJECT" : "APPROVE";
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "ID utilisateur invalide" });
  }

  const status = action === "APPROVE" ? "APPROVED" : "REJECTED";
  const updated = await pool.query(
    `
      UPDATE users
      SET approval_status = $2, updated_at = NOW()
      WHERE id = $1 AND role = 'ETABLISSEMENT'
      RETURNING id, full_name, email, role, establishment_code, region_code, district_code, center_id, approval_status, is_active, created_at;
    `,
    [userId, status]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ message: "Chef introuvable" });
  }

  const user = updated.rows[0];
  const roles = await pool.query("SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role ASC", [userId]);
  user.roles = roles.rows.map((r) => r.role);
  return res.json(mapUser(user));
}
