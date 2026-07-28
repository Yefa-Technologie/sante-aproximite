import { pool } from "../config/db.js";

export const MODULE_DEFINITIONS = [
  { key: "nearby", label: "Centres de sante" },
  { key: "referral", label: "Reference malade" },
  { key: "complaints", label: "Poser une plainte" },
  { key: "complaints_tracking", label: "Suivi des plaintes" },
  { key: "suggestions", label: "Observation/Suggestion" },
  { key: "chef", label: "Espace chef" },
  { key: "alerts", label: "Urgences sanitaires (reception)" },
  { key: "security_ops", label: "Urgences securitaires (reception)" },
  { key: "emergency", label: "Urgence sanitaire (envoi)" },
  { key: "security_alert", label: "Urgence securitaire (envoi)" },
  { key: "settings", label: "Parametres centres" },
  { key: "donation", label: "Faire un don" },
  { key: "contact_developer", label: "Contacter le developpeur" },
  { key: "project", label: "Projet de digitalisation" },
  { key: "clear_cache", label: "Vider le cache local" },
];

export const ROLE_DEFINITIONS = [
  { key: "USER", label: "Utilisateur public" },
  { key: "ETABLISSEMENT", label: "Etablissement / Chef" },
  { key: "SAMU", label: "SAMU" },
  { key: "SAPEUR_POMPIER", label: "Sapeurs-Pompiers" },
  { key: "POLICE", label: "Police" },
  { key: "GENDARMERIE", label: "Gendarmerie" },
  { key: "PROTECTION_CIVILE", label: "Protection civile" },
];

export const APP_DEFINITIONS = [
  { key: "mobile", label: "Mobile" },
  { key: "mobile-minima", label: "Mobile Minima" },
];

const MODULE_KEYS = new Set(MODULE_DEFINITIONS.map((m) => m.key));
const ROLE_KEYS = new Set(ROLE_DEFINITIONS.map((r) => r.key));
const APP_KEYS = new Set(APP_DEFINITIONS.map((a) => a.key));

function normalizeAppKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return APP_KEYS.has(key) ? key : "mobile";
}

export async function getModuleSettings(req, res) {
  const appKey = normalizeAppKey(req.query.appKey);
  const result = await pool.query(
    "SELECT module_key, role, enabled FROM module_role_settings WHERE app_key = $1",
    [appKey]
  );
  const matrix = {};
  for (const m of MODULE_DEFINITIONS) {
    matrix[m.key] = {};
    for (const r of ROLE_DEFINITIONS) matrix[m.key][r.key] = true;
  }
  for (const row of result.rows) {
    if (matrix[row.module_key] && row.role in matrix[row.module_key]) {
      matrix[row.module_key][row.role] = row.enabled;
    }
  }
  return res.json({ modules: MODULE_DEFINITIONS, roles: ROLE_DEFINITIONS, apps: APP_DEFINITIONS, appKey, matrix });
}

export async function updateModuleSetting(req, res) {
  const { moduleKey, role, enabled } = req.body || {};
  const appKey = normalizeAppKey(req.body?.appKey);
  if (!MODULE_KEYS.has(moduleKey)) {
    return res.status(400).json({ message: "Module inconnu" });
  }
  if (!ROLE_KEYS.has(role)) {
    return res.status(400).json({ message: "Role inconnu" });
  }
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "enabled doit etre un booleen" });
  }

  await pool.query(
    `
      INSERT INTO module_role_settings (module_key, role, app_key, enabled, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (module_key, role, app_key) DO UPDATE
      SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW();
    `,
    [moduleKey, role, appKey, enabled, Number(req.user.id)]
  );

  return res.json({ moduleKey, role, appKey, enabled });
}
