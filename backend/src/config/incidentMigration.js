export async function migrateIncidents(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS incident_policy (
      id INT PRIMARY KEY CHECK(id=1), max_age_seconds INT NOT NULL DEFAULT 60 CHECK(max_age_seconds BETWEEN 5 AND 600),
      max_accuracy_meters DOUBLE PRECISION NOT NULL DEFAULT 100 CHECK(max_accuracy_meters BETWEEN 1 AND 5000),
      max_reports_per_minute INT NOT NULL DEFAULT 3 CHECK(max_reports_per_minute BETWEEN 1 AND 30),
      duplicate_window_minutes INT NOT NULL DEFAULT 15 CHECK(duplicate_window_minutes BETWEEN 1 AND 120),
      duplicate_distance_meters INT NOT NULL DEFAULT 150 CHECK(duplicate_distance_meters BETWEEN 10 AND 2000)
    );
    INSERT INTO incident_policy(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS emergency_zones (
      id BIGSERIAL PRIMARY KEY, base_id BIGINT NOT NULL REFERENCES emergency_bases(id) ON DELETE RESTRICT,
      name TEXT NOT NULL, geometry JSONB NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_test BOOLEAN NOT NULL DEFAULT FALSE, updated_by BIGINT REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS emergency_zones_base_idx ON emergency_zones(base_id);
    CREATE TABLE IF NOT EXISTS incident_access_roles (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      coordinate_all BOOLEAN NOT NULL DEFAULT FALSE, coordinate_base_ids BIGINT[] NOT NULL DEFAULT '{}',
      supervisor_base_ids BIGINT[] NOT NULL DEFAULT '{}', updated_by BIGINT REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS incident_grants (
      kind TEXT NOT NULL CHECK(kind IN ('medical','security')), report_id BIGINT NOT NULL,
      base_id BIGINT NOT NULL REFERENCES emergency_bases(id), granted_by BIGINT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(kind,report_id,base_id)
    );
    CREATE TABLE IF NOT EXISTS incident_history (
      id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('medical','security')), report_id BIGINT NOT NULL,
      actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL, event TEXT NOT NULL,
      from_status TEXT, to_status TEXT, from_base_id BIGINT REFERENCES emergency_bases(id), to_base_id BIGINT REFERENCES emergency_bases(id),
      reason TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS incident_history_report_idx ON incident_history(kind,report_id,id);
    CREATE TABLE IF NOT EXISTS incident_notification_outbox (
      id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, report_id BIGINT NOT NULL, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL, attempts INT NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivered_at TIMESTAMPTZ, UNIQUE(kind,report_id,user_id,event_key)
    );
  `);
  for(const table of ["emergency_reports","security_alerts"]) {
    await db.query(`ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS assigned_base_id BIGINT REFERENCES emergency_bases(id),
      ADD COLUMN IF NOT EXISTS assignment_reason TEXT NOT NULL DEFAULT 'LEGACY_UNASSIGNED',
      ADD COLUMN IF NOT EXISTS location_timestamp TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS location_accuracy_meters DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS presence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS victim_count INT CHECK(victim_count BETWEEN 0 AND 10000),
      ADD COLUMN IF NOT EXISTS client_request_id TEXT,
      ADD COLUMN IF NOT EXISTS probable_duplicate_ids JSONB NOT NULL DEFAULT '[]';
      ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_status_check;
      ALTER TABLE ${table} ADD CONSTRAINT ${table}_status_check CHECK(status IN
        ('PENDING_ASSIGNMENT','NEW','ACKNOWLEDGED','EN_ROUTE','ON_SITE','COMPLETED','UNCONFIRMED','DUPLICATE','CLOSED','RESOLVED'));
      CREATE UNIQUE INDEX IF NOT EXISTS ${table}_request_idx ON ${table}(user_id,client_request_id) WHERE client_request_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ${table}_assigned_idx ON ${table}(assigned_base_id,status);
    `);
    // No guessed jurisdiction; keep an audit of every migration-induced status change.
    await db.query(`WITH moved AS (
      UPDATE ${table} r SET status='PENDING_ASSIGNMENT' FROM (
        SELECT id,status AS old_status FROM ${table} WHERE assigned_base_id IS NULL
          AND status IN ('NEW','ACKNOWLEDGED','EN_ROUTE','ON_SITE') AND assignment_reason='LEGACY_UNASSIGNED'
      ) previous WHERE r.id=previous.id RETURNING r.id,previous.old_status
    ) INSERT INTO incident_history(kind,report_id,event,from_status,to_status,reason)
      SELECT $1,id,'MIGRATED_TO_QUEUE',old_status,'PENDING_ASSIGNMENT','LEGACY_UNASSIGNED' FROM moved`,[table==="emergency_reports"?"medical":"security"]);
  }
  await db.query(`ALTER TABLE security_alerts DROP CONSTRAINT IF EXISTS security_alerts_alert_type_check;
    ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_alert_type_check CHECK(alert_type IN
      ('AGRESSION','ACCIDENT','INCENDIE','INTRUSION','AUTRE','VOL','ATTROUPEMENT_SUSPECT','DROGUE','AFFRONTEMENT','TROUBLE_URBAIN',
       'ATTAQUE','BRAQUAGE','CONFLIT','COUPEUR_ROUTE','TERRORISME','INONDATION','EFFONDREMENT','FUITE_GAZ','SAUVETAGE'));`);
  // One installation token belongs to its most recently registered account only.
  await db.query(`WITH ranked AS (SELECT id,row_number() OVER(PARTITION BY token ORDER BY updated_at DESC,id DESC) AS n FROM push_tokens)
    DELETE FROM push_tokens p USING ranked r WHERE p.id=r.id AND r.n>1;
    CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_device_unique ON push_tokens(token);`);
}
