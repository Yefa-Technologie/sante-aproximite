import { incidentScopeSql } from "../services/incidentAccess.js";
import { SERVICE_ROLES } from "../services/serviceBaseService.js";
import { pool } from "../config/db.js";

export async function getUserActions(req, res) {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ message: "userId invalide" });

  const medicalParams=[userId],securityParams=[userId];
  const medicalScope=incidentScopeSql("r",req.user,medicalParams,SERVICE_ROLES,"medical");
  const securityScope=incidentScopeSql("r",req.user,securityParams,SERVICE_ROLES,"security");
  const [events, complaints, emergencies, securityAlerts] = await Promise.all([
    pool.query(
      `SELECT module, action, metadata, created_at
       FROM analytics_events
       WHERE user_id = $1 AND module NOT IN ('emergency','security_alert','alerts','security_ops')
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    ),
    pool.query(
      `SELECT id, subject, status, created_at
       FROM center_complaints
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    ),
    pool.query(
      `SELECT id, target_service, status, created_at
       FROM emergency_reports r
       WHERE user_id = $1 AND ${medicalScope}
       ORDER BY created_at DESC`,
      medicalParams
    ),
    pool.query(
      `SELECT id, target_service, alert_type, status, created_at
       FROM security_alerts r
       WHERE user_id = $1 AND ${securityScope}
       ORDER BY created_at DESC`,
      securityParams
    ),
  ]);

  res.json({
    events: events.rows.map((r) => ({
      module: r.module,
      action: r.action,
      metadata: r.metadata,
      createdAt: r.created_at,
    })),
    complaints: complaints.rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      createdAt: r.created_at,
    })),
    emergencies: emergencies.rows.map((r) => ({
      id: r.id,
      service: r.target_service,
      status: r.status,
      createdAt: r.created_at,
    })),
    securityAlerts: securityAlerts.rows.map((r) => ({
      id: r.id,
      service: r.target_service,
      type: r.alert_type,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
}

export async function logEvent(req, res) {
  const { module, action, metadata } = req.body || {};
  if (!module || !action) {
    return res.status(400).json({ message: "module et action sont requis" });
  }
  const userId = req.user?.id ? Number(req.user.id) : null;
  const userRole = req.user?.role || req.body?.role || null;

  await pool.query(
    `INSERT INTO analytics_events (user_id, user_role, module, action, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, userRole, String(module), String(action), metadata ? JSON.stringify(metadata) : null]
  );

  res.json({ ok: true });
}

export async function getSummary(req, res) {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const interval = `${days} days`;
  const medicalParams=[interval],securityParams=[interval];
  const medicalScope=incidentScopeSql("r",req.user,medicalParams,SERVICE_ROLES,"medical");
  const securityScope=incidentScopeSql("r",req.user,securityParams,SERVICE_ROLES,"security");

  const [byModule, byAction, byRole, daily, uniqueUsers, totalRow, publicVsPro, complaintsStats, emergencyStats, securityStats, healthCenterUsage] =
    await Promise.all([
      pool.query(
        `SELECT module, COUNT(*) AS count
         FROM analytics_events
         WHERE created_at > NOW() - $1::interval AND module NOT IN ('emergency','security_alert','alerts','security_ops')
         GROUP BY module ORDER BY count DESC`,
        [interval]
      ),
      pool.query(
        `SELECT module, action, COUNT(*) AS count
         FROM analytics_events
         WHERE created_at > NOW() - $1::interval AND module NOT IN ('emergency','security_alert','alerts','security_ops')
         GROUP BY module, action ORDER BY count DESC LIMIT 50`,
        [interval]
      ),
      pool.query(
        `SELECT COALESCE(user_role, 'anonyme') AS user_role, COUNT(*) AS count
         FROM analytics_events
         WHERE created_at > NOW() - $1::interval AND module NOT IN ('emergency','security_alert','alerts','security_ops')
         GROUP BY user_role ORDER BY count DESC`,
        [interval]
      ),
      pool.query(
        `SELECT DATE(created_at) AS day, COUNT(*) AS count
         FROM analytics_events
         WHERE created_at > NOW() - $1::interval AND module NOT IN ('emergency','security_alert','alerts','security_ops')
         GROUP BY day ORDER BY day`,
        [interval]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT user_id) AS count
         FROM analytics_events
         WHERE created_at > NOW() - $1::interval AND module NOT IN ('emergency','security_alert','alerts','security_ops') AND user_id IS NOT NULL`,
        [interval]
      ),
      pool.query(
        `SELECT COUNT(*) AS count FROM analytics_events
         WHERE created_at > NOW() - $1::interval AND module NOT IN ('emergency','security_alert','alerts','security_ops')`,
        [interval]
      ),
      pool.query(
        `SELECT
           SUM(CASE WHEN user_role = 'USER' THEN 1 ELSE 0 END) AS public_count,
           SUM(CASE WHEN user_role != 'USER' AND user_role IS NOT NULL THEN 1 ELSE 0 END) AS pro_count,
           SUM(CASE WHEN user_role IS NULL THEN 1 ELSE 0 END) AS anon_count
         FROM analytics_events
         WHERE created_at > NOW() - $1::interval AND module NOT IN ('emergency','security_alert','alerts','security_ops')`,
        [interval]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END) AS new_count,
           SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count,
           SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) AS resolved_count,
           SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count
         FROM center_complaints
         WHERE created_at > NOW() - $1::interval`,
        [interval]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END) AS new_count,
           SUM(CASE WHEN status IN ('ACKNOWLEDGED','EN_ROUTE','ON_SITE') THEN 1 ELSE 0 END) AS in_progress_count,
           SUM(CASE WHEN status IN ('COMPLETED','CLOSED') THEN 1 ELSE 0 END) AS resolved_count,
           target_service
         FROM emergency_reports r
         WHERE created_at > NOW() - $1::interval AND ${medicalScope}
         GROUP BY GROUPING SETS ((), (target_service))`,
        medicalParams
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END) AS new_count,
           SUM(CASE WHEN status IN ('ACKNOWLEDGED','EN_ROUTE','ON_SITE') THEN 1 ELSE 0 END) AS in_progress_count,
           SUM(CASE WHEN status IN ('COMPLETED','RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS resolved_count,
           target_service
         FROM security_alerts r
         WHERE created_at > NOW() - $1::interval AND ${securityScope}
         GROUP BY GROUPING SETS ((), (target_service))`,
        securityParams
      ),
      pool.query(
        `
          WITH center_population AS (
            SELECT COUNT(DISTINCT id)::int AS total
            FROM users
            WHERE is_active = TRUE
              AND approval_status = 'APPROVED'
              AND role IN ('ETABLISSEMENT', 'CHEF_ETABLISSEMENT')
          ),
          center_openers AS (
            SELECT COUNT(DISTINCT ae.user_id)::int AS active
            FROM analytics_events ae
            JOIN users u ON u.id = ae.user_id
            WHERE ae.created_at > NOW() - $1::interval
              AND u.is_active = TRUE
              AND u.approval_status = 'APPROVED'
              AND u.role IN ('ETABLISSEMENT', 'CHEF_ETABLISSEMENT')
              AND (
                (ae.module = 'app' AND ae.action IN ('login', 'screen_view', 'app_open'))
                OR
                (ae.action = 'login')
              )
          )
          SELECT
            cp.total,
            co.active,
            CASE
              WHEN cp.total = 0 THEN 0
              ELSE ROUND((co.active::numeric / cp.total::numeric) * 100, 1)
            END AS usage_rate
          FROM center_population cp
          CROSS JOIN center_openers co
        `,
        [interval]
      ),
    ]);

  res.json({
    period: days,
    total: Number(totalRow.rows[0]?.count || 0),
    uniqueUsers: Number(uniqueUsers.rows[0]?.count || 0),
    byModule: byModule.rows.map((r) => ({ module: r.module, count: Number(r.count) })),
    byAction: byAction.rows.map((r) => ({ module: r.module, action: r.action, count: Number(r.count) })),
    byRole: byRole.rows.map((r) => ({ role: r.user_role, count: Number(r.count) })),
    daily: daily.rows.map((r) => ({ day: r.day, count: Number(r.count) })),
    publicVsPro: {
      public: Number(publicVsPro.rows[0]?.public_count || 0),
      pro: Number(publicVsPro.rows[0]?.pro_count || 0),
      anon: Number(publicVsPro.rows[0]?.anon_count || 0),
    },
    healthCenterAppUsage: {
      eligibleUsers: Number(healthCenterUsage.rows[0]?.total || 0),
      activeOpeners: Number(healthCenterUsage.rows[0]?.active || 0),
      rate: Number(healthCenterUsage.rows[0]?.usage_rate || 0),
    },
    complaintsStats: {
      total: Number(complaintsStats.rows[0]?.total || 0),
      new: Number(complaintsStats.rows[0]?.new_count || 0),
      inProgress: Number(complaintsStats.rows[0]?.in_progress_count || 0),
      resolved: Number(complaintsStats.rows[0]?.resolved_count || 0),
      rejected: Number(complaintsStats.rows[0]?.rejected_count || 0),
    },
    emergencyStats: {
      total: Number(emergencyStats.rows.find(r => r.target_service == null)?.total || 0),
      new: Number(emergencyStats.rows.find(r => r.target_service == null)?.new_count || 0),
      inProgress: Number(emergencyStats.rows.find(r => r.target_service == null)?.in_progress_count || 0),
      resolved: Number(emergencyStats.rows.find(r => r.target_service == null)?.resolved_count || 0),
      byService: emergencyStats.rows
        .filter(r => r.target_service != null)
        .map(r => ({ service: r.target_service, count: Number(r.total) })),
    },
    securityStats: {
      total: Number(securityStats.rows.find(r => r.target_service == null)?.total || 0),
      new: Number(securityStats.rows.find(r => r.target_service == null)?.new_count || 0),
      inProgress: Number(securityStats.rows.find(r => r.target_service == null)?.in_progress_count || 0),
      resolved: Number(securityStats.rows.find(r => r.target_service == null)?.resolved_count || 0),
      byService: securityStats.rows
        .filter(r => r.target_service != null)
        .map(r => ({ service: r.target_service, count: Number(r.total) })),
    },
  });
}
