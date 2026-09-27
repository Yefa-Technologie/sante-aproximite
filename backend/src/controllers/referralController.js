import { pool } from "../config/db.js";
import { findUserIdByPhone, sendPushNotificationToUser } from "../services/notificationService.js";

function mapReferralRow(row) {
  return {
    id: String(row.id),
    originUserId: String(row.origin_user_id),
    originUserName: row.origin_user_name || null,
    destinationCenterId: String(row.destination_center_id),
    destinationCenterName: row.destination_center_name || null,
    patientPhone: row.patient_phone,
    patientName: row.patient_name,
    serviceName: row.service_name,
    reason: row.reason,
    status: row.status,
    receivedBy: row.received_by != null ? String(row.received_by) : null,
    receivedAt: row.received_at,
    rejectionReason: row.rejection_reason || null,
    createdAt: row.created_at,
    // Place occupee dans un service du centre d'accueil, jusqu'a sa liberation par le responsable.
    bedServiceName: row.bed_service_name || null,
    bedOccupiedAt: row.bed_occupied_at || null,
    bedReleasedAt: row.bed_released_at || null,
    bedOccupied: Boolean(row.bed_occupied_at) && !row.bed_released_at,
  };
}

async function getRequesterCenterIds(req) {
  const ids = new Set();
  const owned = await pool.query(
    `SELECT id FROM health_centers WHERE created_by = $1`,
    [req.user.id]
  );
  owned.rows.forEach((r) => ids.add(Number(r.id)));
  if (req.user.centerId != null) ids.add(Number(req.user.centerId));
  return [...ids];
}

export async function createReferral(req, res) {
  const destinationCenterId = Number(req.body?.destinationCenterId);
  if (!Number.isInteger(destinationCenterId) || destinationCenterId <= 0) {
    return res.status(400).json({ message: "Centre de destination invalide" });
  }

  const patientPhone = typeof req.body?.patientPhone === "string" ? req.body.patientPhone.trim() : "";
  if (!patientPhone) {
    return res.status(400).json({ message: "Numero de telephone du patient requis" });
  }

  const patientName = typeof req.body?.patientName === "string" && req.body.patientName.trim()
    ? req.body.patientName.trim()
    : null;
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
    ? req.body.reason.trim()
    : null;
  const serviceName = typeof req.body?.serviceName === "string" && req.body.serviceName.trim()
    ? req.body.serviceName.trim()
    : null;

  const center = await pool.query(
    `SELECT id FROM health_centers WHERE id = $1 AND approval_status = 'APPROVED' LIMIT 1`,
    [destinationCenterId]
  );
  if (center.rowCount === 0) {
    return res.status(404).json({ message: "Centre de destination introuvable" });
  }

  // Un centre ne peut pas s'orienter un patient a lui-meme.
  const ownCenter = await pool.query(
    `SELECT 1
     FROM health_centers hc
     JOIN users u ON u.id = $2
     WHERE hc.id = $1
       AND (hc.created_by = u.id
         OR hc.id = u.center_id
         OR (u.establishment_code IS NOT NULL AND upper(hc.establishment_code) = upper(u.establishment_code)))
     LIMIT 1`,
    [destinationCenterId, req.user.id]
  );
  if (ownCenter.rowCount > 0) {
    return res.status(400).json({ message: "Vous ne pouvez pas orienter un patient vers votre propre centre." });
  }

  const inserted = await pool.query(
    `INSERT INTO patient_referrals (origin_user_id, destination_center_id, patient_phone, patient_name, service_name, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, origin_user_id, destination_center_id, patient_phone, patient_name, service_name, reason, status, received_by, received_at, created_at`,
    [req.user.id, destinationCenterId, patientPhone, patientName, serviceName, reason]
  );

  const destinationCenterName = await pool.query(`SELECT name FROM health_centers WHERE id = $1 LIMIT 1`, [destinationCenterId]);
  const patientUserId = await findUserIdByPhone(patientPhone);
  if (patientUserId) {
    sendPushNotificationToUser(patientUserId, {
      title: "Vous avez ete oriente vers un centre de sante",
      body: `Rendez-vous a ${destinationCenterName.rows[0]?.name || "un centre de sante"} pour votre prise en charge.`,
      data: { type: "REFERRAL", referralId: String(inserted.rows[0].id) },
    }).catch(() => {});
  }

  return res.status(201).json(mapReferralRow(inserted.rows[0]));
}

