import { pool } from "../config/db.js";

const DEFAULT_SETTINGS = {
  centerReviewsEnabled: true
};

const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

export async function getAppSettings(req, res) {
  const result = await pool.query("SELECT key, value FROM app_settings");
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of result.rows) {
    if (ALLOWED_KEYS.has(row.key)) {
      settings[row.key] = row.value;
    }
  }
  return res.json(settings);
}

export async function updateAppSetting(req, res) {
  const key = String(req.params.key || "");
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ message: "Reglage inconnu" });
  }
  const value = req.body?.value;
  if (typeof value !== "boolean") {
    return res.status(400).json({ message: "value doit etre un booleen" });
  }

  await pool.query(
    `
      INSERT INTO app_settings (key, value, updated_by, updated_at)
      VALUES ($1, $2::jsonb, $3, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW();
    `,
    [key, JSON.stringify(value), Number(req.user.id)]
  );

  return res.json({ key, value });
}
