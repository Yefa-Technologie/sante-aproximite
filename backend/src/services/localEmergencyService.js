import { pool } from "../config/db.js";
import { sendPushNotificationToUser } from "./notificationService.js";

export const LOCAL_EMERGENCY_RADIUS_KM = 20;
export function cityKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 100);
}
export function validPosition(body) {
  return typeof body?.latitude === "number" && typeof body?.longitude === "number" && Number.isFinite(body.latitude) && Number.isFinite(body.longitude) && Math.abs(body.latitude) <= 90 && Math.abs(body.longitude) <= 180 && (body.latitude !== 0 || body.longitude !== 0);
}

const distanceSql = (a, b) => `6371 * acos(LEAST(1.0, GREATEST(-1.0,
  sin(radians(${a}.latitude)) * sin(radians(${b}.latitude)) +
  cos(radians(${a}.latitude)) * cos(radians(${b}.latitude)) * cos(radians(${a}.longitude - ${b}.longitude)))))`;
export const localEmergencyMatchSql = `((${distanceSql("ul", "er")} <= ${LOCAL_EMERGENCY_RADIUS_KM}) OR (ul.city_key <> '' AND ul.city_key = er.city_key))`;
const matchSql = localEmergencyMatchSql;

export async function saveEmergencyLocation(req, res) {
  if (!validPosition(req.body)) return res.status(400).json({ message: "Position GPS invalide." });
  const city = String(req.body.city || "").trim().slice(0, 100);
  try {
    await pool.query(`INSERT INTO emergency_user_locations (user_id, latitude, longitude, city, city_key, updated_at)
      VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (user_id) DO UPDATE SET latitude=EXCLUDED.latitude,
      longitude=EXCLUDED.longitude,city=EXCLUDED.city,city_key=EXCLUDED.city_key,updated_at=NOW()`,
    [Number(req.user.id), req.body.latitude, req.body.longitude, city, cityKey(city)]);
    res.json({ enabled: true, radiusKm: LOCAL_EMERGENCY_RADIUS_KM });
  } catch { res.status(503).json({ message: "Impossible d’actualiser la localisation des alertes." }); }
}

export async function removeEmergencyLocation(req, res) {
  try {
    await pool.query("DELETE FROM emergency_user_locations WHERE user_id=$1", [Number(req.user.id)]);
    res.json({ enabled: false });
  } catch { res.status(503).json({ message: "Impossible de désactiver les alertes locales." }); }
}

export async function getLocalEmergencyAlerts(req, res) {
  res.set("Cache-Control", "no-store");
  try {
    const location = await pool.query("SELECT city FROM emergency_user_locations WHERE user_id=$1 AND updated_at > NOW() - INTERVAL '24 hours'", [Number(req.user.id)]);
    if (!location.rows.length) return res.json({ alerts: [], needsLocation: true, radiusKm: LOCAL_EMERGENCY_RADIUS_KM });
    // Return only the public alert, never patient identity, phone, text, photos or GPS.
    const result = await pool.query(`SELECT er.id, er.city, er.status, er.created_at,
      ${distanceSql("ul", "er")} AS distance_km, (ul.city_key <> '' AND ul.city_key = er.city_key) AS same_city
      FROM emergency_reports er JOIN emergency_user_locations ul ON ul.user_id=$1
      WHERE ul.updated_at > NOW() - INTERVAL '24 hours' AND er.user_id <> $1
      AND er.target_service IN ('SAMU','SAPEUR_POMPIER')
      AND er.created_at > NOW() - INTERVAL '24 hours'
      AND er.status IN ('NEW','ACKNOWLEDGED','EN_ROUTE','ON_SITE') AND ${matchSql}
      ORDER BY er.created_at DESC LIMIT 100`, [Number(req.user.id)]);
    res.json({ needsLocation: false, radiusKm: LOCAL_EMERGENCY_RADIUS_KM, city: location.rows[0].city,
      alerts: result.rows.map((r) => ({ id: String(r.id), city: r.city || null, status: r.status, createdAt: r.created_at,
        distanceKm: Math.round(Number(r.distance_km)), sameCity: r.same_city === true })) });
  } catch { res.status(503).json({ message: "Les alertes locales sont temporairement indisponibles." }); }
}

export async function notifyLocalEmergency(report, { query = (...args) => pool.query(...args), send = sendPushNotificationToUser } = {}) {
  const recipients = await query(`SELECT ul.user_id FROM emergency_user_locations ul
    JOIN users u ON u.id=ul.user_id AND u.is_active IS DISTINCT FROM false
    JOIN emergency_reports er ON er.id=$1
    WHERE ul.user_id <> er.user_id AND ul.updated_at > NOW() - INTERVAL '24 hours'
    AND er.target_service IN ('SAMU','SAPEUR_POMPIER') AND ${matchSql}`, [report.id]);
  // Keep fan-out bounded; notification failure never rejects the emergency report.
  for (let i = 0; i < recipients.rows.length; i += 10) {
    await Promise.allSettled(recipients.rows.slice(i, i + 10).map((r) => send(r.user_id, {
      title: "Urgence sanitaire à proximité",
      body: "Une urgence sanitaire a été signalée dans votre ville ou à proximité. Consultez les alertes locales dans l’application.",
      data: { type: "LOCAL_EMERGENCY_ALERT", reportId: String(report.id) },
    })));
  }
}
