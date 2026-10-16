// Dependencies are injected so quota reporting can be tested without sending real mail.
export function createQuotaReporter({ query, sendEmail, now = () => new Date(), logger = console }) {
  return async function reportQuota({ route, model }) {
    try {
      const date = now();
      const incidentKey = `${model}:${date.toISOString().slice(0, 13)}`;
      const result = await query(`
        INSERT INTO assistant_quota_alerts (incident_key, model, route)
        VALUES ($1, $2, $3)
        ON CONFLICT (incident_key) DO UPDATE
          SET last_seen_at = NOW(), occurrence_count = assistant_quota_alerts.occurrence_count + 1
        RETURNING id;
      `, [incidentKey, model, route]);
      const claimed = await query(`
        UPDATE assistant_quota_alerts SET last_notification_attempt_at = NOW()
        WHERE id = $1 AND notified_at IS NULL
          AND (last_notification_attempt_at IS NULL OR last_notification_attempt_at < NOW() - INTERVAL '5 minutes')
        RETURNING id;
      `, [result.rows[0].id]);
      if (!claimed.rowCount) return;
      await sendEmail({
        subject: "Assistant IA : quota Gemini atteint",
        lines: ["Le fournisseur Gemini a refusé une requête pour dépassement de quota ou de débit.",
          "Les utilisateurs mobiles voient uniquement : Assistant IA indisponible, veuillez réessayer plus tard.",
          "Vérifiez les quotas et la disponibilité dans Google AI Studio."],
        metadata: { model, route, date: date.toISOString() }
      });
      await query(`UPDATE assistant_quota_alerts SET notified_at = NOW() WHERE id = $1`, [result.rows[0].id]);
    } catch {
      // No user messages, recording, credential, or raw provider error is logged.
      logger.error("Assistant IA : alerte de quota non envoyée. Consulter les incidents administrateur et la configuration SMTP.");
    }
  };
}
