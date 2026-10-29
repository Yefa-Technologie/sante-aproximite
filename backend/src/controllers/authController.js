import bcrypt from "bcryptjs";
import crypto from "crypto";
import { signRefreshToken, signToken, verifyRefreshToken } from "../services/authService.js";
import { pool } from "../config/db.js";
import { getDefaultPermissions } from "../config/permissions.js";
import { getUserPermissions } from "./rbacController.js";

const SELF_REGISTER_ROLES = new Set([
  "USER",
  "REGULATOR",
  "NATIONAL",
  "REGION",
  "DISTRICT",
  "CHEF_ETABLISSEMENT",
  "ETABLISSEMENT",
  "SAPEUR_POMPIER",
  "SAMU",
  "POLICE",
  "GENDARMERIE",
  "PROTECTION_CIVILE",
  "DEVELOPER",
]);
const DEVELOPER_EMAILS = new Set(["skaragher@gmail.com"]);

function normalizeRole(role) {
  const normalized = typeof role === "string" ? role.trim().toUpperCase() : "";
  if (!normalized) return "USER";
  if (normalized === "CHEF_ETABLISSEMENT") return "ETABLISSEMENT";
  if (normalized === "SAPEUR_POMPIER") return "SAPEUR_POMPIER";
  if (SELF_REGISTER_ROLES.has(normalized)) return normalized;
  return "USER";
}

function normalizePhoneNumber(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 10);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isDeveloperEmail(email) {
  return DEVELOPER_EMAILS.has(normalizeEmail(email));
}