export async function listIncomingReferrals(req, res) {
  const centerIds = await getRequesterCenterIds(req);
  if (centerIds.length === 0) {
    return res.json([]);
  }

  const result = await pool.query(
    `
      SELECT
        pr.id, pr.origin_user_id, pr.destination_center_id, pr.patient_phone,
        pr.patient_name, pr.service_name, pr.reason, pr.status, pr.received_by, pr.received_at, pr.rejection_reason, pr.created_at,
        pr.bed_service_name, pr.bed_occupied_at, pr.bed_released_at,
        u.full_name AS origin_user_name,
        hc.name AS destination_center_name
      FROM patient_referrals pr
      JOIN users u ON u.id = pr.origin_user_id
      JOIN health_centers hc ON hc.id = pr.destination_center_id
      WHERE pr.destination_center_id = ANY($1::bigint[])
      ORDER BY pr.created_at DESC;
    `,
    [centerIds]
  );

  return res.json(result.rows.map(mapReferralRow));
}

export async function listOutgoingReferrals(req, res) {
  const result = await pool.query(
    `
      SELECT
        pr.id, pr.origin_user_id, pr.destination_center_id, pr.patient_phone,
        pr.patient_name, pr.service_name, pr.reason, pr.status, pr.received_by, pr.received_at, pr.rejection_reason, pr.created_at,
        pr.bed_service_name, pr.bed_occupied_at, pr.bed_released_at,
        u.full_name AS origin_user_name,
        hc.name AS destination_center_name
      FROM patient_referrals pr
      JOIN users u ON u.id = pr.origin_user_id
      JOIN health_centers hc ON hc.id = pr.destination_center_id
      WHERE pr.origin_user_id = $1
      ORDER BY pr.created_at DESC;
    `,
    [req.user.id]
  );

  return res.json(result.rows.map(mapReferralRow));
}

async function loadReferralForDestination(req, referralId, { allowProcessed = false } = {}) {
  const referral = await pool.query(
    `
      SELECT pr.id, pr.destination_center_id, pr.status, pr.origin_user_id, pr.patient_name, pr.service_name,
             pr.bed_service_name, pr.bed_occupied_at, pr.bed_released_at, hc.name AS destination_center_name
      FROM patient_referrals pr
      JOIN health_centers hc ON hc.id = pr.destination_center_id
      WHERE pr.id = $1
      LIMIT 1;
    `,
    [referralId]
  );
  if (referral.rowCount === 0) {
    return { error: { status: 404, message: "Orientation introuvable" } };
  }

  const centerIds = await getRequesterCenterIds(req);
  if (!centerIds.includes(Number(referral.rows[0].destination_center_id))) {
    return { error: { status: 403, message: "Cette orientation ne concerne pas votre centre" } };
  }

  if (!allowProcessed && referral.rows[0].status !== "PENDING") {
    return { error: { status: 400, message: "Cette orientation a deja ete traitee" } };
  }

  return { row: referral.rows[0] };
}

