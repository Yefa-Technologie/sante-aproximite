import { pool } from "../config/db.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function registerPushToken(userId, token, appKey = "mobile") {
  await pool.query(
    `
      INSERT INTO push_tokens (user_id, token, app_key, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, token) DO UPDATE
      SET app_key = EXCLUDED.app_key, updated_at = NOW();
    `,
    [userId, token, appKey]
  );
}

export async function sendPushNotificationToUser(userId, { title, body, data } = {}) {
  const tokens = await pool.query(`SELECT token FROM push_tokens WHERE user_id = $1`, [userId]);
  if (tokens.rowCount === 0) return;

  const messages = tokens.rows.map((row) => ({
    to: row.token,
    sound: "default",
    title,
    body,
    data: data || {},
  }));

  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch {
    // best-effort: une notification manquee ne doit jamais faire echouer l'action metier
  }
}

export async function findUserIdByPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const result = await pool.query(
    `
      SELECT id FROM users
      WHERE regexp_replace(phone_number, '\\D', '', 'g') = $1
      LIMIT 1;
    `,
    [digits]
  );
  return result.rowCount > 0 ? Number(result.rows[0].id) : null;
}
