import { Pool } from "pg";
import { env } from "./env.js";

export const pool = new Pool({
  connectionString: env.databaseUrl
});

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (
        role IN (
          'USER',
          'REGULATOR',
          'NATIONAL',
          'REGION',
          'DISTRICT',
          'ETABLISSEMENT',
          'SAPEUR_POMPIER',
          'SAMU',
          'CHEF_ETABLISSEMENT'
        )
      ) DEFAULT 'USER',
      establishment_code TEXT NULL,
      region_code TEXT NULL,
      district_code TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      approval_status TEXT NOT NULL CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'APPROVED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (
        role IN (
          'USER',
          'REGULATOR',
          'NATIONAL',
          'REGION',
          'DISTRICT',
          'ETABLISSEMENT',
          'SAPEUR_POMPIER',
          'SAPEUR_POMPIER',
          'SAMU',
          'CHEF_ETABLISSEMENT',
          'POLICE',
          'GENDARMERIE',
          'PROTECTION_CIVILE',
          'MANAGE_PUBLIC_USERS'
        )
      ),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT user_roles_user_role_unique UNIQUE (user_id, role)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS health_centers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      establishment_code TEXT,
      level TEXT NOT NULL CHECK (
        level IN (
          'CHU',
          'CHR',
          'CH',
          'CHS',
          'CLINIQUE',
          'POLYCLINIQUE',
          'INFIRMERIE',
          'CLCC',
          'ESPC',
          'CENTRE_SANTE',
          'SSR',
          'EHPAD_USLD',
          'CENTRE_RADIOTHERAPIE',
          'CENTRE_CARDIOLOGIE'
        )
      ) DEFAULT 'CENTRE_SANTE',
      establishment_type TEXT NOT NULL CHECK (establishment_type IN ('CONFESSIONNEL', 'PRIVE', 'PUBLIQUE')) DEFAULT 'PUBLIQUE',
      technical_platform TEXT NOT NULL,
      region_code TEXT NULL,
      district_code TEXT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      approval_status TEXT NOT NULL CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
      approved_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS regions (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS districts (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      region_code TEXT NOT NULL REFERENCES regions(code) ON DELETE RESTRICT,
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS establishment_code TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS approval_status TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS region_code TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS district_code TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS center_id BIGINT NULL;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_center_id_fkey'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_center_id_fkey
        FOREIGN KEY (center_id) REFERENCES health_centers(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone_number TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN;
  `);
  await pool.query(`
    UPDATE users
    SET is_active = TRUE
    WHERE is_active IS NULL;
  `);
  await pool.query(`
    ALTER TABLE users
    ALTER COLUMN is_active SET DEFAULT TRUE,
    ALTER COLUMN is_active SET NOT NULL;
  `);
  await pool.query(`
    INSERT INTO user_roles (user_id, role)
    SELECT id, role
    FROM users
    ON CONFLICT (user_id, role) DO NOTHING;
  `);

  await pool.query(`
    UPDATE users
    SET approval_status = CASE
      WHEN role = 'CHEF_ETABLISSEMENT' THEN 'APPROVED'
      ELSE 'APPROVED'
    END
    WHERE approval_status IS NULL OR btrim(approval_status) = '';
  `);

  await pool.query(`
    ALTER TABLE users
    ALTER COLUMN approval_status SET DEFAULT 'APPROVED',
    ALTER COLUMN approval_status SET NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (
      role IN (
        'USER',
        'REGULATOR',
        'NATIONAL',
        'REGION',
        'DISTRICT',
        'ETABLISSEMENT',
        'SAPEUR_POMPIER',
        'SAPEUR_POMPIER',
        'SAMU',
        'CHEF_ETABLISSEMENT',
        'POLICE',
        'GENDARMERIE',
        'PROTECTION_CIVILE',
        'DEVELOPER'
      )
    );
  `);

  await pool.query(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_approval_status_check;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_approval_status_check CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS health_center_services (
      id BIGSERIAL PRIMARY KEY,
      center_id BIGINT NOT NULL REFERENCES health_centers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE health_center_services
    ADD COLUMN IF NOT EXISTS beds_available INT NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    ALTER TABLE health_center_services
    ADD COLUMN IF NOT EXISTS beds_occupied INT NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    ALTER TABLE health_center_services
    ADD COLUMN IF NOT EXISTS beds_out_of_service INT NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    ALTER TABLE health_center_services
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS center_complaints (
      id BIGSERIAL PRIMARY KEY,
      center_id BIGINT REFERENCES health_centers(id) ON DELETE SET NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')) DEFAULT 'NEW',
      handled_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      handled_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_updates (
      id BIGSERIAL PRIMARY KEY,
      complaint_id BIGINT NOT NULL REFERENCES center_complaints(id) ON DELETE CASCADE,
      user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS center_suggestions (
      id BIGSERIAL PRIMARY KEY,
      center_id BIGINT NOT NULL REFERENCES health_centers(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Observations et suggestions deposees via le QR code du centre (sans compte).
  // Visibles uniquement par le centre concerne.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS center_qr_feedback (
      id BIGSERIAL PRIMARY KEY,
      center_id BIGINT NOT NULL REFERENCES health_centers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('OBSERVATION', 'SUGGESTION')),
      message TEXT NOT NULL,
      author_name TEXT NULL,
      author_phone TEXT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_center_qr_feedback_center_id ON center_qr_feedback(center_id, created_at DESC);"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS center_ratings (
      id BIGSERIAL PRIMARY KEY,
      center_id BIGINT NOT NULL REFERENCES health_centers(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating SMALLINT NULL CHECK (rating BETWEEN 1 AND 5),
      satisfaction TEXT NULL CHECK (satisfaction IN ('SATISFIED', 'UNSATISFIED')),
      feedback_message TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT center_ratings_center_user_unique UNIQUE (center_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS emergency_reports (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_service TEXT NOT NULL CHECK (target_service IN ('SAMU', 'SAPEUR_POMPIER', 'SAPEUR_POMPIER', 'POLICE', 'GENDARMERIE', 'PROTECTION_CIVILE')),
      emergency_type TEXT NOT NULL,
      pickup_point_name TEXT NULL,
      description TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      photos JSONB NOT NULL DEFAULT '[]'::jsonb,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SITE', 'COMPLETED', 'CLOSED')) DEFAULT 'NEW',
      handled_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      handled_at TIMESTAMPTZ NULL,
      team_latitude DOUBLE PRECISION NULL,
      team_longitude DOUBLE PRECISION NULL,
      team_note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD COLUMN IF NOT EXISTS pickup_point_name TEXT NULL;
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD COLUMN IF NOT EXISTS handled_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ NULL;
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD COLUMN IF NOT EXISTS team_latitude DOUBLE PRECISION NULL;
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD COLUMN IF NOT EXISTS team_longitude DOUBLE PRECISION NULL;
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD COLUMN IF NOT EXISTS team_note TEXT NULL;
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    DROP CONSTRAINT IF EXISTS emergency_reports_status_check;
  `);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD CONSTRAINT emergency_reports_status_check
    CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SITE', 'COMPLETED', 'CLOSED'));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS emergency_bases (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      service_type TEXT NOT NULL CHECK (service_type IN ('SAMU', 'SAPEUR_POMPIER', 'SAPEUR_POMPIER', 'POLICE', 'GENDARMERIE', 'PROTECTION_CIVILE')),
      address TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      approval_status TEXT NOT NULL CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'APPROVED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ALTER COLUMN center_id DROP NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ADD COLUMN IF NOT EXISTS status TEXT;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ADD COLUMN IF NOT EXISTS handled_by BIGINT;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ADD COLUMN IF NOT EXISTS user_feedback_status TEXT;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ADD COLUMN IF NOT EXISTS user_feedback_message TEXT;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ADD COLUMN IF NOT EXISTS user_feedback_at TIMESTAMPTZ;
  `);

  await pool.query(`
    UPDATE center_complaints
    SET status = 'NEW'
    WHERE status IS NULL OR btrim(status) = '';
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ALTER COLUMN status SET DEFAULT 'NEW',
    ALTER COLUMN status SET NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    DROP CONSTRAINT IF EXISTS center_complaints_status_check;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ADD CONSTRAINT center_complaints_status_check
    CHECK (status IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'));
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    DROP CONSTRAINT IF EXISTS center_complaints_user_feedback_status_check;
  `);

  await pool.query(`
    ALTER TABLE center_complaints
    ADD CONSTRAINT center_complaints_user_feedback_status_check
    CHECK (user_feedback_status IS NULL OR user_feedback_status IN ('SATISFIED', 'UNSATISFIED'));
  `);

  await pool.query(`
    ALTER TABLE complaint_updates
    DROP CONSTRAINT IF EXISTS complaint_updates_status_check;
  `);

  await pool.query(`
    ALTER TABLE complaint_updates
    ADD CONSTRAINT complaint_updates_status_check
    CHECK (status IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'));
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'center_complaints_handled_by_fkey'
      ) THEN
        ALTER TABLE center_complaints
        ADD CONSTRAINT center_complaints_handled_by_fkey
        FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ADD COLUMN IF NOT EXISTS level TEXT;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ADD COLUMN IF NOT EXISTS establishment_type TEXT;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ADD COLUMN IF NOT EXISTS establishment_code TEXT;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ADD COLUMN IF NOT EXISTS approval_status TEXT;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ADD COLUMN IF NOT EXISTS approved_by BIGINT;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE health_centers
    ADD COLUMN IF NOT EXISTS region_code TEXT;
  `);
  await pool.query(`
    ALTER TABLE health_centers
    ADD COLUMN IF NOT EXISTS district_code TEXT;
  `);

  await pool.query(`
    UPDATE health_centers
    SET approval_status = 'APPROVED'
    WHERE approval_status IS NULL OR btrim(approval_status) = '';
  `);

  await pool.query(`
    UPDATE health_centers
    SET establishment_code = NULL
    WHERE establishment_code IS NOT NULL AND btrim(establishment_code) = '';
  `);

  await pool.query(`
    UPDATE health_centers
    SET establishment_code = upper(btrim(establishment_code))
    WHERE establishment_code IS NOT NULL;
  `);
  await pool.query(`
    UPDATE users
    SET
      region_code = NULLIF(upper(btrim(region_code)), ''),
      district_code = NULLIF(upper(btrim(district_code)), '');
  `);
  await pool.query(`
    UPDATE health_centers hc
    SET
      region_code = COALESCE(
        NULLIF(upper(btrim(hc.region_code)), ''),
        NULLIF(upper(btrim(u.region_code)), '')
      ),
      district_code = COALESCE(
        NULLIF(upper(btrim(hc.district_code)), ''),
        NULLIF(upper(btrim(u.district_code)), '')
      )
    FROM users u
    WHERE u.id = hc.created_by;
  `);



  await pool.query(`
    ALTER TABLE health_centers
    DROP CONSTRAINT IF EXISTS health_centers_level_check;
  `);

  await pool.query(`
    UPDATE health_centers
    SET level = CASE
      WHEN level IS NULL OR btrim(level) = '' THEN 'CENTRE_SANTE'
      WHEN upper(level) IN ('PRIMAIRE', 'SECONDAIRE', 'TERTIAIRE') THEN 'CENTRE_SANTE'
      ELSE upper(level)
    END;
  `);

  await pool.query(`
    UPDATE health_centers
    SET level = 'CLINIQUE'
    WHERE level = 'CLINIQUE_PRIVEE';
  `);

  await pool.query(`
    UPDATE health_centers
    SET level = 'CENTRE_SANTE'
    WHERE level NOT IN (
      'CHU',
      'CHR',
      'CH',
      'CHS',
      'CLINIQUE',
      'POLYCLINIQUE',
      'INFIRMERIE',
      'CLCC',
      'ESPC',
      'CENTRE_SANTE',
      'SSR',
      'EHPAD_USLD',
      'CENTRE_RADIOTHERAPIE',
      'CENTRE_CARDIOLOGIE'
    );
  `);

  await pool.query(`
    UPDATE health_centers
    SET establishment_type = 'PUBLIQUE'
    WHERE establishment_type IS NULL OR btrim(establishment_type) = '';
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ALTER COLUMN establishment_code DROP NOT NULL,
    ALTER COLUMN approval_status SET DEFAULT 'PENDING',
    ALTER COLUMN approval_status SET NOT NULL,
    ALTER COLUMN level SET DEFAULT 'CENTRE_SANTE',
    ALTER COLUMN level SET NOT NULL,
    ALTER COLUMN establishment_type SET DEFAULT 'PUBLIQUE',
    ALTER COLUMN establishment_type SET NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    DROP CONSTRAINT IF EXISTS health_centers_level_check;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    DROP CONSTRAINT IF EXISTS health_centers_establishment_code_key;
  `);



  await pool.query(`
    ALTER TABLE health_centers
    ADD CONSTRAINT health_centers_level_check
    CHECK (
      level IN (
        'CHU',
        'CHR',
        'CH',
        'CHS',
        'CLINIQUE',
        'POLYCLINIQUE',
        'INFIRMERIE',
        'CLCC',
        'ESPC',
        'CENTRE_SANTE',
        'SSR',
        'EHPAD_USLD',
        'CENTRE_RADIOTHERAPIE',
        'CENTRE_CARDIOLOGIE'
      )
    );
  `);

  await pool.query(`
    ALTER TABLE health_centers
    DROP CONSTRAINT IF EXISTS health_centers_establishment_type_check;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    DROP CONSTRAINT IF EXISTS health_centers_approval_status_check;
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ADD CONSTRAINT health_centers_establishment_type_check
    CHECK (establishment_type IN ('CONFESSIONNEL', 'PRIVE', 'PUBLIQUE'));
  `);

  await pool.query(`
    ALTER TABLE health_centers
    ADD CONSTRAINT health_centers_approval_status_check
    CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'health_centers_approved_by_fkey'
      ) THEN
        ALTER TABLE health_centers
        ADD CONSTRAINT health_centers_approved_by_fkey
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_health_centers_coords ON health_centers(latitude, longitude);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_health_center_services_center_id ON health_center_services(center_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_center_complaints_center_id ON center_complaints(center_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_complaint_updates_complaint_id ON complaint_updates(complaint_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_center_ratings_center_id ON center_ratings(center_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_center_ratings_user_id ON center_ratings(user_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_emergency_reports_target_service ON emergency_reports(target_service);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_emergency_reports_created_at ON emergency_reports(created_at);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_emergency_reports_status ON emergency_reports(status);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_emergency_reports_handled_by ON emergency_reports(handled_by);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id ON auth_refresh_tokens(user_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_users_region_code ON users(region_code);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_users_district_code ON users(district_code);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_users_center_id ON users(center_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_health_centers_region_code ON health_centers(region_code);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_health_centers_district_code ON health_centers(district_code);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_emergency_bases_service_type ON emergency_bases(service_type);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_emergency_bases_coords ON emergency_bases(latitude, longitude);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_regions_code ON regions(code);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_regions_name ON regions(name);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_districts_code ON districts(code);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_districts_region_code ON districts(region_code);"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_alerts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      alert_type TEXT NOT NULL CHECK (
        alert_type IN ('AGRESSION', 'ACCIDENT', 'INCENDIE', 'INTRUSION', 'AUTRE')
      ),
      location_name TEXT NOT NULL,
      description TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      photos JSONB NOT NULL DEFAULT '[]'::jsonb,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED')) DEFAULT 'NEW',
      handled_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      handled_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Ajouter target_service sur security_alerts si absent
  await pool.query(`
    ALTER TABLE security_alerts
    ADD COLUMN IF NOT EXISTS target_service TEXT NOT NULL DEFAULT 'POLICE';
  `);
  await pool.query(`
    ALTER TABLE security_alerts
    ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE security_alerts
    DROP CONSTRAINT IF EXISTS security_alerts_target_service_check;
  `);
  await pool.query(`
    ALTER TABLE security_alerts
    ADD CONSTRAINT security_alerts_target_service_check
    CHECK (target_service IN ('POLICE', 'GENDARMERIE', 'PROTECTION_CIVILE'));
  `);

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_security_alerts_target_service ON security_alerts(target_service);"
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_security_alerts_user_id ON security_alerts(user_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_security_alerts_status ON security_alerts(status);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at ON security_alerts(created_at);"
  );

  // Normaliser les anciennes donnees SAPPEUR_POMPIER (double P) -> SAPEUR_POMPIER
  await pool.query(`UPDATE user_roles SET role = 'SAPEUR_POMPIER' WHERE role = 'SAPPEUR_POMPIER';`);
  await pool.query(`UPDATE users SET role = 'SAPEUR_POMPIER' WHERE role = 'SAPPEUR_POMPIER';`);
  await pool.query(`UPDATE emergency_reports SET target_service = 'SAPEUR_POMPIER' WHERE target_service = 'SAPPEUR_POMPIER';`);
  await pool.query(`UPDATE emergency_bases SET service_type = 'SAPEUR_POMPIER' WHERE service_type = 'SAPPEUR_POMPIER';`);

  // Elargir les contraintes CHECK pour les nouveaux roles et services
  await pool.query(`ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;`);
  await pool.query(`
    ALTER TABLE user_roles
    ADD CONSTRAINT user_roles_role_check CHECK (
      role IN (
        'USER','REGULATOR','NATIONAL','REGION','DISTRICT',
        'ETABLISSEMENT','SAPEUR_POMPIER','SAMU',
        'CHEF_ETABLISSEMENT','POLICE','GENDARMERIE','PROTECTION_CIVILE',
        'DEVELOPER','MANAGE_PUBLIC_USERS'
      )
    );
  `);

  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
  await pool.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (
      role IN (
        'USER','REGULATOR','NATIONAL','REGION','DISTRICT',
        'ETABLISSEMENT','SAPEUR_POMPIER','SAMU',
        'CHEF_ETABLISSEMENT','POLICE','GENDARMERIE','PROTECTION_CIVILE','DEVELOPER'
      )
    );
  `);

  await pool.query(`ALTER TABLE emergency_reports DROP CONSTRAINT IF EXISTS emergency_reports_target_service_check;`);
  await pool.query(`
    ALTER TABLE emergency_reports
    ADD CONSTRAINT emergency_reports_target_service_check CHECK (
      target_service IN (
        'SAMU','SAPEUR_POMPIER','POLICE','GENDARMERIE','PROTECTION_CIVILE'
      )
    );
  `);

  await pool.query(`ALTER TABLE emergency_bases DROP CONSTRAINT IF EXISTS emergency_bases_service_type_check;`);
  await pool.query(`
    ALTER TABLE emergency_bases
    ADD CONSTRAINT emergency_bases_service_type_check CHECK (
      service_type IN (
        'SAMU','SAPEUR_POMPIER','POLICE','GENDARMERIE','PROTECTION_CIVILE'
      )
    );
  `);

  // Étendre les contraintes pour inclure le rôle DEVELOPER
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
  await pool.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (
      role IN (
        'USER','REGULATOR','NATIONAL','REGION','DISTRICT',
        'ETABLISSEMENT','SAPEUR_POMPIER','SAMU',
        'CHEF_ETABLISSEMENT','POLICE','GENDARMERIE','PROTECTION_CIVILE','DEVELOPER'
      )
    );
  `);

  await pool.query(`ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;`);
  await pool.query(`
    ALTER TABLE user_roles
    ADD CONSTRAINT user_roles_role_check CHECK (
      role IN (
        'USER','REGULATOR','NATIONAL','REGION','DISTRICT',
        'ETABLISSEMENT','SAPEUR_POMPIER','SAMU',
        'CHEF_ETABLISSEMENT','POLICE','GENDARMERIE','PROTECTION_CIVILE','DEVELOPER'
      )
    );
  `);

  // Table analytics_events
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      user_role TEXT NULL,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      metadata JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_module ON analytics_events(module);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_user_role ON analytics_events(user_role);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_user_id ON analytics_events(user_id);`);

  // center_visits : enregistrement des visites patients
  await pool.query(`
    ALTER TABLE health_centers ADD COLUMN IF NOT EXISTS checkin_code TEXT NULL;
  `);
  await pool.query(`
    UPDATE health_centers
    SET checkin_code = UPPER(SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT || NOW()::TEXT), 1, 6))
    WHERE checkin_code IS NULL;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS center_visits (
      id BIGSERIAL PRIMARY KEY,
      center_id BIGINT NOT NULL REFERENCES health_centers(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmation_type TEXT NOT NULL CHECK (confirmation_type IN ('CODE', 'PROFESSIONAL', 'SELF_DECLARED')),
      confirmed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT center_visits_user_center_unique UNIQUE (center_id, user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_center_visits_user_id ON center_visits(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_center_visits_center_id ON center_visits(center_id);`);
  await pool.query(`ALTER TABLE center_visits DROP CONSTRAINT IF EXISTS center_visits_confirmation_type_check;`);
  await pool.query(`
    ALTER TABLE center_visits ADD CONSTRAINT center_visits_confirmation_type_check
    CHECK (confirmation_type IN ('CODE', 'PROFESSIONAL', 'SELF_DECLARED'));
  `);

  // Attribuer le rôle DEVELOPER au compte développeur principal
  await pool.query(`UPDATE users SET role = 'DEVELOPER' WHERE email = 'skaragher@gmail.com';`);
  await pool.query(`
    INSERT INTO user_roles (user_id, role)
    SELECT id, 'DEVELOPER' FROM users WHERE email = 'skaragher@gmail.com'
    ON CONFLICT (user_id, role) DO NOTHING;
  `);

  // patient_referrals : orientation/depot de patient vers un centre de reference
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patient_referrals (
      id BIGSERIAL PRIMARY KEY,
      origin_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      destination_center_id BIGINT NOT NULL REFERENCES health_centers(id) ON DELETE CASCADE,
      patient_phone TEXT NOT NULL,
      patient_name TEXT NULL,
      reason TEXT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'RECEIVED', 'REJECTED', 'CANCELLED')) DEFAULT 'PENDING',
      received_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      received_at TIMESTAMPTZ NULL,
      rejection_reason TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_patient_referrals_destination_center_id ON patient_referrals(destination_center_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_patient_referrals_origin_user_id ON patient_referrals(origin_user_id);"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_patient_referrals_status ON patient_referrals(status);"
  );
  await pool.query(`
    ALTER TABLE patient_referrals ADD COLUMN IF NOT EXISTS service_name TEXT NULL;
    ALTER TABLE patient_referrals ADD COLUMN IF NOT EXISTS bed_service_name TEXT NULL;
    ALTER TABLE patient_referrals ADD COLUMN IF NOT EXISTS bed_occupied_at TIMESTAMPTZ NULL;
    ALTER TABLE patient_referrals ADD COLUMN IF NOT EXISTS bed_released_at TIMESTAMPTZ NULL;
    ALTER TABLE patient_referrals ADD COLUMN IF NOT EXISTS bed_released_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    ALTER TABLE patient_referrals ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL;
  `);
  await pool.query(`
    ALTER TABLE patient_referrals DROP CONSTRAINT IF EXISTS patient_referrals_status_check;
  `);
  await pool.query(`
    ALTER TABLE patient_referrals
    ADD CONSTRAINT patient_referrals_status_check
    CHECK (status IN ('PENDING', 'RECEIVED', 'REJECTED', 'CANCELLED'));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS module_role_settings (
      module_key TEXT NOT NULL,
      role TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (module_key, role)
    );
  `);
  // app_key : distingue les reglages entre les apps mobiles (mobile / mobile-minima)
  await pool.query(`
    ALTER TABLE module_role_settings ADD COLUMN IF NOT EXISTS app_key TEXT NOT NULL DEFAULT 'mobile';
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.key_column_usage
        WHERE table_name = 'module_role_settings'
          AND constraint_name = 'module_role_settings_pkey'
          AND column_name = 'app_key'
      ) THEN
        ALTER TABLE module_role_settings DROP CONSTRAINT IF EXISTS module_role_settings_pkey;
        ALTER TABLE module_role_settings ADD CONSTRAINT module_role_settings_pkey PRIMARY KEY (module_key, role, app_key);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      app_key TEXT NOT NULL DEFAULT 'mobile',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT push_tokens_user_token_unique UNIQUE (user_id, token)
    );
  `);
}

export async function connectDb() {
  await pool.query("SELECT 1");
  await runMigrations();
  console.log("PostgreSQL connected");
}