function applyDeveloperRoleOverride(userLike, roles = []) {
  const normalizedRoles = Array.isArray(roles)
    ? roles.map((role) => String(role || "").trim().toUpperCase()).filter(Boolean)
    : [];

  if (!isDeveloperEmail(userLike?.email)) {
    return {
      role: String(userLike?.role || "").trim().toUpperCase() || "USER",
      roles: normalizedRoles.length ? normalizedRoles : [String(userLike?.role || "").trim().toUpperCase()].filter(Boolean)
    };
  }

  return {
    role: "DEVELOPER",
    roles: [...new Set(["DEVELOPER", ...normalizedRoles])]
  };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toUserPayload(user) {
  const effective = applyDeveloperRoleOverride(user, user.roles);
  return {
    id: String(user.id),
    fullName: user.full_name,
    email: user.email,
    role: effective.role,
    roles: effective.roles,
    isActive: user.is_active !== false,
    phoneNumber: user.phone_number,
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
  };
}

async function loadUserRoles(userId, fallbackRole) {
  const result = await pool.query(
    `
      SELECT role
      FROM user_roles
      WHERE user_id = $1
      ORDER BY role ASC;
    `,
    [Number(userId)]
  );
  const roles = result.rows
    .map((row) => String(row.role || "").trim().toUpperCase())
    .filter(Boolean);
  if (roles.length) return roles;
  const fallback = String(fallbackRole || "").trim().toUpperCase();
  return fallback ? [fallback] : ["USER"];
}

async function createSessionTokens(user) {
  const persistedRoles = await loadUserRoles(user.id, user.role);
  const { role, roles } = applyDeveloperRoleOverride(user, persistedRoles);
  const customPerms = await getUserPermissions(user.id);
  const defaultPerms = getDefaultPermissions(roles);
  const permissions = [...new Set([...defaultPerms, ...customPerms])];

  const authPayload = {
    id: String(user.id),
    role,
    roles,
    isActive: user.is_active !== false,
    fullName: user.full_name,
    email: user.email,
    phoneNumber: user.phone_number,
  };
  const token = signToken(authPayload);
  const refreshToken = signRefreshToken({ id: String(user.id), type: "refresh" });
  const decoded = verifyRefreshToken(refreshToken);

  await pool.query(
    `
      INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, to_timestamp($3));
    `,
    [Number(user.id), hashToken(refreshToken), Number(decoded.exp)]
  );

  return { token, refreshToken, roles, permissions };
}

export async function register(req, res) {
  const { fullName, email, password, role, establishmentCode, phoneNumber } = req.body;
  if (String(role || "USER").trim().toUpperCase() !== "USER") {
    return res.status(403).json({ message: "Les comptes professionnels sont créés par l’administration depuis le web avec leur affectation." });
  }

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: "fullName, email et password sont obligatoires" });
  }

  const existingResult = await pool.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [
    email.toLowerCase().trim()
  ]);
  if (existingResult.rowCount > 0) {
    return res.status(409).json({ message: "Email deja utilise" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const nextRole = normalizeRole(role);
  const normalizedEstablishmentCode =
    typeof establishmentCode === "string" && establishmentCode.trim()
      ? establishmentCode.trim().toUpperCase()
      : null;
  const normalizedPhoneNumber =
    normalizePhoneNumber(phoneNumber) || null;

  if (nextRole === "ETABLISSEMENT" && !normalizedEstablishmentCode) {
    return res.status(400).json({
      message: "Le code de l'etablissement est obligatoire pour un chef d'etablissement"
    });
  }

  const approvalStatus = "APPROVED";
  const created = await pool.query(
    `
      INSERT INTO users (full_name, email, password_hash, role, establishment_code, approval_status, phone_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, full_name, email, role, establishment_code, approval_status, phone_number, is_active;
    `,
    [
      fullName.trim(),
      email.toLowerCase().trim(),
      passwordHash,
      nextRole,
      normalizedEstablishmentCode,
      approvalStatus,
      normalizedPhoneNumber
    ]
  );
  const user = created.rows[0];
  await pool.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING`,
    [Number(user.id), String(user.role)]
  );

  const { token, refreshToken, roles, permissions } = await createSessionTokens(user);

  return res.status(201).json({
    token,
    refreshToken,
    user: toUserPayload({ ...user, roles, permissions })
  });
}

export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "email et password sont obligatoires" });
  }

  const found = await pool.query(
    `
      SELECT id, full_name, email, password_hash, role
      , approval_status, phone_number, is_active
      FROM users
      WHERE email = $1
      LIMIT 1;
    `,
    [email.toLowerCase().trim()]
  );
  if (found.rowCount === 0) {
    return res.status(401).json({ message: "Identifiants invalides" });
  }
  const user = found.rows[0];
  if (user.is_active === false) {
    return res.status(403).json({ message: "Compte desactive" });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ message: "Identifiants invalides" });
  }

  const { token, refreshToken, roles, permissions } = await createSessionTokens(user);

  return res.json({
    token,
    refreshToken,
    user: toUserPayload({ ...user, roles, permissions })
  });
}

export async function mobileUserSession(req, res) {
  const fullName = String(req.body?.fullName || "").trim();
  const phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);

  if (phoneNumber.length !== 10) {
    return res.status(400).json({ message: "Numero de telephone invalide (10 chiffres requis)." });
  }

  const existing = await pool.query(
    `
      SELECT id, full_name, email, role, phone_number, is_active
      FROM users
      WHERE regexp_replace(COALESCE(phone_number, ''), '[^0-9]', '', 'g') = $1
      ORDER BY id ASC
      LIMIT 1;
    `,
    [phoneNumber]
  );

  if (existing.rowCount > 0) {
    const user = existing.rows[0];
    if (user.is_active === false) {
      return res.status(403).json({ message: "Compte desactive" });
    }
    if (user.role !== "USER") {
      return res.status(403).json({
        message: "Ce numero est associe a un compte non utilisateur simple. Utilisez le parcours chef."
      });
    }

    const nextFullName = fullName.length >= 3 ? fullName : user.full_name;
    const updated = await pool.query(
      `
      UPDATE users
      SET full_name = $1, phone_number = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING id, full_name, email, role, phone_number;
    `,
      [nextFullName, phoneNumber, Number(user.id)]
    );

    const { token, refreshToken, roles } = await createSessionTokens(updated.rows[0]);
    return res.json({
      token,
      refreshToken,
      user: toUserPayload({ ...updated.rows[0], roles })
    });
  }

  if (fullName.length < 3) {
    return res.status(400).json({ message: "Le numéro renseigné n’est pas valide. Veuillez vérifier votre saisie ou procéder à la création d’un nouveau compte." });
  }

  const randomPasswordHash = await bcrypt.hash(crypto.randomUUID(), 10);
  let syntheticEmail = `mobile_${phoneNumber}@sante.local`;

  try {
    const created = await pool.query(
      `
        INSERT INTO users (full_name, email, password_hash, role, approval_status, phone_number)
        VALUES ($1, $2, $3, 'USER', 'APPROVED', $4)
        RETURNING id, full_name, email, role, phone_number, is_active;
      `,
      [fullName, syntheticEmail, randomPasswordHash, phoneNumber]
    );

    const user = created.rows[0];
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'USER') ON CONFLICT (user_id, role) DO NOTHING`,
      [Number(user.id)]
    );
    const { token, refreshToken, roles, permissions } = await createSessionTokens(user);
    return res.status(201).json({
      token,
      refreshToken,
      user: toUserPayload({ ...user, roles, permissions })
    });
  } catch (error) {
    if (error?.code !== "23505") throw error;
    syntheticEmail = `mobile_${phoneNumber}_${Date.now()}@sante.local`;
    const created = await pool.query(
      `
        INSERT INTO users (full_name, email, password_hash, role, approval_status, phone_number)
        VALUES ($1, $2, $3, 'USER', 'APPROVED', $4)
        RETURNING id, full_name, email, role, phone_number, is_active;
      `,
      [fullName, syntheticEmail, randomPasswordHash, phoneNumber]
    );

    const user = created.rows[0];
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'USER') ON CONFLICT (user_id, role) DO NOTHING`,
      [Number(user.id)]
    );
    const { token, refreshToken, roles, permissions } = await createSessionTokens(user);
    return res.status(201).json({
      token,
      refreshToken,
      user: toUserPayload({ ...user, roles, permissions })
    });
  }
}

export async function refresh(req, res) {
  const rawRefreshToken = String(req.body?.refreshToken || "").trim();
  if (!rawRefreshToken) {
    return res.status(400).json({ message: "refreshToken manquant" });
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(rawRefreshToken);
  } catch {
    return res.status(401).json({ message: "Refresh token invalide" });
  }

  if (decoded?.type !== "refresh") {
    return res.status(401).json({ message: "Refresh token invalide" });
  }

  const tokenHash = hashToken(rawRefreshToken);
  const foundToken = await pool.query(
    `
      SELECT id, user_id, expires_at, revoked_at
      FROM auth_refresh_tokens
      WHERE token_hash = $1
      LIMIT 1;
    `,
    [tokenHash]
  );

  if (foundToken.rowCount === 0) {
    return res.status(401).json({ message: "Refresh token invalide" });
  }

  const tokenRow = foundToken.rows[0];
  if (tokenRow.revoked_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return res.status(401).json({ message: "Refresh token expire" });
  }

  const foundUser = await pool.query(
    `
      SELECT id, full_name, email, role, phone_number, is_active
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [Number(tokenRow.user_id)]
  );

  if (foundUser.rowCount === 0) {
    return res.status(401).json({ message: "Utilisateur introuvable" });
  }

  await pool.query(
    `
      UPDATE auth_refresh_tokens
      SET revoked_at = NOW()
      WHERE id = $1;
    `,
    [Number(tokenRow.id)]
  );

  const user = foundUser.rows[0];
  if (user.is_active === false) {
    return res.status(403).json({ message: "Compte desactive" });
  }
  const { token, refreshToken, roles, permissions } = await createSessionTokens(user);

  return res.json({
    token,
    refreshToken,
    user: toUserPayload({ ...user, roles, permissions })
  });
}