export async function confirmReferralReception(req, res) {
  const referralId = Number(req.params.id);
  if (!Number.isInteger(referralId) || referralId <= 0) {
    return res.status(400).json({ message: "ID d'orientation invalide" });
  }

  const { row, error } = await loadReferralForDestination(req, referralId);
  if (error) {
    return res.status(error.status).json({ message: error.message });
  }

  // Service d'admission : celui de l'orientation, sinon celui choisi par le centre a la reception.
  const requestedService = String(row.service_name || req.body?.serviceName || "").trim();

  const client = await pool.connect();
  let bedServiceName = null;
  let bedWarning = null;
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE patient_referrals
       SET status = 'RECEIVED', received_by = $2, received_at = NOW()
       WHERE id = $1 AND status = 'PENDING'`,
      [referralId, req.user.id]
    );
    if (updated.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Cette orientation a deja ete traitee" });
    }

    if (requestedService) {
      const service = await client.query(
        `SELECT id, name, beds_available, is_active
         FROM health_center_services
         WHERE center_id = $1 AND lower(trim(name)) = lower($2)
         ORDER BY id
         LIMIT 1
         FOR UPDATE`,
        [row.destination_center_id, requestedService]
      );
      if (service.rowCount === 0) {
        bedWarning = `Le service "${requestedService}" n'existe pas dans votre centre : aucune place n'a ete decomptee.`;
      } else if (Number(service.rows[0].beds_available) <= 0) {
        bedWarning = `Aucune place libre en ${service.rows[0].name} : la place n'a pas ete decomptee.`;
      } else {
        await client.query(
          `UPDATE health_center_services
           SET beds_available = beds_available - 1, beds_occupied = beds_occupied + 1
           WHERE id = $1`,
          [service.rows[0].id]
        );
        bedServiceName = service.rows[0].name;
        await client.query(
          `UPDATE patient_referrals
           SET bed_service_name = $2, bed_occupied_at = NOW(), service_name = COALESCE(service_name, $2)
           WHERE id = $1`,
          [referralId, bedServiceName]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  sendPushNotificationToUser(Number(row.origin_user_id), {
    title: "Patient reçu",
    body: `${row.patient_name || "Le patient"} orienté vers ${row.destination_center_name} a été reçu.`,
    data: { type: "REFERRAL_RECEIVED", referralId: String(referralId) },
  }).catch(() => {});

  return res.json({
    success: true,
    message: bedServiceName
      ? `Reception confirmee : 1 place occupee en ${bedServiceName}.`
      : "Reception confirmee",
    bedServiceName,
    warning: bedWarning,
  });
}

// Le responsable libere la place occupee par le patient (sortie, transfert...).
export async function releaseReferralBed(req, res) {
  const referralId = Number(req.params.id);
  if (!Number.isInteger(referralId) || referralId <= 0) {
    return res.status(400).json({ message: "ID d'orientation invalide" });
  }

  const { row, error } = await loadReferralForDestination(req, referralId, { allowProcessed: true });
  if (error) {
    return res.status(error.status).json({ message: error.message });
  }
  if (!row.bed_occupied_at || row.bed_released_at) {
    return res.status(400).json({ message: "Aucune place occupee a liberer pour ce patient" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const released = await client.query(
      `UPDATE patient_referrals
       SET bed_released_at = NOW(), bed_released_by = $2
       WHERE id = $1 AND bed_occupied_at IS NOT NULL AND bed_released_at IS NULL`,
      [referralId, req.user.id]
    );
    if (released.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Cette place a deja ete liberee" });
    }
    // Si le service a ete renomme ou supprime entre-temps, on libere seulement l'orientation.
    await client.query(
      `UPDATE health_center_services
       SET beds_available = beds_available + 1, beds_occupied = GREATEST(beds_occupied - 1, 0)
       WHERE id = (
         SELECT id FROM health_center_services
         WHERE center_id = $1 AND lower(trim(name)) = lower($2)
         ORDER BY id LIMIT 1
       )`,
      [row.destination_center_id, row.bed_service_name]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return res.json({ success: true, message: `Place liberee en ${row.bed_service_name}.` });
}

export async function rejectReferralReception(req, res) {
  const referralId = Number(req.params.id);
  if (!Number.isInteger(referralId) || referralId <= 0) {
    return res.status(400).json({ message: "ID d'orientation invalide" });
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    return res.status(400).json({ message: "Motif du rejet requis" });
  }

  const { row, error } = await loadReferralForDestination(req, referralId);
  if (error) {
    return res.status(error.status).json({ message: error.message });
  }

  await pool.query(
    `UPDATE patient_referrals
     SET status = 'REJECTED', received_by = $2, received_at = NOW(), rejection_reason = $3
     WHERE id = $1`,
    [referralId, req.user.id, reason]
  );

  sendPushNotificationToUser(Number(row.origin_user_id), {
    title: "Orientation rejetee",
    body: `${row.destination_center_name} a rejete l'orientation de ${row.patient_name || "votre patient"} : ${reason}`,
    data: { type: "REFERRAL_REJECTED", referralId: String(referralId) },
  }).catch(() => {});

  return res.json({ success: true, message: "Orientation rejetee" });
}
