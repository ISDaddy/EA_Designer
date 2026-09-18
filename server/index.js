require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { OAuth2Client } = require('google-auth-library');
const { Pool } = require('pg');
const translationsSeed = require('./translations-seed');
const nda = require('./nda');

const app = express();
// `credentials: true` + reflecting the request origin (rather than `*`) is required for the
// session cookie to survive cross-origin requests - the frontend and backend are served from the
// same host but different ports, which browsers treat as different origins.
app.use(cors({ origin: true, credentials: true }));
// Raised from Express's 100kb default so a Profile page avatar image (stored as a base64 data URI
// - see PATCH /api/auth/me) fits comfortably; everything else this API accepts is tiny by
// comparison.
app.use(express.json({ limit: '3mb' }));
app.use(cookieParser());

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'eadesigner',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  port: 5432,
});

async function initDB() {
  let retries = 5;
  while (retries > 0) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      console.log('Waiting for DB...', err.message);
      retries--;
      await new Promise(res => setTimeout(res, 2000));
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS systems (
      id VARCHAR(255) PRIMARY KEY,
      label VARCHAR(255) NOT NULL,
      x FLOAT NOT NULL,
      y FLOAT NOT NULL,
      layout_positions JSONB DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS data_objects (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      master_system_id VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      system_object_names JSONB DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS edges (
      id VARCHAR(255) PRIMARY KEY,
      source VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      target VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      data_object_ids JSONB DEFAULT '[]'
    );

    -- Admin-maintainable reference lists (Inventory page) that an edge's individual object flows
    -- can tag themselves with, e.g. for eventually driving edge styling by integration
    -- type/software rather than by master-conflict status alone.
    CREATE TABLE IF NOT EXISTS integration_types (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_software (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    );

    -- A system's business capability (e.g. "Payroll", "Treasury") as a managed list rather than
    -- free text, so the Stakeholder canvas view can group systems by it reliably. See the
    -- business_capability_id migration below for how existing free-text values move into this.
    CREATE TABLE IF NOT EXISTS business_capabilities (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    );

    -- A planned or unplanned window where a system is unavailable - the Schedule page cross-
    -- references these against computed run times to flag which integrations they'd impact.
    CREATE TABLE IF NOT EXISTS system_downtimes (
      id VARCHAR(255) PRIMARY KEY,
      system_id VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      reason TEXT DEFAULT ''
    );

    -- How each individual data object moves over a given edge - one row per (edge, object) pair,
    -- not per edge, because a single connection carrying several objects can integrate each one
    -- differently (different pattern, frequency, type, software). The pattern is further split
    -- into a source-side and target-side value, since even one object's flow can be read from its
    -- source system over one protocol and delivered into its target system over another. "at_risk"
    -- flags a flow whose business impact is high enough that an interrupted schedule/connection
    -- should be called out on the Schedule page rather than blending in with routine traffic.
    -- "schedule" (JSONB - see ScheduleDef in App.tsx: cron expression, simple interval, daily/
    -- weekly at a time, or "none" for real-time/on-demand) is mandatory per flow rather than a
    -- shared admin-maintained list a flow points at - every integration defines its own cadence
    -- directly. integration_type_id/integration_software_id are each a single optional reference
    -- (not an array) - one flow carries at most one Integration Type and one Integration Software.
    CREATE TABLE IF NOT EXISTS edge_object_details (
      edge_id VARCHAR(255) REFERENCES edges(id) ON DELETE CASCADE,
      data_object_id VARCHAR(255) REFERENCES data_objects(id) ON DELETE CASCADE,
      source_pattern VARCHAR(50) DEFAULT '',
      target_pattern VARCHAR(50) DEFAULT '',
      schedule JSONB NOT NULL DEFAULT '{"kind":"daily","time":"02:00"}',
      integration_type_id VARCHAR(255) DEFAULT '',
      integration_software_id VARCHAR(255) DEFAULT '',
      at_risk BOOLEAN DEFAULT false,
      PRIMARY KEY (edge_id, data_object_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      role VARCHAR(50) NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id VARCHAR(255) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'viewer',
      token VARCHAR(255) UNIQUE NOT NULL,
      invited_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ
    );

    -- One-time links for the "forgot password" flow, parallel to invites but tied to an existing
    -- user instead of an email that doesn't have an account yet. used_at (rather than a
    -- status enum) is enough here since a reset link only ever has two states: usable or spent.
    CREATE TABLE IF NOT EXISTS password_resets (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );

    -- Bridges the two-step 2FA login flow: POST /api/auth/login returns one of these tokens
    -- instead of a session when the account has TOTP enabled, and POST /api/auth/login/verify-totp
    -- trades it (plus a valid code) for the real session. Short-lived and single-use by nature -
    -- deleted as soon as it's redeemed, same as a password reset token.
    CREATE TABLE IF NOT EXISTS totp_challenges (
      token VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    -- Superadmin recovery: when no superadmin can log in but an admin can, that admin can request
    -- that some admin (themselves or another) be promoted to superadmin. It only takes effect once
    -- every OTHER admin approves via a one-time emailed link (superadmin_request_approvals, one
    -- row per required approver) - a single rejection kills the request, same as a single missing
    -- approval just leaves it pending until it expires. See POST /api/superadmin-requests.
    CREATE TABLE IF NOT EXISTS superadmin_requests (
      id VARCHAR(255) PRIMARY KEY,
      target_user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_by VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS superadmin_request_approvals (
      id VARCHAR(255) PRIMARY KEY,
      request_id VARCHAR(255) NOT NULL REFERENCES superadmin_requests(id) ON DELETE CASCADE,
      approver_user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(255) UNIQUE NOT NULL,
      decision VARCHAR(20),
      decided_at TIMESTAMPTZ
    );

    -- Singleton row (id is always 1) holding server-wide settings a superadmin configures from
    -- Settings > Server Settings, so they're editable at runtime instead of being fixed at
    -- container start via env vars (which remain the fallback for a fresh install - see
    -- secrets.env). Named smtp_settings for historical reasons (it started out SMTP-only); holds
    -- the Google Sign-In Client ID too now rather than adding a second singleton table for one
    -- more column.
    CREATE TABLE IF NOT EXISTS smtp_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      smtp_user VARCHAR(255),
      smtp_pass VARCHAR(255),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT smtp_settings_singleton CHECK (id = 1)
    );

    -- Every translatable UI string, one row per (key, locale). Seeded on startup from
    -- translations-seed.js for every locale the app supports - an admin can then edit any value
    -- from the Settings > Translations module without a deploy. Seeding only ever inserts a
    -- missing (key, locale) pair, so it picks up new keys added in code without ever clobbering an
    -- admin's edit to an existing one.
    CREATE TABLE IF NOT EXISTS translations (
      key VARCHAR(255) NOT NULL,
      locale VARCHAR(10) NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (key, locale)
    );

    -- Which locales the app currently offers - admin-managed from Settings > Translations (add a
    -- language, and every existing key is seeded for it from the English text as a starting point;
    -- remove one and its rows in the translations table go with it). "en" can't be removed - it's
    -- the ultimate fallback the UI reaches for when a key is missing in the active locale.
    CREATE TABLE IF NOT EXISTS languages (
      code VARCHAR(10) PRIMARY KEY,
      label VARCHAR(100) NOT NULL
    );

    -- Append-only audit trail for SOX-style record-keeping: every view of a specific record, and
    -- every create/update/delete anywhere in the app, plus authentication events. actor_user_id has
    -- deliberately no foreign key (and actor_email/name/role are a snapshot, not a live join) so a
    -- row stays fully readable even after the user who made it is deleted. There is intentionally no
    -- UPDATE or DELETE route for this table anywhere in the API - only INSERT and read/export - so
    -- the trail can't be edited after the fact, even by an admin.
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor_user_id VARCHAR(255),
      actor_email VARCHAR(255),
      actor_name VARCHAR(255),
      actor_role VARCHAR(50),
      action VARCHAR(20) NOT NULL,
      resource_type VARCHAR(50) NOT NULL,
      resource_id VARCHAR(255),
      resource_label TEXT,
      before_data JSONB,
      after_data JSONB,
      changed_fields JSONB,
      ip_address VARCHAR(64),
      user_agent TEXT
    );

    -- A System Owner's proposed edge/edge-object-detail create/update/delete, when it touches a
    -- system they don't own - held here instead of being written straight to the real tables until
    -- an eligible approver (an admin, or an owner of affected_system_ids) decides it. "payload" is
    -- the exact body the live endpoint would have received; "before_snapshot" is only set for
    -- update/delete, both for display and so the decision endpoint can confirm the resource hasn't
    -- since changed out from under the request before applying it.
    CREATE TABLE IF NOT EXISTS change_requests (
      id VARCHAR(255) PRIMARY KEY,
      requested_by VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(20) NOT NULL,
      resource_type VARCHAR(50) NOT NULL,
      resource_id VARCHAR(255),
      secondary_id VARCHAR(255),
      payload JSONB NOT NULL,
      before_snapshot JSONB,
      affected_system_ids JSONB NOT NULL DEFAULT '[]',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      decided_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      decision_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- In-app notification inbox, one row per (user, event) - always written regardless of the
    -- recipient's email preference (see notify() below), since only the email half of a
    -- notification is ever opt-out-able.
    CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      link_view VARCHAR(50) DEFAULT '',
      link_id VARCHAR(255) DEFAULT '',
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_change_requests_status ON change_requests(status);
    CREATE INDEX IF NOT EXISTS idx_change_requests_requested_by ON change_requests(requested_by);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
    CREATE INDEX IF NOT EXISTS idx_totp_challenges_user ON totp_challenges(user_id);
    CREATE INDEX IF NOT EXISTS idx_superadmin_requests_status ON superadmin_requests(status);
    CREATE INDEX IF NOT EXISTS idx_superadmin_request_approvals_request ON superadmin_request_approvals(request_id);
  `);

  // 'password_reset_requested' (24 chars) has always overflowed the original 20-char limit here,
  // so every one of those audit entries has been silently failing to write (logAudit only
  // console.errors on failure, never throws) - widened while adding further action values of our
  // own. Safe to re-run: widening a varchar that's already >= 50 is a no-op, not an error.
  await pool.query(`ALTER TABLE audit_log ALTER COLUMN action TYPE VARCHAR(50);`);

  // Additive migrations for columns introduced after the initial release. Each is wrapped so
  // re-running on a database that already has the column is a no-op rather than an error.
  const addColumnIfMissing = async (table, definition) => {
    await pool.query(`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE ${table} ADD COLUMN ${definition};
        EXCEPTION
          WHEN duplicate_column THEN NULL;
        END;
      END $$;
    `);
  };

  await addColumnIfMissing('systems', "layout_positions JSONB DEFAULT '{}'");
  await addColumnIfMissing('systems', "status VARCHAR(50) DEFAULT 'active'");
  await addColumnIfMissing('systems', "criticality VARCHAR(50) DEFAULT 'medium'");
  await addColumnIfMissing('systems', "business_capability VARCHAR(255) DEFAULT ''");
  await addColumnIfMissing('systems', "tech_stack JSONB DEFAULT '[]'");
  await addColumnIfMissing('systems', "description TEXT DEFAULT ''");
  await addColumnIfMissing('systems', "time_zone VARCHAR(100) NOT NULL DEFAULT 'UTC'");
  await addColumnIfMissing('systems', "owner_ids JSONB DEFAULT '[]'");
  // Business capability used to be free text (see business_capability above) - now a real,
  // admin-managed list (business_capabilities table) so the Stakeholder canvas view can group
  // systems by it reliably. The old column is left in place (untouched, unused) rather than
  // dropped, both for history and so this migration stays safely re-runnable.
  await addColumnIfMissing('systems', "business_capability_id VARCHAR(255) DEFAULT ''");

  // One-time migration: move each system's old free-text business_capability into a matching row
  // in business_capabilities (creating it if this exact name hasn't been seen yet), then point
  // business_capability_id at it. Safe to re-run - only touches systems that haven't migrated yet
  // (business_capability_id still empty), so it's a no-op after the first successful run.
  const { rows: unmigratedCapabilities } = await pool.query(
    `SELECT DISTINCT business_capability AS name FROM systems
     WHERE business_capability_id = '' AND business_capability <> ''`
  );
  for (const { name } of unmigratedCapabilities) {
    const { rows: existing } = await pool.query('SELECT id FROM business_capabilities WHERE name = $1', [name]);
    const capabilityId = existing[0]?.id || `bcap-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    if (!existing[0]) await pool.query('INSERT INTO business_capabilities (id, name) VALUES ($1, $2)', [capabilityId, name]);
    await pool.query(
      `UPDATE systems SET business_capability_id = $1 WHERE business_capability_id = '' AND business_capability = $2`,
      [capabilityId, name]
    );
  }

  // One-time migration: Owner used to be free text (e.g. "Finance IT Team"), not a real account,
  // so it couldn't drive an email notification when it changed or receive one itself. It's been
  // replaced by owner_ids - a list of actual user accounts, editable by admins/editors and by the
  // system's own current owners. The old text can't be matched to a real account automatically, so
  // it's dropped rather than migrated; an admin re-assigns real owners from here on.
  await pool.query(`ALTER TABLE systems DROP COLUMN IF EXISTS owner;`);

  await addColumnIfMissing('edges', "owner_ids JSONB DEFAULT '[]'");

  await addColumnIfMissing('users', "language VARCHAR(10) NOT NULL DEFAULT 'en'");
  await addColumnIfMissing('users', "time_zone VARCHAR(100)");
  await addColumnIfMissing('users', "nda_accepted_version VARCHAR(20)");
  await addColumnIfMissing('users', "nda_accepted_at TIMESTAMPTZ");
  // Visual style/palette/light-dark-mode preference, previously kept only in the browser's
  // localStorage (so it didn't follow a person between devices) - see the Profile page's
  // Appearance section.
  await addColumnIfMissing('users', "theme_prefs JSONB");
  // Profile picture, stored as a data URI (see PATCH /api/auth/me) rather than a file on disk -
  // this app has no other file storage or static-file serving to build on, and an avatar is small
  // enough (capped well under the raised JSON body limit above) that a DB column is simpler than
  // standing up a file store for one feature.
  await addColumnIfMissing('users', 'avatar_url TEXT');
  // TOTP-based two-factor auth. totp_secret is written as soon as setup starts (POST
  // /api/auth/2fa/setup) but totp_enabled only flips to true once the person proves they can
  // generate a matching code (POST /api/auth/2fa/enable) - so an abandoned setup never gates login.
  // totp_backup_codes is a JSONB array of { hash, usedAt } - bcrypt-hashed like the password, each
  // usable once, for when the authenticator device itself is unavailable.
  await addColumnIfMissing('users', 'totp_secret VARCHAR(64)');
  await addColumnIfMissing('users', 'totp_enabled BOOLEAN NOT NULL DEFAULT false');
  await addColumnIfMissing('users', 'totp_backup_codes JSONB');

  // Per-notification-type email opt-out (see notify() below) - a map like { "owner_added": false }
  // where a missing key or explicit `true` means email stays on for that type; in-app notifications
  // are never opt-out-able, only the emailed copy is.
  await addColumnIfMissing('users', "notification_email_prefs JSONB DEFAULT '{}'");

  // Enough to show a person a human-readable list of their own active sessions (Profile >
  // Sessions) - which browser/device and roughly where from - without storing anything more
  // identifying than the request already carried.
  await addColumnIfMissing('sessions', 'user_agent TEXT');
  await addColumnIfMissing('sessions', 'ip_address VARCHAR(64)');

  await addColumnIfMissing('smtp_settings', 'google_client_id TEXT');

  await addColumnIfMissing('data_objects', "system_object_names JSONB DEFAULT '{}'");
  await addColumnIfMissing('data_objects', "description TEXT DEFAULT ''");
  await addColumnIfMissing('data_objects', "classification VARCHAR(50) DEFAULT 'internal'");

  // One-time migration: the old `aliases` column held a bare systemId -> string map. It's been
  // replaced by `system_object_names`, which pairs each system's name for the object with that
  // system's own object id. Backfill from any pre-existing data, then drop the old column - this
  // whole block no-ops once `aliases` is gone.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'data_objects' AND column_name = 'aliases') THEN
        UPDATE data_objects
        SET system_object_names = COALESCE(system_object_names, '{}'::jsonb) ||
          COALESCE((
            SELECT jsonb_object_agg(key, jsonb_build_object('name', value, 'objectId', ''))
            FROM jsonb_each_text(aliases)
          ), '{}'::jsonb)
        WHERE aliases IS NOT NULL AND aliases != '{}'::jsonb;
        ALTER TABLE data_objects DROP COLUMN aliases;
      END IF;
    END $$;
  `);

  await addColumnIfMissing('edges', "description TEXT DEFAULT ''");
  await addColumnIfMissing('edges', "integration_pattern VARCHAR(50) DEFAULT ''");
  await addColumnIfMissing('edges', "frequency VARCHAR(50) DEFAULT ''");
  await addColumnIfMissing('edges', "integration_type_ids JSONB DEFAULT '[]'");
  await addColumnIfMissing('edges', "integration_software_ids JSONB DEFAULT '[]'");

  await addColumnIfMissing('edge_object_details', "at_risk BOOLEAN DEFAULT false");
  await addColumnIfMissing('edge_object_details', `schedule JSONB NOT NULL DEFAULT '{"kind":"daily","time":"02:00"}'`);

  // One-time migration: frequency used to be a shared admin-maintained list (integration_
  // frequencies) that a flow picked zero or more entries from via `frequency_ids`. It's been
  // replaced by a single mandatory `schedule` defined directly on each flow - every integration
  // must have its own cadence, not point at a shared label. Backfill each flow's schedule from the
  // first frequency it had assigned (if any), then drop the old column and table - this whole
  // block no-ops once `frequency_ids` is gone.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'edge_object_details' AND column_name = 'frequency_ids') THEN
        UPDATE edge_object_details eod
        SET schedule = COALESCE(
          (SELECT f.schedule FROM integration_frequencies f WHERE f.id = eod.frequency_ids->>0),
          eod.schedule
        )
        WHERE jsonb_array_length(eod.frequency_ids) > 0;
        ALTER TABLE edge_object_details DROP COLUMN frequency_ids;
      END IF;
      DROP TABLE IF EXISTS integration_frequencies;
    END $$;
  `);

  await addColumnIfMissing('edge_object_details', "integration_type_id VARCHAR(255) DEFAULT ''");
  await addColumnIfMissing('edge_object_details', "integration_software_id VARCHAR(255) DEFAULT ''");
  await addColumnIfMissing('integration_software', "time_zone VARCHAR(100) NOT NULL DEFAULT 'UTC'");

  // One-time migration: a flow used to be able to carry several Integration Types/Software at
  // once (integration_type_ids/integration_software_ids, JSONB arrays). Each integration now
  // carries at most one of each, so backfill from the first id in each old array (if any), then
  // drop the array columns - this whole block no-ops once they're gone.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'edge_object_details' AND column_name = 'integration_type_ids') THEN
        UPDATE edge_object_details
        SET integration_type_id = COALESCE(integration_type_ids->>0, ''),
            integration_software_id = COALESCE(integration_software_ids->>0, '')
        WHERE jsonb_array_length(integration_type_ids) > 0 OR jsonb_array_length(integration_software_ids) > 0;
        ALTER TABLE edge_object_details DROP COLUMN integration_type_ids;
        ALTER TABLE edge_object_details DROP COLUMN integration_software_ids;
      END IF;
    END $$;
  `);

  // Indexes matter once a landscape has hundreds/thousands of systems - without them, every
  // filter-by-system, filter-by-object, or master-system lookup becomes a full table scan.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    CREATE INDEX IF NOT EXISTS idx_data_objects_master ON data_objects(master_system_id);
    CREATE INDEX IF NOT EXISTS idx_systems_label ON systems(label);
    CREATE INDEX IF NOT EXISTS idx_systems_status ON systems(status);
    CREATE INDEX IF NOT EXISTS idx_systems_criticality ON systems(criticality);
    CREATE INDEX IF NOT EXISTS idx_system_downtimes_system ON system_downtimes(system_id);
  `);

  // Seed the reference lists with sensible starting values on first run only - if an admin
  // has since deleted all entries, that's a deliberate choice and shouldn't be undone on restart.
  const seedIfEmpty = async (table, rows) => {
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM ${table}`);
    if (parseInt(countRows[0].count, 10) > 0) return;
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      const values = columns.map(c => (typeof row[c] === 'object' && row[c] !== null) ? JSON.stringify(row[c]) : row[c]);
      await pool.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
    }
  };

  await seedIfEmpty('integration_types', [
    { id: 'itype-manual', name: 'Manual' },
    { id: 'itype-api', name: 'API Integration' },
    { id: 'itype-file', name: 'File-based Integration' },
  ]);

  await seedIfEmpty('integration_software', [
    { id: 'isw-middleware', name: 'Middleware' },
    { id: 'isw-p2p', name: 'P2P' },
    { id: 'isw-other', name: 'Other' },
  ]);

  await seedIfEmpty('languages', [
    { code: 'en', label: 'English' },
    { code: 'cs', label: 'Čeština' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fi', label: 'Suomi' },
  ]);

  // Seed every (key, locale) pair from the default catalog that doesn't exist yet, for whichever
  // locales are actually offered right now (admin-managed via Settings > Translations - a language
  // added later than this catalog was written just won't have a default here and starts from
  // English instead, copied in by the add-language endpoint). Only ever inserts, so an admin's
  // edit always wins on restart, and a key added to the catalog in a later release still gets its
  // default text without a manual migration.
  const { rows: languageRows } = await pool.query('SELECT code FROM languages');
  const localeCodes = languageRows.map(r => r.code);
  const seedRows = [];
  for (const [key, byLocale] of Object.entries(translationsSeed)) {
    for (const locale of localeCodes) {
      if (byLocale[locale]) seedRows.push([key, locale, byLocale[locale]]);
    }
  }
  if (seedRows.length > 0) {
    const values = [];
    const placeholders = seedRows.map((row, i) => {
      values.push(...row);
      const base = i * 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    });
    await pool.query(
      `INSERT INTO translations (key, locale, value) VALUES ${placeholders.join(', ')} ON CONFLICT (key, locale) DO NOTHING`,
      values
    );
  }

  // One-time migration: 'superadmin' is a new role, introduced after 'admin' already existed -
  // an install that predates it has no superadmin yet, which would leave Server Settings (email +
  // Google Sign-In) and granting further superadmins unreachable by anyone. Promote whichever
  // admin account is oldest, the same way the very first account normally becomes superadmin via
  // POST /api/auth/setup. A no-op once a superadmin exists, on this or any later restart.
  const superadminCountResult = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'superadmin'`);
  if (parseInt(superadminCountResult.rows[0].count, 10) === 0) {
    const oldestAdminResult = await pool.query(`SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`);
    const oldestAdmin = oldestAdminResult.rows[0];
    if (oldestAdmin) {
      await pool.query(`UPDATE users SET role = 'superadmin' WHERE id = $1`, [oldestAdmin.id]);
      console.log(`No super admin existed yet - promoted ${oldestAdmin.name || oldestAdmin.email} (${oldestAdmin.id}) automatically.`);
    }
  }
}

initDB().then(loadServerSettings).catch(console.error);

// ---------------------------------------------------------------------------
// Auth - opaque session tokens stored server-side (not JWTs), so a session can be revoked just by
// deleting its row. Five roles: 'superadmin' (everything an admin can, plus Server Settings -
// email + Google sign-in - and granting/revoking super admin itself), 'admin' (manage the
// landscape and the team), 'editor' (manage the landscape), 'system_owner' (like a viewer
// everywhere, but full write access to systems/objects/downtimes they own, and can create/edit/
// delete edges to or from an owned system - subject to approval whenever the other end of that
// edge is a system they don't own; see resolveEdgeAuthority below), 'viewer' (read-only). ROLES is
// what normal team management (invites, the Members table's role picker) can assign - superadmin
// is deliberately excluded from it; it's only ever granted via PATCH /api/users/:id by an existing
// superadmin, or through the superadmin-recovery process below when none can log in.
const ROLES = ['admin', 'editor', 'system_owner', 'viewer'];
const ALL_ROLES = ['superadmin', ...ROLES];
const isPrivilegedRole = (role) => role === 'admin' || role === 'superadmin';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The locales currently offered, per the admin-managed `languages` table - looked up fresh rather
// than cached, since Settings > Translations can add/remove one at any time.
async function getLanguageCodes() {
  const { rows } = await pool.query('SELECT code FROM languages');
  return rows.map(r => r.code);
}
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour - short-lived since, unlike an invite, this grants access to an existing account
const TOTP_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes - just long enough to type a 6-digit code
const SUPERADMIN_REQUEST_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours - a recovery process, not something anyone should be racing a clock on

// "Sign in with Google" - configurable at runtime from Settings > Server Settings (superadmin
// only) rather than fixed at container start, same as the SMTP sender below - `googleClientId`/
// `googleClient` are mutable module state, seeded from the env var (see secrets.env) as a
// working-out-of-the-box default and then overridden by whatever's stored in the database once a
// superadmin saves one via the API (see `loadServerSettings` and `setGoogleClientId`). Unset by
// default, in which case GET /api/auth/google-config tells the frontend to hide the button
// entirely rather than show a broken one. No client secret is needed: the frontend gets an ID
// token directly from Google's own JS (Google Identity Services), and this just verifies that
// token's signature and audience server-side - it never talks to Google itself.
let googleClientId = process.env.GOOGLE_CLIENT_ID || '';
let googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;
function setGoogleClientId(clientId) {
  googleClientId = clientId || '';
  googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  // Not marked `secure` because this stack is typically served over plain HTTP on a LAN/self-host
  // (see docker-compose.yml) - a secure-only cookie would silently never be sent in that setup.
  secure: false,
  maxAge: SESSION_TTL_MS,
};

const newToken = () => crypto.randomBytes(32).toString('hex');

// Shapes a raw `users` row into what the frontend's ApiUser expects - camelCase, and only the
// fields safe to expose (never password_hash).
function toApiUser(row) {
  if (!row) return null;
  return {
    id: row.id, email: row.email, name: row.name, role: row.role,
    language: row.language || 'en', timeZone: row.time_zone || null,
    ndaAcceptedVersion: row.nda_accepted_version || null,
    themePrefs: row.theme_prefs || null,
    avatarUrl: row.avatar_url || null,
    totpEnabled: row.totp_enabled || false,
    notificationEmailPrefs: row.notification_email_prefs || {},
  };
}

// A stable, non-secret identifier for a session row, safe to hand to the frontend (see GET/DELETE
// /api/auth/sessions) - the real `token` is the session cookie's value and must never leave the
// server. Truncated since it only needs to be unique within one person's small handful of
// sessions, not globally.
function sessionFingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

// Quotes a CSV field only when it needs it (contains a comma, quote, or newline), doubling any
// internal quotes - the inverse of parseCsv below.
function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function csvRow(fields) {
  return fields.map(csvEscape).join(',') + '\r\n';
}

// A small RFC4180-ish CSV parser: quoted fields, embedded commas/newlines inside quotes, and ""
// as an escaped quote. Good enough for a translations export/import round trip without pulling in
// a dependency for it.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // skip - paired \n (or a lone \r) below ends the row
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

async function getSessionUser(req) {
  const token = req.cookies?.sid;
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.language, u.time_zone, u.nda_accepted_version, u.theme_prefs,
            u.avatar_url, u.totp_enabled, u.notification_email_prefs
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return toApiUser(result.rows[0]);
}

async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// superadmin implicitly satisfies every requireRole(...) check, not just requireRole('superadmin')
// - it's a strict superset of every other role's capabilities, so every existing
// requireRole('admin')/requireRole('admin', 'editor') gate already means what it should without
// having to enumerate 'superadmin' at each call site (and a route actually meant to be
// superadmin-exclusive, like Server Settings, just writes requireRole('superadmin') and gets
// that exclusivity for free - superadmin still passes, no one else does).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || (req.user.role !== 'superadmin' && !roles.includes(req.user.role))) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

async function createSession(req, res, userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at, user_agent, ip_address) VALUES ($1, $2, $3, $4, $5)',
    [token, userId, expiresAt, req.get ? (req.get('user-agent') || null) : null, req.ip || null]
  );
  res.cookie('sid', token, COOKIE_OPTS);
}

// Admins can demote/remove other admins freely, but never the very last person who can manage the
// team (admin or superadmin) - otherwise the team could be locked out of user management
// entirely, with no recovery path even through the superadmin-recovery process below (that
// process still needs at least one admin to kick it off).
async function countOtherAdmins(excludeUserId) {
  const result = await pool.query(`SELECT COUNT(*) FROM users WHERE role IN ('admin', 'superadmin') AND id != $1`, [excludeUserId]);
  return parseInt(result.rows[0].count, 10);
}

// Separately, never demote/remove the very last superadmin through normal team management - that
// specific recovery (when the/a superadmin can't log in) is what the superadmin-recovery flow
// below exists for instead of a casual role-picker click.
async function countOtherSuperadmins(excludeUserId) {
  const result = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'superadmin' AND id != $1`, [excludeUserId]);
  return parseInt(result.rows[0].count, 10);
}

// The SMTP sender is admin-configurable at runtime (Settings > Email) rather than fixed at
// container start, so `smtpConfig`/`mailTransporter` are mutable module state instead of
// constants. They start from the env vars (see secrets.env) as a working-out-of-the-box default,
// then get overridden by whatever's stored in `smtp_settings` once a superadmin saves one via the
// API - see `loadServerSettings`, called once `initDB` has created that table.
let smtpConfig = { user: process.env.SMTP_USER || null, pass: process.env.SMTP_PASS || null };
let mailTransporter = null;

function buildTransporter(config) {
  if (!config.user || !config.pass) return null;
  return nodemailer.createTransport({ service: 'gmail', auth: { user: config.user, pass: config.pass } });
}

async function loadServerSettings() {
  try {
    const result = await pool.query('SELECT smtp_user, smtp_pass, google_client_id FROM smtp_settings WHERE id = 1');
    if (result.rows[0]) {
      smtpConfig = { user: result.rows[0].smtp_user, pass: result.rows[0].smtp_pass };
      if (result.rows[0].google_client_id) setGoogleClientId(result.rows[0].google_client_id);
    }
  } catch (err) {
    console.error('Failed to load server settings from the database:', err.message);
  }
  mailTransporter = buildTransporter(smtpConfig);
  if (!mailTransporter) {
    console.warn('Email is not configured - invite emails will not be sent (the invite link can still be copied and shared manually). Configure one in Settings > Server Settings.');
  }
}

async function sendInviteEmail({ to, role, link }) {
  if (!mailTransporter) return { sent: false, reason: 'Email is not configured on the server.' };
  try {
    await mailTransporter.sendMail({
      from: `"EA Designer" <${smtpConfig.user}>`,
      to,
      subject: "You're invited to EA Designer",
      html: `
        <p>You've been invited to join <strong>EA Designer</strong> as a <strong>${role}</strong>.</p>
        <p><a href="${link}">Accept the invitation</a></p>
        <p>Or copy and paste this link into your browser:<br>${link}</p>
        <p style="color:#666;font-size:13px">This invitation expires in 7 days.</p>
      `,
    });
    return { sent: true };
  } catch (err) {
    console.error('Failed to send invite email:', err.message);
    return { sent: false, reason: err.message };
  }
}

async function sendPasswordResetEmail({ to, link }) {
  if (!mailTransporter) return { sent: false, reason: 'Email is not configured on the server.' };
  try {
    await mailTransporter.sendMail({
      from: `"EA Designer" <${smtpConfig.user}>`,
      to,
      subject: 'Reset your EA Designer password',
      html: `
        <p>A password reset was requested for your <strong>EA Designer</strong> account.</p>
        <p><a href="${link}">Reset your password</a></p>
        <p>Or copy and paste this link into your browser:<br>${link}</p>
        <p style="color:#666;font-size:13px">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
      `,
    });
    return { sent: true };
  } catch (err) {
    console.error('Failed to send password reset email:', err.message);
    return { sent: false, reason: err.message };
  }
}

async function sendSuperadminApprovalEmail({ to, targetName, requestedByName, link }) {
  if (!mailTransporter) return { sent: false, reason: 'Email is not configured on the server.' };
  try {
    await mailTransporter.sendMail({
      from: `"EA Designer" <${smtpConfig.user}>`,
      to,
      subject: 'Approval needed: Super Admin recovery on EA Designer',
      html: `
        <p><strong>${requestedByName}</strong> has requested that <strong>${targetName}</strong> be made a Super Admin on <strong>EA Designer</strong>, as part of the recovery process for when no Super Admin can log in.</p>
        <p>This only takes effect once every other admin approves - if you didn't expect this, reject it instead.</p>
        <p><a href="${link}">Review this request</a></p>
        <p>Or copy and paste this link into your browser:<br>${link}</p>
        <p style="color:#666;font-size:13px">This link expires in 48 hours.</p>
      `,
    });
    return { sent: true };
  } catch (err) {
    console.error('Failed to send super admin approval email:', err.message);
    return { sent: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Notifications - a thin dispatcher in front of however a user actually gets reached. Only an
// "email" channel exists today, but every owner-change/single-owner alert below goes through
// notifyUser rather than calling mailTransporter directly, so a future channel (Slack, in-app,
// SMS, ...) plugs in here once instead of at every call site.
// ---------------------------------------------------------------------------
async function notifyUser(user, { subject, html }) {
  if (!user?.email || !mailTransporter) return;
  try {
    await mailTransporter.sendMail({ from: `"EA Designer" <${smtpConfig.user}>`, to: user.email, subject, html });
  } catch (err) {
    console.error(`Failed to notify ${user.email}:`, err.message);
  }
}

// The general-purpose notification entry point every event in the app should go through: always
// writes an in-app inbox row (never opt-out-able), and additionally emails the user via
// notifyUser unless they've turned email off for this specific `type` in their
// notification_email_prefs (a missing entry or explicit `true` means email stays on - opting out
// is the exception, not the default). `user` must include `notification_email_prefs` for the
// opt-out check to see it; callers that only fetched id/email/name should re-select it.
async function notify(user, { type, title, body = '', linkView = '', linkId = '', emailSubject, emailHtml }) {
  if (!user?.id) return;
  const id = `notif-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  try {
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, title, body, link_view, link_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, user.id, type, title, body, linkView, linkId]
    );
  } catch (err) {
    console.error('Failed to write in-app notification:', err.message);
  }
  const prefs = user.notification_email_prefs || {};
  if (prefs[type] !== false) {
    await notifyUser(user, { subject: emailSubject || title, html: emailHtml || `<p>${body}</p>` });
  }
}

async function warnAdminsOfSoleOwner(resourceLabel, soleOwnerId) {
  const [{ rows: admins }, { rows: ownerRows }] = await Promise.all([
    pool.query(`SELECT id, email, name, notification_email_prefs FROM users WHERE role IN ('admin', 'superadmin')`),
    pool.query('SELECT name, email FROM users WHERE id = $1', [soleOwnerId]),
  ]);
  const ownerName = ownerRows[0]?.name || ownerRows[0]?.email || 'someone no longer in the system';
  for (const admin of admins) {
    await notify(admin, {
      type: 'single_owner_warning',
      title: `Single owner: ${resourceLabel}`,
      body: `${resourceLabel} now has only one owner (${ownerName}). Consider adding a backup owner in case they become unavailable.`,
      emailSubject: `Single owner: ${resourceLabel}`,
      emailHtml: `<p><strong>${resourceLabel}</strong> now has only one owner (${ownerName}). Consider adding a backup owner in case they become unavailable.</p>`,
    });
  }
}

// Called after owner_ids changes on a system or edge (integration) - tells everyone whose
// relationship to the resource actually changed (added/removed), tells the owners who stayed that
// the list changed under them, and separately warns every admin if the resource is now down to a
// single owner.
async function notifyOwnerChange(resourceLabel, oldIds, newIds) {
  const added = newIds.filter(id => !oldIds.includes(id));
  const removed = oldIds.filter(id => !newIds.includes(id));
  const remaining = newIds.filter(id => oldIds.includes(id));
  if (added.length === 0 && removed.length === 0) return;

  const allIds = [...new Set([...added, ...removed, ...remaining])];
  const userRows = allIds.length > 0
    ? (await pool.query('SELECT id, email, name, notification_email_prefs FROM users WHERE id = ANY($1)', [allIds])).rows
    : [];
  const byId = Object.fromEntries(userRows.map(u => [u.id, u]));
  const nameOf = (id) => byId[id]?.name || byId[id]?.email || id;

  for (const id of added) {
    await notify(byId[id], {
      type: 'owner_added',
      title: `You're now an owner of ${resourceLabel}`,
      body: `You've been added as an owner of ${resourceLabel}.`,
      emailHtml: `<p>You've been added as an owner of <strong>${resourceLabel}</strong>.</p>`,
    });
  }
  for (const id of removed) {
    await notify(byId[id], {
      type: 'owner_removed',
      title: `You've been removed as an owner of ${resourceLabel}`,
      body: `You're no longer an owner of ${resourceLabel}.`,
      emailHtml: `<p>You're no longer an owner of <strong>${resourceLabel}</strong>.</p>`,
    });
  }
  for (const id of remaining) {
    await notify(byId[id], {
      type: 'owner_list_changed',
      title: `Owner list changed for ${resourceLabel}`,
      body: `Added: ${added.map(nameOf).join(', ') || 'none'}. Removed: ${removed.map(nameOf).join(', ') || 'none'}.`,
      emailHtml: `<p>The owners of <strong>${resourceLabel}</strong> changed.</p><p>Added: ${added.map(nameOf).join(', ') || 'none'}<br>Removed: ${removed.map(nameOf).join(', ') || 'none'}</p>`,
    });
  }

  if (newIds.length === 1) await warnAdminsOfSoleOwner(resourceLabel, newIds[0]);
}

// Lets a non-admin/editor through only when they're currently an owner of this exact resource and
// the request touches nothing but ownerIds - i.e. "manage who else owns this", not general edit
// rights borrowed via ownership.
async function isOwnerManagingOwnersOnly(table, id, userId, body) {
  const keys = Object.keys(body);
  if (keys.length === 0 || !keys.every(k => k === 'ownerIds')) return false;
  const { rows } = await pool.query(`SELECT owner_ids FROM ${table} WHERE id = $1`, [id]);
  const current = rows[0]?.owner_ids || [];
  return current.includes(userId);
}

// Plain "is this user currently listed as an owner of this row" check, unlike
// isOwnerManagingOwnersOnly above (which also requires the request to touch nothing but
// ownerIds) - used by the system_owner role's full-field self-serve checks, where owning the
// resource grants real edit rights, not just the ability to manage who else owns it.
async function isResourceOwner(table, id, userId) {
  if (!id) return false;
  const { rows } = await pool.query(`SELECT owner_ids FROM ${table} WHERE id = $1`, [id]);
  return (rows[0]?.owner_ids || []).includes(userId);
}

// ---------------------------------------------------------------------------
// System Owner approval gating - a system_owner can act on an edge (or a per-object detail on
// one) directly only when they own every system it touches; when they own exactly one endpoint,
// the change is held as a change_requests row until an eligible approver (an admin/superadmin, or
// an owner of the other endpoint) decides it; owning neither endpoint means they have no standing
// to propose it at all. A system with no owner at all still resolves to 'pending', never
// 'self-serve' - an ownerless system stays protected by default, decided by an admin instead.
// ---------------------------------------------------------------------------
async function resolveEdgeAuthority(userId, source, target) {
  const ids = [...new Set([source, target].filter(Boolean))];
  const { rows } = await pool.query('SELECT id, owner_ids FROM systems WHERE id = ANY($1)', [ids]);
  const ownerMap = new Map(rows.map(r => [r.id, r.owner_ids || []]));
  if (ids.some(id => !ownerMap.has(id))) return { mode: 'blocked', affectedSystemIds: [] };

  const owns = (id) => (ownerMap.get(id) || []).includes(userId);
  if (!owns(source) && !owns(target)) return { mode: 'blocked', affectedSystemIds: [] };

  const affectedSystemIds = [...new Set([source, target])].filter(id => !owns(id));
  return { mode: affectedSystemIds.length > 0 ? 'pending' : 'self-serve', affectedSystemIds };
}

// Stores a system_owner's proposed change instead of writing it directly, and notifies every
// eligible approver (every admin/superadmin, plus every current owner of each affected system)
// that it needs a decision. Returns the new change_requests row's id.
async function createChangeRequest(req, { action, resourceType, resourceId, secondaryId = null, payload, beforeSnapshot = null, affectedSystemIds }) {
  const id = `cr-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  await pool.query(
    `INSERT INTO change_requests (id, requested_by, action, resource_type, resource_id, secondary_id, payload, before_snapshot, affected_system_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, req.user.id, action, resourceType, resourceId, secondaryId, JSON.stringify(payload),
      beforeSnapshot ? JSON.stringify(beforeSnapshot) : null, JSON.stringify(affectedSystemIds)]
  );

  const { rows: systemRows } = await pool.query('SELECT id, label, owner_ids FROM systems WHERE id = ANY($1)', [affectedSystemIds]);
  const approverIds = new Set();
  const { rows: adminRows } = await pool.query(`SELECT id FROM users WHERE role IN ('admin', 'superadmin')`);
  adminRows.forEach(r => approverIds.add(r.id));
  systemRows.forEach(s => (s.owner_ids || []).forEach(uid => approverIds.add(uid)));
  approverIds.delete(req.user.id);

  const systemLabel = systemRows.map(s => s.label).join(', ') || affectedSystemIds.join(', ');
  const requesterName = req.user.name || req.user.email;
  if (approverIds.size > 0) {
    const { rows: approvers } = await pool.query(
      'SELECT id, email, name, notification_email_prefs FROM users WHERE id = ANY($1)', [[...approverIds]]
    );
    for (const approver of approvers) {
      notify(approver, {
        type: 'change_request_needs_approval',
        title: `${requesterName} proposed a change affecting ${systemLabel}`,
        body: `A pending ${resourceType === 'edge' ? 'connection' : 'flow detail'} change needs your approval.`,
        linkView: 'approvals',
        linkId: id,
        emailSubject: `Approval needed: change affecting ${systemLabel}`,
        emailHtml: `<p><strong>${requesterName}</strong> proposed a change affecting <strong>${systemLabel}</strong>, which you own or administer.</p><p>Review it in EA Designer's Approvals page.</p>`,
      }).catch(err => console.error('Approval-request notification failed:', err.message));
    }
  }

  await logAudit(req, {
    action: 'create', resourceType: 'change_request', resourceId: id,
    resourceLabel: `${resourceType === 'edge' ? 'Connection' : 'Flow detail'} change affecting ${systemLabel}`,
    after: payload,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Edge/edge-object-detail mutations, extracted out of their route handlers so the exact same SQL
// runs whether a change is applied directly (self-serve) or after a pending change_requests row
// is approved. `actor` lets the approval path attribute the resulting audit entry to the original
// requester rather than the approver (who gets their own separate 'approve' audit entry instead).
// ---------------------------------------------------------------------------
async function applyEdgeCreate(req, e, actor) {
  const ownerIds = Array.isArray(e.ownerIds) && e.ownerIds.length > 0 ? e.ownerIds : [(actor || req.user).id];
  await pool.query(
    `INSERT INTO edges (id, source, target, data_object_ids, description, owner_ids)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.id, e.source, e.target, JSON.stringify(e.dataObjectIds || []), e.description || '', JSON.stringify(ownerIds)]
  );
  const { rows } = await pool.query('SELECT id, label FROM systems WHERE id = ANY($1)', [[e.source, e.target]]);
  const labels = Object.fromEntries(rows.map(r => [r.id, r.label]));
  if (ownerIds.length === 1) {
    warnAdminsOfSoleOwner(`${labels[e.source] || e.source} → ${labels[e.target] || e.target}`, ownerIds[0])
      .catch(err => console.error('Owner notification failed:', err.message));
  }
  await logAudit(req, {
    action: 'create', resourceType: 'edge', resourceId: e.id,
    resourceLabel: `${labels[e.source] || e.source} → ${labels[e.target] || e.target}`,
    after: { ...e, ownerIds }, actor,
  });
}

async function applyEdgeUpdate(req, id, body, actor) {
  const { sets, values } = buildUpdate('edges', EDGE_COLUMNS, body);
  if (sets.length === 0) return { ok: false, status: 400, error: 'No updatable fields provided' };

  const { rows: beforeRows } = await pool.query(
    `SELECT e.*, s1.label AS source_label, s2.label AS target_label
     FROM edges e JOIN systems s1 ON s1.id = e.source JOIN systems s2 ON s2.id = e.target
     WHERE e.id = $1`,
    [id]
  );
  if (beforeRows.length === 0) return { ok: false, status: 404, error: 'Not found' };
  const beforeRow = beforeRows[0];
  const previousOwnerIds = body.ownerIds !== undefined ? (beforeRow.owner_ids || []) : null;
  const edgeLabel = `${beforeRow.source_label} → ${beforeRow.target_label}`;

  values.push(id);
  await pool.query(`UPDATE edges SET ${sets.join(', ')} WHERE id = $${values.length}`, values);

  if (previousOwnerIds !== null) {
    notifyOwnerChange(edgeLabel, previousOwnerIds, body.ownerIds || [])
      .catch(err => console.error('Owner-change notification failed:', err.message));
  }

  const beforeSnapshot = {};
  for (const key of Object.keys(EDGE_COLUMNS)) {
    if (key in body) beforeSnapshot[key] = beforeRow[EDGE_COLUMNS[key]];
  }
  await logAudit(req, { action: 'update', resourceType: 'edge', resourceId: id, resourceLabel: edgeLabel, before: beforeSnapshot, after: body, actor });
  return { ok: true };
}

async function applyEdgeDelete(req, id, actor) {
  const { rows: beforeRows } = await pool.query(
    `SELECT e.*, s1.label AS source_label, s2.label AS target_label
     FROM edges e JOIN systems s1 ON s1.id = e.source JOIN systems s2 ON s2.id = e.target
     WHERE e.id = $1`,
    [id]
  );
  await pool.query('DELETE FROM edges WHERE id = $1', [id]);
  await logAudit(req, {
    action: 'delete', resourceType: 'edge', resourceId: id,
    resourceLabel: beforeRows[0] ? `${beforeRows[0].source_label} → ${beforeRows[0].target_label}` : id,
    before: beforeRows[0] || null, actor,
  });
}

async function applyEdgeObjectDetailUpsert(req, edgeId, objectId, body, actor) {
  const { rows: beforeRows } = await pool.query(
    'SELECT * FROM edge_object_details WHERE edge_id = $1 AND data_object_id = $2', [edgeId, objectId]
  );
  await pool.query(
    `INSERT INTO edge_object_details (edge_id, data_object_id) VALUES ($1, $2)
     ON CONFLICT (edge_id, data_object_id) DO NOTHING`,
    [edgeId, objectId]
  );
  const { sets, values } = buildUpdate('edge_object_details', EDGE_OBJECT_DETAIL_COLUMNS, body);
  if (sets.length > 0) {
    values.push(edgeId, objectId);
    await pool.query(
      `UPDATE edge_object_details SET ${sets.join(', ')} WHERE edge_id = $${values.length - 1} AND data_object_id = $${values.length}`,
      values
    );
  }
  const beforeRow = beforeRows[0] || {};
  const beforeSnapshot = {};
  for (const key of Object.keys(EDGE_OBJECT_DETAIL_COLUMNS)) {
    if (key in body) beforeSnapshot[key] = beforeRow[EDGE_OBJECT_DETAIL_COLUMNS[key]];
  }
  await logAudit(req, {
    action: beforeRows.length > 0 ? 'update' : 'create', resourceType: 'integration_flow', resourceId: `${edgeId}:${objectId}`,
    resourceLabel: `${edgeId} / ${objectId}`, before: beforeRows.length > 0 ? beforeSnapshot : null, after: body, actor,
  });
}

async function applyEdgeObjectDetailDelete(req, edgeId, objectId, actor) {
  const { rows: beforeRows } = await pool.query(
    'SELECT * FROM edge_object_details WHERE edge_id = $1 AND data_object_id = $2', [edgeId, objectId]
  );
  await pool.query(
    'DELETE FROM edge_object_details WHERE edge_id = $1 AND data_object_id = $2',
    [edgeId, objectId]
  );
  await logAudit(req, {
    action: 'delete', resourceType: 'integration_flow', resourceId: `${edgeId}:${objectId}`,
    resourceLabel: `${edgeId} / ${objectId}`, before: beforeRows[0] || null, actor,
  });
}

// ---------------------------------------------------------------------------
// Audit trail - one row per view/create/update/delete/auth event, written best-effort alongside
// (not inside a shared transaction with) the action it records. That's a deliberate trade-off for
// this codebase, which doesn't use per-request transactions anywhere else: a write and its audit
// row are two separate statements, so a crash at the exact instant between them could in theory
// lose the audit row without losing the change. A failure to WRITE the audit row itself never
// blocks or fails the underlying request - `logAudit` only logs to the server console - since a
// logging outage shouldn't also take down the app for every user. `actor` can be passed explicitly
// for the handful of routes that create the acting user in the same request and run before
// `requireAuth` would normally populate `req.user` (setup, accept-invite, login).
async function logAudit(req, { action, resourceType, resourceId = null, resourceLabel = null, before = null, after = null, actor = undefined, metadata = null }) {
  const who = actor !== undefined ? actor : req.user;
  let changedFields = null;
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    changedFields = Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  }
  try {
    await pool.query(
      `INSERT INTO audit_log
        (actor_user_id, actor_email, actor_name, actor_role, action, resource_type, resource_id, resource_label, before_data, after_data, changed_fields, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        who?.id || null, who?.email || null, who?.name || null, who?.role || null,
        action, resourceType, resourceId, resourceLabel,
        before !== null ? JSON.stringify(before) : null,
        after !== null ? JSON.stringify(after) : null,
        changedFields !== null ? JSON.stringify(changedFields) : null,
        req.ip || null,
        req.get ? (req.get('user-agent') || null) : null,
      ]
    );
  } catch (err) {
    console.error('Failed to write audit log entry:', err.message, { action, resourceType, resourceId, metadata });
  }
}

// ---------------------------------------------------------------------------
// Generic helpers for building safe, whitelisted partial UPDATE statements.
// ---------------------------------------------------------------------------
function buildUpdate(table, columnMap, body) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [jsKey, column] of Object.entries(columnMap)) {
    if (!(jsKey in body)) continue;
    const value = body[jsKey];
    sets.push(`${column} = $${i}`);
    values.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
    i++;
  }
  return { sets, values };
}

const SYSTEM_COLUMNS = {
  label: 'label',
  x: 'x',
  y: 'y',
  layoutPositions: 'layout_positions',
  status: 'status',
  criticality: 'criticality',
  businessCapabilityId: 'business_capability_id',
  techStack: 'tech_stack',
  description: 'description',
  timeZone: 'time_zone',
  ownerIds: 'owner_ids',
};

const DATA_OBJECT_COLUMNS = {
  name: 'name',
  masterSystemId: 'master_system_id',
  systemObjectNames: 'system_object_names',
  description: 'description',
  classification: 'classification',
};

const EDGE_COLUMNS = {
  source: 'source',
  target: 'target',
  dataObjectIds: 'data_object_ids',
  description: 'description',
  ownerIds: 'owner_ids',
};

const REFERENCE_LIST_COLUMNS = { name: 'name' };
const SOFTWARE_LIST_COLUMNS = { name: 'name', timeZone: 'time_zone' };

const EDGE_OBJECT_DETAIL_COLUMNS = {
  sourcePattern: 'source_pattern',
  targetPattern: 'target_pattern',
  schedule: 'schedule',
  integrationTypeId: 'integration_type_id',
  integrationSoftwareId: 'integration_software_id',
  atRisk: 'at_risk',
};

const SYSTEM_DOWNTIME_COLUMNS = {
  systemId: 'system_id',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  reason: 'reason',
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Lets the frontend tell a brand-new install (no users yet) apart from a normal login screen.
app.get('/api/auth/bootstrap-status', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    res.json({ needsSetup: parseInt(result.rows[0].count, 10) === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Creates the first account (always an admin). Only works while the team is empty - after that,
// new accounts can only be created by accepting an invite.
app.post('/api/auth/setup', async (req, res) => {
  try {
    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(countResult.rows[0].count, 10) > 0) {
      return res.status(400).json({ error: 'Setup has already been completed - log in instead.' });
    }
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const id = `user-${Date.now()}`;
    // The very first account becomes superadmin, not just admin - someone has to be able to
    // configure Server Settings and grant further superadmins, and there's no one else yet to
    // have granted it to them.
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, 'superadmin') RETURNING *`,
      [id, email.toLowerCase().trim(), passwordHash, name.trim()]
    );
    const newSuperadmin = toApiUser(result.rows[0]);
    await logAudit(req, { actor: newSuperadmin, action: 'create', resourceType: 'user', resourceId: id, resourceLabel: newSuperadmin.name, after: newSuperadmin, metadata: { via: 'initial-setup' } });
    await createSession(req, res, id);
    res.status(201).json(newSuperadmin);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      // No actor to attribute this to - the email may not even belong to a real account - so the
      // attempted address is kept only in resourceLabel, not actor_email, to avoid implying a
      // successful match to a specific person.
      await logAudit(req, { actor: null, action: 'login_failed', resourceType: 'session', resourceLabel: email.toLowerCase().trim() });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    // Password alone isn't enough for an account with 2FA on - hand back a short-lived challenge
    // token instead of a session, and wait for POST /api/auth/login/verify-totp to actually log
    // them in. last_login_at/the session/the audit "login" entry all wait for that second step, so
    // a password-only attempt on a 2FA account never looks like a completed login.
    if (user.totp_enabled) {
      const token = newToken();
      const expiresAt = new Date(Date.now() + TOTP_CHALLENGE_TTL_MS);
      await pool.query('INSERT INTO totp_challenges (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, user.id, expiresAt]);
      return res.json({ requiresTotp: true, challengeToken: token });
    }
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await createSession(req, res, user.id);
    await logAudit(req, { actor: toApiUser(user), action: 'login', resourceType: 'session', resourceId: user.id, resourceLabel: user.name || user.email });
    res.json(toApiUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Completes the login flow above for a 2FA-enabled account: trades a still-valid challenge token
// plus either a current authenticator code or an unused backup code for the real session.
app.post('/api/auth/login/verify-totp', async (req, res) => {
  try {
    const { challengeToken, code } = req.body;
    if (!challengeToken || !code) return res.status(400).json({ error: 'A verification code is required.' });

    const challengeResult = await pool.query('SELECT user_id, expires_at FROM totp_challenges WHERE token = $1', [challengeToken]);
    const challenge = challengeResult.rows[0];
    if (!challenge || new Date(challenge.expires_at) < new Date()) {
      if (challenge) await pool.query('DELETE FROM totp_challenges WHERE token = $1', [challengeToken]);
      return res.status(410).json({ error: 'This login attempt has expired - please log in again.' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [challenge.user_id]);
    const user = userResult.rows[0];
    if (!user || !user.totp_enabled) {
      return res.status(400).json({ error: 'Two-factor authentication is not enabled on this account.' });
    }

    const normalizedCode = String(code).trim();
    let verified = authenticator.check(normalizedCode, user.totp_secret);
    let usedBackupCodeHash = null;
    if (!verified && Array.isArray(user.totp_backup_codes)) {
      for (const entry of user.totp_backup_codes) {
        if (!entry.usedAt && (await bcrypt.compare(normalizedCode, entry.hash))) {
          verified = true;
          usedBackupCodeHash = entry.hash;
          break;
        }
      }
    }

    if (!verified) {
      await logAudit(req, { actor: null, action: 'login_failed', resourceType: 'session', resourceLabel: user.email, metadata: { via: 'totp' } });
      return res.status(401).json({ error: 'Invalid verification code.' });
    }

    if (usedBackupCodeHash) {
      const updatedCodes = user.totp_backup_codes.map(entry =>
        entry.hash === usedBackupCodeHash ? { ...entry, usedAt: new Date().toISOString() } : entry
      );
      await pool.query('UPDATE users SET totp_backup_codes = $1 WHERE id = $2', [JSON.stringify(updatedCodes), user.id]);
    }

    // Only consumed on success - a mistyped code shouldn't force a full restart (re-entering the
    // password) when the person can just try again within the challenge's 5-minute window.
    await pool.query('DELETE FROM totp_challenges WHERE token = $1', [challengeToken]);
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await createSession(req, res, user.id);
    await logAudit(req, {
      actor: toApiUser(user), action: 'login', resourceType: 'session', resourceId: user.id, resourceLabel: user.name || user.email,
      metadata: { via: usedBackupCodeHash ? 'totp_backup_code' : 'totp' },
    });
    res.json(toApiUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public, unauthenticated - the login screen needs to know whether to show the Google button (and
// what Client ID to initialize Google's own JS with) before anyone is signed in.
app.get('/api/auth/google-config', (req, res) => {
  res.json({ enabled: !!googleClient, clientId: googleClientId || null });
});

// Trades a Google ID token (from Google Identity Services on the frontend) for a session, the
// same way POST /api/auth/login trades a password for one. Deliberately sign-in-only, never
// sign-up: an email Google vouches for still has to already belong to an account here (created by
// /api/auth/setup or an accepted invite) - otherwise this would let anyone with a Google account
// create themselves an account, bypassing the invite system entirely.
app.post('/api/auth/google', async (req, res) => {
  try {
    if (!googleClient) return res.status(400).json({ error: 'Google Sign-In is not configured.' });
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Could not verify that Google sign-in.' });
    }
    if (!payload?.email || !payload.email_verified) {
      return res.status(401).json({ error: "Your Google account's email address is not verified." });
    }

    const normalizedEmail = payload.email.toLowerCase().trim();
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user = result.rows[0];
    if (!user) {
      await logAudit(req, { actor: null, action: 'login_failed', resourceType: 'session', resourceLabel: normalizedEmail, metadata: { via: 'google', reason: 'no_account' } });
      return res.status(404).json({ error: 'No account found for this email - ask an admin to invite you.' });
    }

    // A first Google sign-in for an account with no avatar yet gets Google's own profile picture
    // for free - never overwrites a picture the person already chose themselves on the Profile
    // page, and this URL bypasses PATCH /api/auth/me's data:-URI-only validation deliberately,
    // since it comes from the verified token payload rather than user input.
    if (!user.avatar_url && payload.picture) {
      await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [payload.picture, user.id]);
      user.avatar_url = payload.picture;
    }

    // Google having verified this person's identity is step one, same as a correct password -
    // an account with 2FA on still needs step two, via the same challenge/verify-totp flow the
    // password path uses.
    if (user.totp_enabled) {
      const token = newToken();
      const expiresAt = new Date(Date.now() + TOTP_CHALLENGE_TTL_MS);
      await pool.query('INSERT INTO totp_challenges (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, user.id, expiresAt]);
      return res.json({ requiresTotp: true, challengeToken: token });
    }

    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await createSession(req, res, user.id);
    await logAudit(req, {
      actor: toApiUser(user), action: 'login', resourceType: 'session', resourceId: user.id, resourceLabel: user.name || user.email,
      metadata: { via: 'google' },
    });
    res.json(toApiUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.cookies?.sid;
    if (token) {
      const who = await getSessionUser(req);
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
      if (who) await logAudit(req, { actor: who, action: 'logout', resourceType: 'session', resourceId: who.id, resourceLabel: who.name || who.email });
    }
    res.clearCookie('sid', COOKIE_OPTS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Always responds the same way regardless of whether the email matches an account, so this can't
// be used to find out which addresses are registered - a reset link is only actually created and
// emailed when it does. `appUrl` is the frontend's own origin (see /api/invites for why the
// backend can't determine this itself).
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email, appUrl } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const normalizedEmail = email.toLowerCase().trim();
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    const user = userResult.rows[0];

    if (user) {
      // Invalidate any older unused link for this user so only the newest one still works.
      await pool.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);

      const token = newToken();
      const id = `reset-${Date.now()}`;
      const expiresAt = new Date(Date.now() + RESET_TTL_MS);
      await pool.query(
        `INSERT INTO password_resets (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
        [id, user.id, token, expiresAt]
      );

      const base = typeof appUrl === 'string' && appUrl ? appUrl.replace(/\/$/, '') : '';
      const link = `${base}/?reset=${token}`;
      await sendPasswordResetEmail({ to: normalizedEmail, link });
      await logAudit(req, { actor: null, action: 'password_reset_requested', resourceType: 'user', resourceId: user.id, resourceLabel: normalizedEmail });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public lookup used by the reset-password screen to validate the token (and show which account
// it's for) before the user picks a new password.
app.get('/api/reset-password-info/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.expires_at, pr.used_at, u.email FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token = $1`,
      [req.params.token]
    );
    const reset = result.rows[0];
    if (!reset) return res.status(404).json({ error: 'This reset link is invalid.' });
    if (reset.used_at) return res.status(410).json({ error: 'This reset link has already been used.' });
    if (new Date(reset.expires_at) < new Date()) return res.status(410).json({ error: 'This reset link has expired.' });
    res.json({ email: reset.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'A password of at least 8 characters is required.' });
    }
    const result = await pool.query(
      `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.email, u.name, u.role
       FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token = $1`,
      [token]
    );
    const reset = result.rows[0];
    if (!reset) return res.status(404).json({ error: 'This reset link is invalid.' });
    if (reset.used_at) return res.status(410).json({ error: 'This reset link has already been used.' });
    if (new Date(reset.expires_at) < new Date()) return res.status(410).json({ error: 'This reset link has expired.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const updateResult = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *', [passwordHash, reset.user_id]);
    await pool.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);
    // A changed password invalidates every existing session for this account, in case whichever
    // one prompted the reset (a forgotten password, or a suspected compromise) is still live.
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [reset.user_id]);

    await logAudit(req, {
      actor: { id: reset.user_id, email: reset.email, name: reset.name, role: reset.role },
      action: 'password_reset', resourceType: 'user', resourceId: reset.user_id, resourceLabel: reset.name || reset.email,
    });
    await createSession(req, res, reset.user_id);
    res.json(toApiUser(updateResult.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// Self-service update of the caller's own profile fields - any authenticated user (not just
// admins) can set these for themselves, unlike role which stays admin-managed via PATCH
// /api/users/:id. name/email used to be admin-only too, but a person renaming or re-emailing
// themselves doesn't need an admin's involvement any more than picking their own language does.
app.patch('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { language, timeZone, name, email, themePrefs, avatarUrl, notificationEmailPrefs } = req.body;
    if (language !== undefined && !(await getLanguageCodes()).includes(language)) {
      return res.status(400).json({ error: 'Unsupported language.' });
    }
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty.' });
    }
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    // avatarUrl is a data: URI (see src/auth/ProfileView.tsx, which downscales the picked image
    // before sending it) - capped well under the 3mb JSON body limit set above so one oversized
    // upload can't bloat every future response that includes this user.
    if (avatarUrl !== undefined && avatarUrl !== null) {
      if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith('data:image/') || avatarUrl.length > 1_500_000) {
        return res.status(400).json({ error: 'Invalid avatar image.' });
      }
    }
    const sets = [];
    const values = [];
    let i = 1;
    if (language !== undefined) { sets.push(`language = $${i++}`); values.push(language); }
    if (timeZone !== undefined) { sets.push(`time_zone = $${i++}`); values.push(timeZone || null); }
    if (name !== undefined) { sets.push(`name = $${i++}`); values.push(name.trim()); }
    if (email !== undefined) { sets.push(`email = $${i++}`); values.push(email.toLowerCase().trim()); }
    if (themePrefs !== undefined) { sets.push(`theme_prefs = $${i++}`); values.push(themePrefs ? JSON.stringify(themePrefs) : null); }
    if (avatarUrl !== undefined) { sets.push(`avatar_url = $${i++}`); values.push(avatarUrl); }
    // Merged into the existing JSONB (||), not replaced - so toggling one notification type off
    // from one tab/session doesn't clobber every other type's preference set elsewhere.
    if (notificationEmailPrefs !== undefined && typeof notificationEmailPrefs === 'object' && notificationEmailPrefs !== null) {
      sets.push(`notification_email_prefs = COALESCE(notification_email_prefs, '{}'::jsonb) || $${i++}::jsonb`);
      values.push(JSON.stringify(notificationEmailPrefs));
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    values.push(req.user.id);
    const result = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    // themePrefs is deliberately left out of the audit trail - it's not the kind of change anyone
    // reviewing the log needs to see, and its JSON blob would just be noise next to it.
    if (language !== undefined || timeZone !== undefined || name !== undefined || email !== undefined) {
      await logAudit(req, {
        action: 'update', resourceType: 'user', resourceId: req.user.id, resourceLabel: req.user.name || req.user.email,
        before: { language: req.user.language, timeZone: req.user.timeZone, name: req.user.name, email: req.user.email },
        after: { language: result.rows[0].language, timeZone: result.rows[0].time_zone, name: result.rows[0].name, email: result.rows[0].email },
      });
    }
    res.json(toApiUser(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    res.status(500).json({ error: err.message });
  }
});

// Self-service password change while already signed in - proves identity via the current
// password (unlike forgot-password, which proves it via an emailed link instead). Like a reset,
// it invalidates every other session on the account, in case the change was prompted by a
// suspected compromise, but keeps the session making this request alive.
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Current password and a new password of at least 8 characters are required.' });
    }
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(currentPassword, row.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.user.id]);
    const currentToken = req.cookies?.sid;
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [req.user.id, currentToken || '']);
    await logAudit(req, {
      action: 'update', resourceType: 'user', resourceId: req.user.id, resourceLabel: req.user.name || req.user.email,
      metadata: { field: 'password' },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP) - self-service, Profile > Security. Setup writes totp_secret
// immediately but leaves totp_enabled false until /2fa/enable proves the person can actually
// generate a matching code, so an abandoned setup never locks anyone out or silently changes how
// their own login works.
// ---------------------------------------------------------------------------
app.post('/api/auth/2fa/setup', requireAuth, async (req, res) => {
  try {
    const secret = authenticator.generateSecret();
    await pool.query('UPDATE users SET totp_secret = $1, totp_enabled = false, totp_backup_codes = NULL WHERE id = $2', [secret, req.user.id]);
    const otpauthUrl = authenticator.keyuri(req.user.email, 'EA Designer', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    res.json({ secret, otpauthUrl, qrCodeDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex'));
}

app.post('/api/auth/2fa/enable', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    const result = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [req.user.id]);
    const secret = result.rows[0]?.totp_secret;
    if (!secret) return res.status(400).json({ error: 'Start setup first.' });
    if (!code || !authenticator.check(String(code).trim(), secret)) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    const backupCodes = generateBackupCodes();
    const hashed = await Promise.all(backupCodes.map(async c => ({ hash: await bcrypt.hash(c, 10), usedAt: null })));
    await pool.query('UPDATE users SET totp_enabled = true, totp_backup_codes = $1 WHERE id = $2', [JSON.stringify(hashed), req.user.id]);
    await logAudit(req, {
      action: 'update', resourceType: 'user', resourceId: req.user.id, resourceLabel: req.user.name || req.user.email,
      metadata: { field: 'totp_enabled' },
    });
    // Only time the plaintext codes exist outside this function - shown once, the person is
    // expected to save them themselves (same convention as an invite link or a reset link).
    res.json({ backupCodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/2fa/disable', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!password || !(await bcrypt.compare(password, result.rows[0]?.password_hash || ''))) {
      return res.status(401).json({ error: 'Password is incorrect.' });
    }
    await pool.query('UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1', [req.user.id]);
    await logAudit(req, {
      action: 'update', resourceType: 'user', resourceId: req.user.id, resourceLabel: req.user.name || req.user.email,
      metadata: { field: 'totp_disabled' },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Sessions (Profile > Sessions) - list and revoke this person's own active sessions on other
// devices/browsers. Deliberately self-only (no admin view of anyone else's sessions) - this is a
// personal security tool, not a team-management one.
// ---------------------------------------------------------------------------
app.get('/api/auth/sessions', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT token, created_at, expires_at, user_agent, ip_address FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC',
      [req.user.id]
    );
    const currentToken = req.cookies?.sid;
    res.json({
      sessions: result.rows.map(row => ({
        id: sessionFingerprint(row.token),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        userAgent: row.user_agent,
        ipAddress: row.ip_address,
        isCurrent: row.token === currentToken,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/auth/sessions/:id', requireAuth, async (req, res) => {
  try {
    const currentToken = req.cookies?.sid;
    const result = await pool.query('SELECT token FROM sessions WHERE user_id = $1', [req.user.id]);
    const match = result.rows.find(row => sessionFingerprint(row.token) === req.params.id);
    if (!match) return res.status(404).json({ error: 'Session not found.' });
    if (match.token === currentToken) {
      return res.status(400).json({ error: 'Use "Log out" to end this session instead.' });
    }
    await pool.query('DELETE FROM sessions WHERE token = $1', [match.token]);
    await logAudit(req, {
      action: 'update', resourceType: 'user', resourceId: req.user.id, resourceLabel: req.user.name || req.user.email,
      metadata: { field: 'session_revoked' },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Export my data / delete my account (Profile > Danger Zone) - self-service equivalents of
// "download your data" and account deletion, scoped to exactly what this person themselves owns.
// ---------------------------------------------------------------------------
app.get('/api/auth/me/export', requireAuth, async (req, res) => {
  try {
    const ownerMatch = JSON.stringify([req.user.id]);
    const [systemsResult, edgesResult] = await Promise.all([
      pool.query(`SELECT id, label, status, criticality, business_capability_id, description, owner_ids FROM systems WHERE owner_ids @> $1::jsonb`, [ownerMatch]),
      pool.query(`SELECT id, source, target, owner_ids FROM edges WHERE owner_ids @> $1::jsonb`, [ownerMatch]),
    ]);
    res.setHeader('Content-Disposition', 'attachment; filename="ea-designer-my-data.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      profile: req.user,
      systemsYouOwn: systemsResult.rows,
      integrationsYouOwn: edgesResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!password || !(await bcrypt.compare(password, result.rows[0]?.password_hash || ''))) {
      return res.status(401).json({ error: 'Password is incorrect.' });
    }
    if ((req.user.role === 'admin' || req.user.role === 'superadmin') && (await countOtherAdmins(req.user.id)) === 0) {
      return res.status(400).json({ error: 'You are the last remaining admin - promote someone else first.' });
    }
    if (req.user.role === 'superadmin' && (await countOtherSuperadmins(req.user.id)) === 0) {
      return res.status(400).json({ error: 'You are the last remaining super admin - grant someone else super admin first.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    await logAudit(req, {
      action: 'delete', resourceType: 'user', resourceId: req.user.id, resourceLabel: req.user.name || req.user.email,
      metadata: { via: 'self_service' },
    });
    res.clearCookie('sid', COOKIE_OPTS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// NDA acceptance (POC-phase gate) - every signed-in user must accept the current version of
// server/nda.js before the frontend's NdaGate lets them past it into the rest of the app.
// ---------------------------------------------------------------------------
app.get('/api/legal/nda', requireAuth, (req, res) => {
  res.json({ version: nda.version, title: nda.title, text: nda.text });
});

app.post('/api/legal/accept-nda', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE users SET nda_accepted_version = $1, nda_accepted_at = now() WHERE id = $2 RETURNING *',
      [nda.version, req.user.id]
    );
    await logAudit(req, {
      action: 'update', resourceType: 'nda_acceptance', resourceId: req.user.id, resourceLabel: req.user.name || req.user.email,
      before: { ndaAcceptedVersion: req.user.ndaAcceptedVersion }, after: { ndaAcceptedVersion: nda.version },
    });
    res.json(toApiUser(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public lookup used by the "accept invite" screen to validate the token and prefill the email
// and role before the invitee sets a name and password.
app.get('/api/invite-info/:token', async (req, res) => {
  try {
    const result = await pool.query('SELECT email, role, status, expires_at FROM invites WHERE token = $1', [req.params.token]);
    const invite = result.rows[0];
    if (!invite) return res.status(404).json({ error: 'This invite link is invalid.' });
    if (invite.status !== 'pending') return res.status(410).json({ error: 'This invite has already been used or was revoked.' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'This invite has expired.' });
    res.json({ email: invite.email, role: invite.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/accept-invite', async (req, res) => {
  try {
    const { token, name, password } = req.body;
    if (!token || !name || !password || password.length < 8) {
      return res.status(400).json({ error: 'Name and a password of at least 8 characters are required.' });
    }
    const inviteResult = await pool.query('SELECT * FROM invites WHERE token = $1', [token]);
    const invite = inviteResult.rows[0];
    if (!invite) return res.status(404).json({ error: 'This invite link is invalid.' });
    if (invite.status !== 'pending') return res.status(410).json({ error: 'This invite has already been used or was revoked.' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'This invite has expired.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const id = `user-${Date.now()}`;
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, invite.email, passwordHash, name.trim(), invite.role]
    );
    await pool.query(`UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = $1`, [invite.id]);
    const newUser = toApiUser(result.rows[0]);
    await logAudit(req, { actor: newUser, action: 'create', resourceType: 'user', resourceId: id, resourceLabel: newUser.name, after: newUser, metadata: { via: 'invite', inviteId: invite.id } });
    await createSession(req, res, id);
    res.status(201).json(newUser);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    res.status(500).json({ error: err.message });
  }
});

// Every signed-in user (not just admins) can look up who's on the team, just enough to pick
// owners for a system/integration (id/name/email only - no role, invite, or login-history data,
// which stays behind the admin-only /api/users below).
app.get('/api/team-roster', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email FROM users ORDER BY name');
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Users and invites (admin only) - the Settings > Team page.
// ---------------------------------------------------------------------------
app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, last_login_at, nda_accepted_version, nda_accepted_at FROM users ORDER BY created_at ASC'
    );
    res.json({ users: result.rows, ndaVersion: nda.version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { role, name } = req.body;
    if (role && !ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

    const target = await pool.query('SELECT role, name FROM users WHERE id = $1', [req.params.id]);
    const targetCurrentRole = target.rows[0]?.role;

    // Granting or revoking superadmin is a deliberate, superadmin-only action - not something a
    // regular admin can do via the same role picker they use for admin/editor/viewer. (An
    // ordinary admin who genuinely needs this, because no superadmin can log in, has the
    // superadmin-recovery process below instead of this endpoint.)
    if ((role === 'superadmin' || targetCurrentRole === 'superadmin') && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only a super admin can change super admin status.' });
    }

    if (role && role !== 'admin' && role !== 'superadmin') {
      if ((targetCurrentRole === 'admin' || targetCurrentRole === 'superadmin') && (await countOtherAdmins(req.params.id)) === 0) {
        return res.status(400).json({ error: 'Cannot demote the last remaining admin.' });
      }
    }
    if (role && role !== 'superadmin' && targetCurrentRole === 'superadmin') {
      if ((await countOtherSuperadmins(req.params.id)) === 0) {
        return res.status(400).json({ error: 'Cannot demote the last remaining super admin - use the super admin recovery process instead.' });
      }
    }

    const sets = [];
    const values = [];
    let i = 1;
    if (role) { sets.push(`role = $${i++}`); values.push(role); }
    if (name) { sets.push(`name = $${i++}`); values.push(name.trim()); }
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    values.push(req.params.id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    await logAudit(req, {
      action: 'update', resourceType: 'user', resourceId: req.params.id, resourceLabel: name?.trim() || target.rows[0]?.name || req.params.id,
      before: { role: target.rows[0]?.role, name: target.rows[0]?.name },
      after: { role: role || target.rows[0]?.role, name: name?.trim() || target.rows[0]?.name },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const target = await pool.query('SELECT email, name, role FROM users WHERE id = $1', [req.params.id]);
    const targetRole = target.rows[0]?.role;
    if (targetRole === 'superadmin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only a super admin can remove a super admin.' });
    }
    if ((targetRole === 'admin' || targetRole === 'superadmin') && (await countOtherAdmins(req.params.id)) === 0) {
      return res.status(400).json({ error: 'Cannot remove the last remaining admin.' });
    }
    if (targetRole === 'superadmin' && (await countOtherSuperadmins(req.params.id)) === 0) {
      return res.status(400).json({ error: 'Cannot remove the last remaining super admin - use the super admin recovery process instead.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await logAudit(req, {
      action: 'delete', resourceType: 'user', resourceId: req.params.id, resourceLabel: target.rows[0]?.name || target.rows[0]?.email || req.params.id,
      before: target.rows[0] || null,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invites', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, token, status, created_at, expires_at FROM invites WHERE status = 'pending' ORDER BY created_at DESC`
    );
    res.json({ invites: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// `appUrl` is the origin the invite link should point back to (e.g. http://192.168.1.5:80) - the
// backend has no reliable way to know the browser-facing address itself, so the frontend supplies
// its own `window.location.origin`.
app.post('/api/invites', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { email, role, appUrl } = req.body;
    if (!email || !ROLES.includes(role)) return res.status(400).json({ error: 'A valid email and role are required.' });
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existingUser.rows[0]) return res.status(409).json({ error: 'This person already has an account.' });

    // Revoke any older pending invite for the same email so there's only ever one live link per person.
    await pool.query(`UPDATE invites SET status = 'revoked' WHERE email = $1 AND status = 'pending'`, [normalizedEmail]);

    const token = newToken();
    const id = `invite-${Date.now()}`;
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await pool.query(
      `INSERT INTO invites (id, email, role, token, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, normalizedEmail, role, token, req.user.id, expiresAt]
    );

    const base = typeof appUrl === 'string' && appUrl ? appUrl.replace(/\/$/, '') : '';
    const link = `${base}/?invite=${token}`;
    const emailResult = await sendInviteEmail({ to: normalizedEmail, role, link });

    await logAudit(req, { action: 'create', resourceType: 'invite', resourceId: id, resourceLabel: normalizedEmail, after: { email: normalizedEmail, role } });
    res.status(201).json({ id, email: normalizedEmail, role, link, emailSent: emailResult.sent, emailError: emailResult.reason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/invites/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const target = await pool.query('SELECT email, role FROM invites WHERE id = $1', [req.params.id]);
    await pool.query(`UPDATE invites SET status = 'revoked' WHERE id = $1`, [req.params.id]);
    await logAudit(req, { action: 'delete', resourceType: 'invite', resourceId: req.params.id, resourceLabel: target.rows[0]?.email || req.params.id, before: target.rows[0] || null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Super Admin recovery - lets an ordinary admin (not a superadmin) request that some admin
// (themselves or another) be promoted to superadmin, for when no superadmin can log in. The
// approval group is deliberately every OTHER user with role = 'admin' only - never superadmins,
// since the whole scenario this exists for is "no superadmin is reachable". A single admin's
// rejection kills the request; if the requester is the only admin, it's approved immediately with
// no emails needed. See sendSuperadminApprovalEmail above for the emailed link's shape.
// ---------------------------------------------------------------------------
app.post('/api/superadmin-requests', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { targetUserId, appUrl } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'A target user is required.' });

    const targetResult = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [targetUserId]);
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role !== 'admin') return res.status(400).json({ error: 'Only an existing admin can be promoted through this process.' });

    const otherAdminsResult = await pool.query(`SELECT id, name, email FROM users WHERE role = 'admin' AND id != $1`, [req.user.id]);
    const otherAdmins = otherAdminsResult.rows;

    const requestId = `sar-${Date.now()}`;
    const expiresAt = new Date(Date.now() + SUPERADMIN_REQUEST_TTL_MS);

    if (otherAdmins.length === 0) {
      // The requester is the only admin - there's no one left to ask, so their own request is
      // all the approval this can ever get.
      await pool.query(
        `INSERT INTO superadmin_requests (id, target_user_id, requested_by, status, expires_at, resolved_at) VALUES ($1, $2, $3, 'approved', $4, now())`,
        [requestId, target.id, req.user.id, expiresAt]
      );
      await pool.query(`UPDATE users SET role = 'superadmin' WHERE id = $1`, [target.id]);
      await logAudit(req, {
        action: 'update', resourceType: 'user', resourceId: target.id, resourceLabel: target.name || target.email,
        before: { role: 'admin' }, after: { role: 'superadmin' }, metadata: { via: 'superadmin_recovery', requestId, autoApproved: true },
      });
      return res.status(201).json({ requestId, status: 'approved', totalApprovers: 0, autoApproved: true });
    }

    await pool.query(
      `INSERT INTO superadmin_requests (id, target_user_id, requested_by, status, expires_at) VALUES ($1, $2, $3, 'pending', $4)`,
      [requestId, target.id, req.user.id, expiresAt]
    );

    let emailsSent = 0;
    for (const approver of otherAdmins) {
      const token = newToken();
      await pool.query(
        `INSERT INTO superadmin_request_approvals (id, request_id, approver_user_id, token) VALUES ($1, $2, $3, $4)`,
        [`sara-${Date.now()}-${approver.id}`, requestId, approver.id, token]
      );
      const base = typeof appUrl === 'string' && appUrl ? appUrl.replace(/\/$/, '') : '';
      const link = `${base}/?superadmin-approve=${token}`;
      const result = await sendSuperadminApprovalEmail({ to: approver.email, targetName: target.name || target.email, requestedByName: req.user.name || req.user.email, link });
      if (result.sent) emailsSent++;
    }

    await logAudit(req, {
      action: 'create', resourceType: 'superadmin_request', resourceId: requestId, resourceLabel: target.name || target.email,
      metadata: { targetUserId: target.id, totalApprovers: otherAdmins.length },
    });
    res.status(201).json({ requestId, status: 'pending', totalApprovers: otherAdmins.length, emailsSent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/superadmin-requests', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const requestsResult = await pool.query(`
      SELECT r.id, r.status, r.created_at, r.expires_at, r.resolved_at,
             t.id AS target_id, t.name AS target_name, t.email AS target_email,
             b.id AS requested_by_id, b.name AS requested_by_name, b.email AS requested_by_email
      FROM superadmin_requests r
      JOIN users t ON t.id = r.target_user_id
      JOIN users b ON b.id = r.requested_by
      ORDER BY r.created_at DESC LIMIT 20
    `);
    const approvalsResult = await pool.query(`
      SELECT a.request_id, a.decision, a.decided_at, u.name AS approver_name, u.email AS approver_email
      FROM superadmin_request_approvals a
      JOIN users u ON u.id = a.approver_user_id
      WHERE a.request_id = ANY($1::text[])
    `, [requestsResult.rows.map(r => r.id)]);

    const requests = requestsResult.rows.map(r => ({
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      resolvedAt: r.resolved_at,
      target: { id: r.target_id, name: r.target_name, email: r.target_email },
      requestedBy: { id: r.requested_by_id, name: r.requested_by_name, email: r.requested_by_email },
      approvals: approvalsResult.rows
        .filter(a => a.request_id === r.id)
        .map(a => ({ approverName: a.approver_name, approverEmail: a.approver_email, decision: a.decision, decidedAt: a.decided_at })),
    }));
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/superadmin-requests/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`UPDATE superadmin_requests SET status = 'cancelled', resolved_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Request not found or already resolved.' });
    await logAudit(req, { action: 'update', resourceType: 'superadmin_request', resourceId: req.params.id, resourceLabel: req.params.id, metadata: { field: 'cancelled' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public (token-only, like an invite/reset link) - the approval landing page reached from the
// emailed link, before deciding.
app.get('/api/superadmin-requests/approvals/:token', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.decision, r.status, r.expires_at, t.name AS target_name, t.email AS target_email,
             b.name AS requested_by_name, b.email AS requested_by_email
      FROM superadmin_request_approvals a
      JOIN superadmin_requests r ON r.id = a.request_id
      JOIN users t ON t.id = r.target_user_id
      JOIN users b ON b.id = r.requested_by
      WHERE a.token = $1
    `, [req.params.token]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'This approval link is invalid.' });
    res.json({
      targetName: row.target_name, targetEmail: row.target_email,
      requestedByName: row.requested_by_name, requestedByEmail: row.requested_by_email,
      requestStatus: row.status, expiresAt: row.expires_at, alreadyDecided: row.decision !== null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/superadmin-requests/approvals/:token/decide', async (req, res) => {
  try {
    const { decision } = req.body;
    if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: 'Invalid decision.' });

    const approvalResult = await pool.query(
      `SELECT a.id, a.decision AS existing_decision, a.request_id, r.status AS request_status, r.expires_at, r.target_user_id,
              u.id AS approver_id, u.name AS approver_name, u.email AS approver_email, u.role AS approver_role
       FROM superadmin_request_approvals a
       JOIN superadmin_requests r ON r.id = a.request_id
       JOIN users u ON u.id = a.approver_user_id
       WHERE a.token = $1`,
      [req.params.token]
    );
    const approval = approvalResult.rows[0];
    if (!approval) return res.status(404).json({ error: 'This approval link is invalid.' });
    if (approval.request_status !== 'pending') return res.status(410).json({ error: 'This request has already been resolved.' });
    if (new Date(approval.expires_at) < new Date()) {
      await pool.query(`UPDATE superadmin_requests SET status = 'expired', resolved_at = now() WHERE id = $1`, [approval.request_id]);
      return res.status(410).json({ error: 'This request has expired.' });
    }
    if (approval.existing_decision) return res.status(400).json({ error: 'You have already responded to this request.' });

    const approver = { id: approval.approver_id, name: approval.approver_name, email: approval.approver_email, role: approval.approver_role };
    // Stored past-tense ('approved'/'rejected') to match superadmin_requests.status, since the
    // completion check just below compares against 'approved' - the request body's 'decision'
    // field itself stays present-tense ('approve'/'reject'), matching the verb on the button.
    const storedDecision = decision === 'approve' ? 'approved' : 'rejected';
    await pool.query(`UPDATE superadmin_request_approvals SET decision = $1, decided_at = now() WHERE id = $2`, [storedDecision, approval.id]);

    if (decision === 'reject') {
      await pool.query(`UPDATE superadmin_requests SET status = 'rejected', resolved_at = now() WHERE id = $1`, [approval.request_id]);
      await logAudit(req, { actor: approver, action: 'update', resourceType: 'superadmin_request', resourceId: approval.request_id, resourceLabel: approval.request_id, metadata: { field: 'rejected' } });
      return res.json({ status: 'rejected' });
    }

    const remainingResult = await pool.query(
      `SELECT COUNT(*) FROM superadmin_request_approvals WHERE request_id = $1 AND (decision IS NULL OR decision != 'approved')`,
      [approval.request_id]
    );
    const allApproved = parseInt(remainingResult.rows[0].count, 10) === 0;

    if (!allApproved) {
      await logAudit(req, { actor: approver, action: 'update', resourceType: 'superadmin_request', resourceId: approval.request_id, resourceLabel: approval.request_id, metadata: { field: 'approved_partial' } });
      return res.json({ status: 'pending' });
    }

    const targetResult = await pool.query(`UPDATE users SET role = 'superadmin' WHERE id = $1 RETURNING id, name, email`, [approval.target_user_id]);
    await pool.query(`UPDATE superadmin_requests SET status = 'approved', resolved_at = now() WHERE id = $1`, [approval.request_id]);
    await logAudit(req, {
      actor: approver, action: 'update', resourceType: 'user', resourceId: approval.target_user_id, resourceLabel: targetResult.rows[0]?.name || targetResult.rows[0]?.email,
      before: { role: 'admin' }, after: { role: 'superadmin' }, metadata: { via: 'superadmin_recovery', requestId: approval.request_id },
    });
    res.json({ status: 'approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Server Settings (superadmin only) - the Gmail SMTP sender used for invite/reset/recovery
// emails, editable at runtime from Settings instead of being fixed at container start. The
// password is write-only: it's never returned once saved, only whether one is configured and
// which address it's for. Google Sign-In's Client ID lives right below, same permission tier -
// both are server-wide config an ordinary admin shouldn't be able to change.
// ---------------------------------------------------------------------------
app.get('/api/settings/email', requireAuth, requireRole('superadmin'), (req, res) => {
  res.json({ configured: !!mailTransporter, smtpUser: smtpConfig.user || null });
});

app.put('/api/settings/email', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const smtpUser = typeof req.body.smtpUser === 'string' ? req.body.smtpUser.trim() : '';
    const smtpPassInput = typeof req.body.smtpPass === 'string' ? req.body.smtpPass.trim() : '';
    if (!smtpUser) return res.status(400).json({ error: 'A sender email address is required.' });

    // Blank password on an already-configured address means "keep what's already saved" - the
    // frontend never has the real value to redisplay, so it can't just resend it unchanged.
    const smtpPass = smtpPassInput || (smtpUser === smtpConfig.user ? smtpConfig.pass : '');
    if (!smtpPass) return res.status(400).json({ error: 'An app password is required.' });

    const candidate = buildTransporter({ user: smtpUser, pass: smtpPass });
    try {
      await candidate.verify();
    } catch (verifyErr) {
      return res.status(400).json({ error: `Couldn't authenticate with these credentials: ${verifyErr.message}` });
    }

    await pool.query(
      `INSERT INTO smtp_settings (id, smtp_user, smtp_pass, updated_at, updated_by) VALUES (1, $1, $2, now(), $3)
       ON CONFLICT (id) DO UPDATE SET smtp_user = $1, smtp_pass = $2, updated_at = now(), updated_by = $3`,
      [smtpUser, smtpPass, req.user.id]
    );

    const previousSmtpUser = smtpConfig.user;
    smtpConfig = { user: smtpUser, pass: smtpPass };
    mailTransporter = candidate;
    // Never log the password itself, even in before/after - only which sender address is configured.
    await logAudit(req, { action: 'update', resourceType: 'settings_email', resourceId: 'smtp', resourceLabel: 'SMTP sender', before: { smtpUser: previousSmtpUser }, after: { smtpUser } });
    res.json({ configured: true, smtpUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/settings/email', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const previousSmtpUser = smtpConfig.user;
    // Clears only the SMTP columns, not the whole singleton row - it also holds the Google Client
    // ID now, which this action has nothing to do with.
    await pool.query('UPDATE smtp_settings SET smtp_user = NULL, smtp_pass = NULL WHERE id = 1');
    smtpConfig = { user: null, pass: null };
    mailTransporter = null;
    await logAudit(req, { action: 'delete', resourceType: 'settings_email', resourceId: 'smtp', resourceLabel: 'SMTP sender', before: { smtpUser: previousSmtpUser } });
    res.json({ configured: false, smtpUser: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings/google', requireAuth, requireRole('superadmin'), (req, res) => {
  res.json({ configured: !!googleClient, clientId: googleClientId || null });
});

app.put('/api/settings/google', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const clientId = typeof req.body.clientId === 'string' ? req.body.clientId.trim() : '';
    await pool.query(
      `INSERT INTO smtp_settings (id, google_client_id, updated_at, updated_by) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET google_client_id = $1, updated_at = now(), updated_by = $2`,
      [clientId || null, req.user.id]
    );
    const previousClientId = googleClientId;
    setGoogleClientId(clientId);
    await logAudit(req, {
      action: 'update', resourceType: 'settings_google', resourceId: 'google', resourceLabel: 'Google Sign-In',
      before: { clientId: previousClientId || null }, after: { clientId: googleClientId || null },
    });
    res.json({ configured: !!googleClient, clientId: googleClientId || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Aggregate read - used to hydrate the canvas in one round trip.
// ---------------------------------------------------------------------------
app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const systemsRes = await pool.query('SELECT * FROM systems ORDER BY label');
    const objectsRes = await pool.query('SELECT * FROM data_objects ORDER BY name');
    const edgesRes = await pool.query('SELECT * FROM edges');
    const integrationTypesRes = await pool.query('SELECT * FROM integration_types ORDER BY name');
    const integrationSoftwareRes = await pool.query('SELECT * FROM integration_software ORDER BY name');
    const businessCapabilitiesRes = await pool.query('SELECT * FROM business_capabilities ORDER BY name');
    const edgeObjectDetailsRes = await pool.query('SELECT * FROM edge_object_details');
    const systemDowntimesRes = await pool.query('SELECT * FROM system_downtimes ORDER BY starts_at');

    res.json({
      systems: systemsRes.rows,
      dataObjects: objectsRes.rows,
      edges: edgesRes.rows,
      integrationTypes: integrationTypesRes.rows,
      integrationSoftware: integrationSoftwareRes.rows,
      businessCapabilities: businessCapabilitiesRes.rows,
      edgeObjectDetails: edgeObjectDetailsRes.rows,
      systemDowntimes: systemDowntimesRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

// Paginated, filterable listing - the primary way to browse a large landscape (the Inventory
// view), rather than trying to render thousands of boxes on one canvas.
app.get('/api/systems', requireAuth, async (req, res) => {
  try {
    const { search, status, criticality, businessCapabilityId, limit = '50', offset = '0' } = req.query;
    const clauses = [];
    const values = [];
    let i = 1;

    if (search) {
      // Owner is a list of user ids now, not free text - matching by owner means matching one of
      // those users' name/email via a correlated subquery rather than a plain column ILIKE.
      // Business capability is now a managed list (business_capabilities) rather than free text,
      // so matching by it means matching the joined row's name, not the systems column itself.
      clauses.push(`(
        systems.label ILIKE $${i} OR bc.name ILIKE $${i} OR EXISTS (
          SELECT 1 FROM users u
          WHERE u.id IN (SELECT jsonb_array_elements_text(systems.owner_ids))
          AND (u.name ILIKE $${i} OR u.email ILIKE $${i})
        )
      )`);
      values.push(`%${search}%`);
      i++;
    }
    if (status) {
      clauses.push(`systems.status = $${i}`);
      values.push(status);
      i++;
    }
    if (criticality) {
      clauses.push(`systems.criticality = $${i}`);
      values.push(criticality);
      i++;
    }
    if (businessCapabilityId) {
      // The Inventory/canvas "Uncategorized" filter option sends this sentinel for systems with
      // no capability assigned, since an empty string can't be told apart from "no filter" in a
      // query param - matches the same convention as the Stakeholder view's uncategorized bucket.
      if (businessCapabilityId === '__uncategorized__') {
        clauses.push(`(systems.business_capability_id IS NULL OR systems.business_capability_id = '')`);
      } else {
        clauses.push(`systems.business_capability_id = $${i}`);
        values.push(businessCapabilityId);
        i++;
      }
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const fromClause = `FROM systems LEFT JOIN business_capabilities bc ON bc.id = systems.business_capability_id`;

    const rows = await pool.query(
      `SELECT systems.* ${fromClause} ${where} ORDER BY systems.label LIMIT $${i} OFFSET $${i + 1}`,
      [...values, safeLimit, safeOffset]
    );
    const count = await pool.query(`SELECT COUNT(*) ${fromClause} ${where}`, values);

    res.json({ systems: rows.rows, total: parseInt(count.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/systems', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const s = req.body;
    // Default to the creator as the sole initial owner rather than leaving a brand-new system
    // ownerless - it'll immediately trip the single-owner admin warning, which is the right nudge
    // to add a backup rather than a bug.
    const ownerIds = Array.isArray(s.ownerIds) && s.ownerIds.length > 0 ? s.ownerIds : [req.user.id];
    await pool.query(
      `INSERT INTO systems (id, label, x, y, layout_positions, status, criticality, business_capability_id, tech_stack, description, time_zone, owner_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        s.id, s.label, s.x, s.y,
        JSON.stringify(s.layoutPositions || {}),
        s.status || 'active', s.criticality || 'medium',
        s.businessCapabilityId || '', JSON.stringify(s.techStack || []), s.description || '', s.timeZone || 'UTC',
        JSON.stringify(ownerIds)
      ]
    );
    if (ownerIds.length === 1) {
      warnAdminsOfSoleOwner(s.label, ownerIds[0]).catch(err => console.error('Owner notification failed:', err.message));
    }
    await logAudit(req, { action: 'create', resourceType: 'system', resourceId: s.id, resourceLabel: s.label, after: { ...s, ownerIds } });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Not gated to admin/editor alone: a system's own current owners can also update its owner_ids
// (and only that field) from here, per isOwnerManagingOwnersOnly. A system_owner who owns this
// system gets full-field access instead (never just ownerIds) - editing a system's own fields
// only ever touches that one system, so it's always self-serve, never queued for approval.
app.patch('/api/systems/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'system_owner') {
      if (!(await isResourceOwner('systems', req.params.id, req.user.id))) {
        return res.status(403).json({ error: 'You do not have permission to do this' });
      }
    } else if (!['admin', 'editor'].includes(req.user.role)) {
      const allowed = await isOwnerManagingOwnersOnly('systems', req.params.id, req.user.id, req.body);
      if (!allowed) return res.status(403).json({ error: 'You do not have permission to do this' });
    }

    const { sets, values } = buildUpdate('systems', SYSTEM_COLUMNS, req.body);
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    // Always fetched (not just when ownerIds changes) - it's both the owner-notification baseline
    // and the audit trail's "before" snapshot of whichever fields this request actually touches.
    const { rows: beforeRows } = await pool.query('SELECT * FROM systems WHERE id = $1', [req.params.id]);
    const beforeRow = beforeRows[0] || {};
    const previousOwnerIds = req.body.ownerIds !== undefined ? (beforeRow.owner_ids || []) : null;
    const systemLabel = req.body.label || beforeRow.label || req.params.id;

    values.push(req.params.id);
    await pool.query(`UPDATE systems SET ${sets.join(', ')} WHERE id = $${values.length}`, values);

    if (previousOwnerIds !== null) {
      notifyOwnerChange(systemLabel, previousOwnerIds, req.body.ownerIds || [])
        .catch(err => console.error('Owner-change notification failed:', err.message));
    }

    const beforeSnapshot = {};
    for (const key of Object.keys(SYSTEM_COLUMNS)) {
      if (key in req.body) beforeSnapshot[key] = beforeRow[SYSTEM_COLUMNS[key]];
    }
    await logAudit(req, { action: 'update', resourceType: 'system', resourceId: req.params.id, resourceLabel: systemLabel, before: beforeSnapshot, after: req.body });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/systems/:id', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const { rows: beforeRows } = await pool.query('SELECT * FROM systems WHERE id = $1', [req.params.id]);
    // ON DELETE CASCADE on data_objects.master_system_id and edges.source/target handles cleanup.
    await pool.query('DELETE FROM systems WHERE id = $1', [req.params.id]);
    await logAudit(req, { action: 'delete', resourceType: 'system', resourceId: req.params.id, resourceLabel: beforeRows[0]?.label || req.params.id, before: beforeRows[0] || null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Data objects
// ---------------------------------------------------------------------------
app.get('/api/data-objects', requireAuth, async (req, res) => {
  try {
    const { search, masterSystemId, limit = '50', offset = '0' } = req.query;
    const clauses = [];
    const values = [];
    let i = 1;

    if (search) {
      clauses.push(`name ILIKE $${i}`);
      values.push(`%${search}%`);
      i++;
    }
    if (masterSystemId) {
      clauses.push(`master_system_id = $${i}`);
      values.push(masterSystemId);
      i++;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const rows = await pool.query(
      `SELECT * FROM data_objects ${where} ORDER BY name LIMIT $${i} OFFSET $${i + 1}`,
      [...values, safeLimit, safeOffset]
    );
    const count = await pool.query(`SELECT COUNT(*) FROM data_objects ${where}`, values);

    res.json({ dataObjects: rows.rows, total: parseInt(count.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A system_owner may only create an object mastered by a system they own - unlike edges, this
// never needs approval, since creating an object only ever touches the one system that masters
// it, never another one.
app.post('/api/data-objects', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    const o = req.body;
    if (req.user.role === 'system_owner' && !(await isResourceOwner('systems', o.masterSystemId, req.user.id))) {
      return res.status(403).json({ error: 'You can only create objects mastered by a system you own.' });
    }
    await pool.query(
      `INSERT INTO data_objects (id, name, master_system_id, system_object_names, description, classification)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [o.id, o.name, o.masterSystemId, JSON.stringify(o.systemObjectNames || {}), o.description || '', o.classification || 'internal']
    );
    await logAudit(req, { action: 'create', resourceType: 'data_object', resourceId: o.id, resourceLabel: o.name, after: o });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A system_owner may edit any field of an object whose CURRENT master system they own, full
// self-serve (no approval - it only touches that one system). Reassigning masterSystemId to a
// system they don't own is simply blocked, not queued for approval - a rare enough case that it's
// out of scope for the approval workflow.
app.patch('/api/data-objects/:id', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    if (req.user.role === 'system_owner') {
      const { rows: currentRows } = await pool.query('SELECT master_system_id FROM data_objects WHERE id = $1', [req.params.id]);
      if (currentRows.length === 0) return res.status(404).json({ error: 'Not found' });
      if (!(await isResourceOwner('systems', currentRows[0].master_system_id, req.user.id))) {
        return res.status(403).json({ error: 'You do not have permission to do this' });
      }
      if (req.body.masterSystemId && req.body.masterSystemId !== currentRows[0].master_system_id
        && !(await isResourceOwner('systems', req.body.masterSystemId, req.user.id))) {
        return res.status(403).json({ error: 'You can only reassign this object to a system you own.' });
      }
    }

    const { sets, values } = buildUpdate('data_objects', DATA_OBJECT_COLUMNS, req.body);
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    const { rows: beforeRows } = await pool.query('SELECT * FROM data_objects WHERE id = $1', [req.params.id]);
    const beforeRow = beforeRows[0] || {};
    values.push(req.params.id);
    await pool.query(`UPDATE data_objects SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    const beforeSnapshot = {};
    for (const key of Object.keys(DATA_OBJECT_COLUMNS)) {
      if (key in req.body) beforeSnapshot[key] = beforeRow[DATA_OBJECT_COLUMNS[key]];
    }
    await logAudit(req, { action: 'update', resourceType: 'data_object', resourceId: req.params.id, resourceLabel: req.body.name || beforeRow.name || req.params.id, before: beforeSnapshot, after: req.body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/data-objects/:id', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    const { rows: beforeRows } = await pool.query('SELECT * FROM data_objects WHERE id = $1', [req.params.id]);
    if (beforeRows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'system_owner' && !(await isResourceOwner('systems', beforeRows[0].master_system_id, req.user.id))) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }

    await pool.query('DELETE FROM data_objects WHERE id = $1', [req.params.id]);

    // data_object_ids on an edge is a plain JSONB array, not a foreign key, so deleting the object
    // doesn't cascade into it - strip it out of every edge that carried it here, with this route's
    // own authority, rather than as separate client-issued edge PATCH/DELETE calls. Those would be
    // evaluated as the caller's own edge permissions once edges are ownership/approval-gated, which
    // could 403 or spawn a surprise approval for what is meant to be plain, self-serve object
    // deletion.
    const { rows: affectedEdges } = await pool.query(
      `SELECT e.id, e.data_object_ids, s1.label AS source_label, s2.label AS target_label
       FROM edges e JOIN systems s1 ON s1.id = e.source JOIN systems s2 ON s2.id = e.target
       WHERE e.data_object_ids @> $1::jsonb`,
      [JSON.stringify([req.params.id])]
    );
    for (const edge of affectedEdges) {
      const remaining = (edge.data_object_ids || []).filter(id => id !== req.params.id);
      const edgeLabel = `${edge.source_label} → ${edge.target_label}`;
      if (remaining.length === 0) {
        await pool.query('DELETE FROM edges WHERE id = $1', [edge.id]);
        await logAudit(req, { action: 'delete', resourceType: 'edge', resourceId: edge.id, resourceLabel: edgeLabel, metadata: { cascadedFromObjectDelete: req.params.id } });
      } else {
        await pool.query('UPDATE edges SET data_object_ids = $1 WHERE id = $2', [JSON.stringify(remaining), edge.id]);
        await logAudit(req, { action: 'update', resourceType: 'edge', resourceId: edge.id, resourceLabel: edgeLabel, after: { dataObjectIds: remaining }, metadata: { cascadedFromObjectDelete: req.params.id } });
      }
    }

    await logAudit(req, { action: 'delete', resourceType: 'data_object', resourceId: req.params.id, resourceLabel: beforeRows[0]?.name || req.params.id, before: beforeRows[0] || null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Edges (integrations)
// ---------------------------------------------------------------------------
app.get('/api/edges', requireAuth, async (req, res) => {
  try {
    const { systemId, objectId } = req.query;
    const clauses = [];
    const values = [];
    let i = 1;

    if (systemId) {
      clauses.push(`(source = $${i} OR target = $${i})`);
      values.push(systemId);
      i++;
    }
    if (objectId) {
      clauses.push(`data_object_ids @> $${i}::jsonb`);
      values.push(JSON.stringify([objectId]));
      i++;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await pool.query(`SELECT * FROM edges ${where}`, values);
    res.json({ edges: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/edges', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    const e = req.body;
    if (req.user.role === 'system_owner') {
      const gate = await resolveEdgeAuthority(req.user.id, e.source, e.target);
      if (gate.mode === 'blocked') return res.status(403).json({ error: 'You must own at least one end of this connection to propose it.' });
      if (gate.mode === 'pending') {
        const changeRequestId = await createChangeRequest(req, {
          action: 'create', resourceType: 'edge', resourceId: e.id, payload: e, affectedSystemIds: gate.affectedSystemIds,
        });
        return res.status(202).json({ success: true, pending: true, changeRequestId });
      }
    }
    await applyEdgeCreate(req, e);
    res.status(201).json({ success: true, pending: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Not gated to a fixed role list alone: an integration's own current owners can also update its
// owner_ids (and only that field) from here, per isOwnerManagingOwnersOnly - a system_owner gets
// richer access than that (full-field edit, subject to approval) via resolveEdgeAuthority instead;
// everyone else stays admin/editor-only.
app.patch('/api/edges/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'system_owner') {
      const { rows: currentRows } = await pool.query('SELECT source, target FROM edges WHERE id = $1', [req.params.id]);
      if (currentRows.length === 0) return res.status(404).json({ error: 'Not found' });
      const gate = await resolveEdgeAuthority(req.user.id, currentRows[0].source, currentRows[0].target);
      if (gate.mode === 'blocked') return res.status(403).json({ error: 'You do not have permission to do this' });
      if (gate.mode === 'pending') {
        const changeRequestId = await createChangeRequest(req, {
          action: 'update', resourceType: 'edge', resourceId: req.params.id, payload: req.body, affectedSystemIds: gate.affectedSystemIds,
        });
        return res.status(202).json({ success: true, pending: true, changeRequestId });
      }
      // self-serve (owns both endpoints) - fall through to apply directly below
    } else if (!['admin', 'editor'].includes(req.user.role)) {
      const allowed = await isOwnerManagingOwnersOnly('edges', req.params.id, req.user.id, req.body);
      if (!allowed) return res.status(403).json({ error: 'You do not have permission to do this' });
    }

    const result = await applyEdgeUpdate(req, req.params.id, req.body);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, pending: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/edges/:id', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    if (req.user.role === 'system_owner') {
      const { rows: currentRows } = await pool.query('SELECT source, target FROM edges WHERE id = $1', [req.params.id]);
      if (currentRows.length === 0) return res.status(404).json({ error: 'Not found' });
      const gate = await resolveEdgeAuthority(req.user.id, currentRows[0].source, currentRows[0].target);
      if (gate.mode === 'blocked') return res.status(403).json({ error: 'You do not have permission to do this' });
      if (gate.mode === 'pending') {
        const changeRequestId = await createChangeRequest(req, {
          action: 'delete', resourceType: 'edge', resourceId: req.params.id, payload: {}, affectedSystemIds: gate.affectedSystemIds,
        });
        return res.status(202).json({ success: true, pending: true, changeRequestId });
      }
    }
    await applyEdgeDelete(req, req.params.id);
    res.json({ success: true, pending: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// How one specific data object moves over one specific edge - upserted lazily the first time any
// of its fields is set, since most (edge, object) pairs never get more than the defaults. Gated by
// the parent edge's own ownership, not any ownership of its own - it has none.
app.patch('/api/edges/:edgeId/objects/:objectId', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    const { edgeId, objectId } = req.params;
    if (req.user.role === 'system_owner') {
      const { rows: edgeRows } = await pool.query('SELECT source, target FROM edges WHERE id = $1', [edgeId]);
      if (edgeRows.length === 0) return res.status(404).json({ error: 'Not found' });
      const gate = await resolveEdgeAuthority(req.user.id, edgeRows[0].source, edgeRows[0].target);
      if (gate.mode === 'blocked') return res.status(403).json({ error: 'You do not have permission to do this' });
      if (gate.mode === 'pending') {
        const changeRequestId = await createChangeRequest(req, {
          action: 'update', resourceType: 'edge_object_detail', resourceId: edgeId, secondaryId: objectId,
          payload: req.body, affectedSystemIds: gate.affectedSystemIds,
        });
        return res.status(202).json({ success: true, pending: true, changeRequestId });
      }
    }
    await applyEdgeObjectDetailUpsert(req, edgeId, objectId, req.body);
    res.json({ success: true, pending: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/edges/:edgeId/objects/:objectId', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    const { edgeId, objectId } = req.params;
    if (req.user.role === 'system_owner') {
      const { rows: edgeRows } = await pool.query('SELECT source, target FROM edges WHERE id = $1', [edgeId]);
      if (edgeRows.length === 0) return res.status(404).json({ error: 'Not found' });
      const gate = await resolveEdgeAuthority(req.user.id, edgeRows[0].source, edgeRows[0].target);
      if (gate.mode === 'blocked') return res.status(403).json({ error: 'You do not have permission to do this' });
      if (gate.mode === 'pending') {
        const changeRequestId = await createChangeRequest(req, {
          action: 'delete', resourceType: 'edge_object_detail', resourceId: edgeId, secondaryId: objectId,
          payload: {}, affectedSystemIds: gate.affectedSystemIds,
        });
        return res.status(202).json({ success: true, pending: true, changeRequestId });
      }
    }
    await applyEdgeObjectDetailDelete(req, edgeId, objectId);
    res.json({ success: true, pending: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Import / Export - move a hand-picked slice of the landscape (not necessarily all of it) between
// environments as a single self-contained JSON bundle, e.g. from a local dev instance to the NAS.
// Three-step flow, split across three endpoints because conflicts (an id that already exists in
// the target environment) must be resolved by a person in the UI before anything is written:
//   1. POST /api/export           - pick systems/objects/edges, get back a bundle.
//   2. POST /api/import/preview   - upload that bundle, get back a new-vs-conflict diff.
//   3. POST /api/import/commit    - upload the bundle again plus how every conflict was resolved.
// ---------------------------------------------------------------------------

const EXPORT_FORMAT_VERSION = 1;

// An exported bundle must be importable on its own, so a selection is expanded to include
// everything it structurally depends on: an edge pulls in its two endpoint systems and every
// object it carries, and an object pulls in its master system. This only ever adds rows a
// selected row already points to - selecting a system on its own does NOT pull in its edges, so
// "export just these two systems" stays exactly that.
async function resolveExportClosure(systemIds, dataObjectIds, edgeIds) {
  const systems = new Set(systemIds);
  const objects = new Set(dataObjectIds);
  const edgeSet = new Set(edgeIds);

  if (edgeSet.size > 0) {
    const { rows } = await pool.query('SELECT id, source, target, data_object_ids FROM edges WHERE id = ANY($1)', [[...edgeSet]]);
    for (const e of rows) {
      if (e.source) systems.add(e.source);
      if (e.target) systems.add(e.target);
      (e.data_object_ids || []).forEach(id => objects.add(id));
    }
  }
  if (objects.size > 0) {
    const { rows } = await pool.query('SELECT id, master_system_id FROM data_objects WHERE id = ANY($1)', [[...objects]]);
    for (const o of rows) {
      if (o.master_system_id) systems.add(o.master_system_id);
    }
  }

  return { systemIds: [...systems], dataObjectIds: [...objects], edgeIds: [...edgeSet] };
}

// Read-only, and everything in the bundle is already visible to any signed-in role via the
// regular GET endpoints - exporting it as one file doesn't expose anything new, so this only
// requires being signed in, not admin/editor.
// A system_owner may only export systems they own, edges touching one, and objects mastered by
// (or carried by an edge touching) one - "anything to do with the system he owns," not the whole
// landscape. Defense-in-depth behind the frontend picker, which should only ever offer them this
// same set to begin with.
async function computeSystemOwnerExportAllowlist(userId) {
  const { rows: ownedRows } = await pool.query('SELECT id FROM systems WHERE owner_ids @> $1::jsonb', [JSON.stringify([userId])]);
  const ownedSystemIds = ownedRows.map(r => r.id);
  const { rows: edgeRows } = ownedSystemIds.length
    ? await pool.query('SELECT id, data_object_ids FROM edges WHERE source = ANY($1) OR target = ANY($1)', [ownedSystemIds])
    : { rows: [] };
  const allowedObjectIds = new Set();
  edgeRows.forEach(e => (e.data_object_ids || []).forEach(id => allowedObjectIds.add(id)));
  const { rows: objectRows } = ownedSystemIds.length
    ? await pool.query('SELECT id FROM data_objects WHERE master_system_id = ANY($1)', [ownedSystemIds])
    : { rows: [] };
  objectRows.forEach(o => allowedObjectIds.add(o.id));
  return {
    allowedSystemIds: new Set(ownedSystemIds),
    allowedEdgeIds: new Set(edgeRows.map(e => e.id)),
    allowedObjectIds,
  };
}

app.post('/api/export', requireAuth, async (req, res) => {
  try {
    const systemIds = Array.isArray(req.body.systemIds) ? req.body.systemIds : [];
    const dataObjectIds = Array.isArray(req.body.dataObjectIds) ? req.body.dataObjectIds : [];
    const edgeIds = Array.isArray(req.body.edgeIds) ? req.body.edgeIds : [];
    if (systemIds.length === 0 && dataObjectIds.length === 0 && edgeIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one system, data object, or edge to export.' });
    }

    if (req.user.role === 'system_owner') {
      const allow = await computeSystemOwnerExportAllowlist(req.user.id);
      const disallowed = [
        ...systemIds.filter(id => !allow.allowedSystemIds.has(id)),
        ...dataObjectIds.filter(id => !allow.allowedObjectIds.has(id)),
        ...edgeIds.filter(id => !allow.allowedEdgeIds.has(id)),
      ];
      if (disallowed.length > 0) {
        return res.status(400).json({ error: 'You can only export systems, objects, and edges related to a system you own.' });
      }
    }

    const closure = await resolveExportClosure(systemIds, dataObjectIds, edgeIds);

    const [systemsRes, objectsRes, edgesRes] = await Promise.all([
      closure.systemIds.length ? pool.query('SELECT * FROM systems WHERE id = ANY($1) ORDER BY label', [closure.systemIds]) : Promise.resolve({ rows: [] }),
      closure.dataObjectIds.length ? pool.query('SELECT * FROM data_objects WHERE id = ANY($1) ORDER BY name', [closure.dataObjectIds]) : Promise.resolve({ rows: [] }),
      closure.edgeIds.length ? pool.query('SELECT * FROM edges WHERE id = ANY($1)', [closure.edgeIds]) : Promise.resolve({ rows: [] }),
    ]);

    const edgeObjectDetailsRes = closure.edgeIds.length
      ? await pool.query('SELECT * FROM edge_object_details WHERE edge_id = ANY($1)', [closure.edgeIds])
      : { rows: [] };

    const typeIds = [...new Set(edgeObjectDetailsRes.rows.map(d => d.integration_type_id).filter(Boolean))];
    const softwareIds = [...new Set(edgeObjectDetailsRes.rows.map(d => d.integration_software_id).filter(Boolean))];
    const capabilityIds = [...new Set(systemsRes.rows.map(s => s.business_capability_id).filter(Boolean))];
    const [typesRes, softwareRes, capabilitiesRes] = await Promise.all([
      typeIds.length ? pool.query('SELECT * FROM integration_types WHERE id = ANY($1)', [typeIds]) : Promise.resolve({ rows: [] }),
      softwareIds.length ? pool.query('SELECT * FROM integration_software WHERE id = ANY($1)', [softwareIds]) : Promise.resolve({ rows: [] }),
      capabilityIds.length ? pool.query('SELECT * FROM business_capabilities WHERE id = ANY($1)', [capabilityIds]) : Promise.resolve({ rows: [] }),
    ]);

    await logAudit(req, {
      action: 'export', resourceType: 'import_export',
      resourceLabel: `${systemsRes.rows.length} systems, ${objectsRes.rows.length} objects, ${edgesRes.rows.length} edges`,
      after: { systemIds: closure.systemIds, dataObjectIds: closure.dataObjectIds, edgeIds: closure.edgeIds },
    });

    res.json({
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: { id: req.user.id, name: req.user.name, email: req.user.email },
      systems: systemsRes.rows,
      dataObjects: objectsRes.rows,
      edges: edgesRes.rows,
      edgeObjectDetails: edgeObjectDetailsRes.rows,
      integrationTypes: typesRes.rows,
      integrationSoftware: softwareRes.rows,
      businessCapabilities: capabilitiesRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Summarizes one entity's fields for side-by-side display in the conflict-resolution UI - not the
// full row, just enough for a person to tell whether the incoming version is the same thing, an
// update, or a completely different entity that happens to reuse the same id.
const summarizeSystem = (s, labelOf) => ({
  label: s.label, status: s.status, criticality: s.criticality,
  businessCapability: labelOf.capability(s.business_capability_id) || '', description: s.description || '',
});
const summarizeObject = (o, labelOf) => ({
  name: o.name, masterSystem: labelOf.system(o.master_system_id) || o.master_system_id || '',
  classification: o.classification, description: o.description || '',
});
const summarizeEdge = (e, labelOf) => ({
  source: labelOf.system(e.source) || e.source, target: labelOf.system(e.target) || e.target,
  description: e.description || '', objects: (e.data_object_ids || []).map(id => labelOf.object(id) || id).join(', '),
});

async function diffEntity(table, incomingRows, summarize) {
  const ids = incomingRows.map(r => r.id).filter(Boolean);
  const existingRows = ids.length ? (await pool.query(`SELECT * FROM ${table} WHERE id = ANY($1)`, [ids])).rows : [];
  const existingById = new Map(existingRows.map(r => [r.id, r]));
  const result = { new: [], conflicts: [] };
  for (const incoming of incomingRows) {
    const existing = existingById.get(incoming.id);
    if (!existing) {
      result.new.push({ id: incoming.id, summary: summarize(incoming) });
    } else {
      result.conflicts.push({
        id: incoming.id,
        incoming: summarize(incoming),
        existing: summarize(existing),
        identical: JSON.stringify(incoming) === JSON.stringify(existing),
      });
    }
  }
  return result;
}

app.post('/api/import/preview', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const bundle = req.body.bundle;
    if (!bundle || typeof bundle !== 'object') return res.status(400).json({ error: 'That file is not a valid EA Designer export.' });
    const incomingSystems = Array.isArray(bundle.systems) ? bundle.systems : [];
    const incomingObjects = Array.isArray(bundle.dataObjects) ? bundle.dataObjects : [];
    const incomingEdges = Array.isArray(bundle.edges) ? bundle.edges : [];

    // A label lookup that knows about both what's already here and what's in the bundle, so an
    // edge between two brand-new systems (or an object mastered by one) still shows real names
    // instead of raw ids in the preview - not just whichever half happens to exist locally yet.
    const systemLabelById = new Map((await pool.query('SELECT id, label FROM systems')).rows.map(r => [r.id, r.label]));
    incomingSystems.forEach(s => { if (!systemLabelById.has(s.id)) systemLabelById.set(s.id, s.label); });
    const objectNameById = new Map((await pool.query('SELECT id, name FROM data_objects')).rows.map(r => [r.id, r.name]));
    incomingObjects.forEach(o => { if (!objectNameById.has(o.id)) objectNameById.set(o.id, o.name); });
    const incomingCapabilities = Array.isArray(bundle.businessCapabilities) ? bundle.businessCapabilities : [];
    const capabilityNameById = new Map((await pool.query('SELECT id, name FROM business_capabilities')).rows.map(r => [r.id, r.name]));
    incomingCapabilities.forEach(c => { if (!capabilityNameById.has(c.id)) capabilityNameById.set(c.id, c.name); });
    const labelOf = {
      system: (id) => systemLabelById.get(id), object: (id) => objectNameById.get(id),
      capability: (id) => capabilityNameById.get(id),
    };

    const [systems, dataObjects, edges] = await Promise.all([
      diffEntity('systems', incomingSystems, (s) => summarizeSystem(s, labelOf)),
      diffEntity('data_objects', incomingObjects, (o) => summarizeObject(o, labelOf)),
      diffEntity('edges', incomingEdges, (e) => summarizeEdge(e, labelOf)),
    ]);

    res.json({ systems, dataObjects, edges });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Applies a bundle, honoring a resolution ('override' | 'skip' | 'rename', with an optional
// newLabel/newName for 'rename') supplied per conflicting id. Anything not already present locally
// is simply new and gets inserted regardless of what (if anything) `resolutions` says about it -
// only an actual id collision needs a decision, and the UI is expected to have collected one for
// every conflict before calling this. Any conflict left unresolved anyway defaults to 'skip', the
// only non-destructive option, rather than silently overwriting existing data.
app.post('/api/import/commit', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const bundle = req.body.bundle;
    const resolutions = req.body.resolutions || {};
    if (!bundle || typeof bundle !== 'object') return res.status(400).json({ error: 'That file is not a valid EA Designer export.' });
    const isSystemOwnerImport = req.user.role === 'system_owner';

    const incomingSystems = Array.isArray(bundle.systems) ? bundle.systems : [];
    const incomingObjects = Array.isArray(bundle.dataObjects) ? bundle.dataObjects : [];
    const incomingEdges = Array.isArray(bundle.edges) ? bundle.edges : [];
    const incomingDetails = Array.isArray(bundle.edgeObjectDetails) ? bundle.edgeObjectDetails : [];
    const incomingTypes = Array.isArray(bundle.integrationTypes) ? bundle.integrationTypes : [];
    const incomingSoftware = Array.isArray(bundle.integrationSoftware) ? bundle.integrationSoftware : [];
    const incomingCapabilities = Array.isArray(bundle.businessCapabilities) ? bundle.businessCapabilities : [];

    const freshId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    // Works out, for one entity type, the final id every incoming row should be written under (or
    // null if it's being skipped entirely) and which final ids are an UPDATE of an existing row
    // rather than a plain INSERT. A row whose id doesn't already exist locally is never a conflict
    // and only ever supports 'skip' (the UI lets a person exclude a "new" row from the import
    // without it needing to collide with anything first) - 'override'/'rename' only mean something
    // once there's an existing row to override or rename away from.
    const planEntity = (rows, existingIds, resKind, prefix) => {
      const idMap = new Map();
      const overwrite = new Set();
      const relabel = new Map();
      for (const row of rows) {
        const decision = resolutions[resKind]?.[row.id];
        if (!existingIds.has(row.id)) {
          idMap.set(row.id, decision?.action === 'skip' ? null : row.id);
          continue;
        }
        if (decision?.action === 'override') {
          idMap.set(row.id, row.id);
          overwrite.add(row.id);
        } else if (decision?.action === 'rename') {
          const newId = freshId(prefix);
          idMap.set(row.id, newId);
          if (decision.newLabel) relabel.set(newId, decision.newLabel);
        } else {
          idMap.set(row.id, null);
        }
      }
      return { idMap, overwrite, relabel };
    };
    // Resolves a reference to another entity in the bundle (e.g. an edge's source system id) to
    // wherever that entity actually ended up: unchanged for a new/overridden row, remapped for a
    // renamed one, and unchanged for anything skipped or outside the bundle entirely - both of
    // those cases mean "this id already exists locally under its original id", which is exactly
    // what falling through to the original id gives us.
    const remap = (plan, id) => (id ? (plan.idMap.get(id) ?? id) : id);

    const existingSystemIds = new Set((await client.query('SELECT id FROM systems')).rows.map(r => r.id));
    const existingObjectIds = new Set((await client.query('SELECT id FROM data_objects')).rows.map(r => r.id));
    const existingEdgeIds = new Set((await client.query('SELECT id FROM edges')).rows.map(r => r.id));

    // System Owner pre-pass, computed entirely from committed DB state and done BEFORE BEGIN -
    // forces `resolutions` toward 'skip' for anything not permitted, and pulls any edge that needs
    // approval out of the direct-write path entirely (queued in pendingEdgeQueue, turned into real
    // change_requests rows only after COMMIT succeeds below). This has to happen up front, not by
    // catching a foreign-key error mid-transaction: letting a not-permitted row reach an INSERT
    // would roll back every other row in the same commit, including ones that were legitimately
    // allowed (see the FK-violation comment on the catch block at the end of this route).
    const pendingEdgeQueue = []; // { edge, isNew, affectedSystemIds, details }
    if (isSystemOwnerImport) {
      // System Owners can never provision brand-new systems via import (nor edit an existing one
      // through it - system fields are edited directly, not imported) - skip every 'systems' row
      // unconditionally, regardless of what the client's own resolution said.
      resolutions.systems = Object.fromEntries(incomingSystems.map(s => [s.id, { action: 'skip' }]));

      const { rows: ownedRows } = await client.query('SELECT id FROM systems WHERE owner_ids @> $1::jsonb', [JSON.stringify([req.user.id])]);
      const ownedSystemIds = new Set(ownedRows.map(r => r.id));

      const { rows: currentObjectRows } = incomingObjects.length
        ? await client.query('SELECT id, master_system_id FROM data_objects WHERE id = ANY($1)', [incomingObjects.map(o => o.id)])
        : { rows: [] };
      const currentObjectMaster = new Map(currentObjectRows.map(r => [r.id, r.master_system_id]));
      resolutions.dataObjects = resolutions.dataObjects || {};
      for (const o of incomingObjects) {
        const relevantMaster = existingObjectIds.has(o.id) ? currentObjectMaster.get(o.id) : o.master_system_id;
        if (!ownedSystemIds.has(relevantMaster)) resolutions.dataObjects[o.id] = { action: 'skip' };
      }

      const { rows: currentEdgeRows } = incomingEdges.length
        ? await client.query('SELECT id, source, target FROM edges WHERE id = ANY($1)', [incomingEdges.map(e => e.id)])
        : { rows: [] };
      const currentEdgeById = new Map(currentEdgeRows.map(r => [r.id, r]));
      resolutions.edges = resolutions.edges || {};
      for (const e of incomingEdges) {
        const current = currentEdgeById.get(e.id);
        const source = current ? current.source : e.source;
        const target = current ? current.target : e.target;
        const gate = await resolveEdgeAuthority(req.user.id, source, target);
        if (gate.mode === 'blocked') {
          resolutions.edges[e.id] = { action: 'skip' };
        } else if (gate.mode === 'pending') {
          resolutions.edges[e.id] = { action: 'skip' }; // never written directly in this pass
          pendingEdgeQueue.push({
            edge: e,
            isNew: !existingEdgeIds.has(e.id),
            affectedSystemIds: gate.affectedSystemIds,
            details: incomingDetails.filter(d => d.edge_id === e.id),
          });
        }
        // 'self-serve' (owns both endpoints): leave resolutions.edges[e.id] exactly as the client
        // sent it (or unset, meaning "create normally") - no override needed.
      }
    }

    const systemPlan = planEntity(incomingSystems, existingSystemIds, 'systems', 'sys');
    const objectPlan = planEntity(incomingObjects, existingObjectIds, 'dataObjects', 'obj');
    const edgePlan = planEntity(incomingEdges, existingEdgeIds, 'edges', 'edge');

    const auditEntries = [];
    const created = { systems: 0, dataObjects: 0, edges: 0 };
    const updated = { systems: 0, dataObjects: 0, edges: 0 };
    const skipped = { systems: 0, dataObjects: 0, edges: 0 };
    // Populated as systems are written below, so the edges loop can show real labels (e.g. in its
    // own audit entry) for every endpoint, not just ones that happened to be renamed.
    const systemLabelByFinalId = new Map();

    await client.query('BEGIN');

    // Integration Type/Software/Business Capability are shared admin-maintained tag lists, not
    // entities with real identity of their own, so they don't go through the same conflict UI - an
    // incoming tag is matched to a local one by id first, then by name (case-insensitively), and
    // only creates a new row if neither matches. This is a merge, never an overwrite: an existing
    // tag's name is never changed by an import. Run before the systems loop below (unlike
    // type/software, which only need to be resolved once the edges/details loops reach them further
    // down) since a system row itself needs its business_capability_id remapped through this merge.
    const mergeReferenceList = async (table, incomingRows) => {
      const idMap = new Map();
      for (const row of incomingRows) {
        if (!row?.id) continue;
        const byId = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [row.id]);
        if (byId.rows.length > 0) { idMap.set(row.id, row.id); continue; }
        const byName = await client.query(`SELECT id FROM ${table} WHERE lower(name) = lower($1)`, [row.name]);
        if (byName.rows.length > 0) { idMap.set(row.id, byName.rows[0].id); continue; }
        if (table === 'integration_software') {
          await client.query('INSERT INTO integration_software (id, name, time_zone) VALUES ($1, $2, $3)', [row.id, row.name, row.time_zone || 'UTC']);
        } else {
          await client.query(`INSERT INTO ${table} (id, name) VALUES ($1, $2)`, [row.id, row.name]);
        }
        idMap.set(row.id, row.id);
      }
      return idMap;
    };
    const typeIdMap = await mergeReferenceList('integration_types', incomingTypes);
    const softwareIdMap = await mergeReferenceList('integration_software', incomingSoftware);
    const capabilityIdMap = await mergeReferenceList('business_capabilities', incomingCapabilities);

    for (const s of incomingSystems) {
      const finalId = systemPlan.idMap.get(s.id);
      if (!finalId) { skipped.systems++; continue; }
      const label = systemPlan.relabel.get(finalId) || s.label;
      systemLabelByFinalId.set(finalId, label);
      const capabilityId = s.business_capability_id ? (capabilityIdMap.get(s.business_capability_id) || s.business_capability_id) : '';
      const values = [
        finalId, label, s.x || 0, s.y || 0, JSON.stringify(s.layout_positions || {}),
        s.status || 'active', s.criticality || 'medium', capabilityId,
        JSON.stringify(s.tech_stack || []), s.description || '', s.time_zone || 'UTC',
      ];
      if (systemPlan.overwrite.has(finalId)) {
        await client.query(
          `UPDATE systems SET label=$2, x=$3, y=$4, layout_positions=$5, status=$6, criticality=$7,
                              business_capability_id=$8, tech_stack=$9, description=$10, time_zone=$11
           WHERE id=$1`,
          values
        );
        updated.systems++;
        auditEntries.push({ action: 'update', resourceType: 'system', resourceId: finalId, resourceLabel: label, after: s });
      } else {
        await client.query(
          `INSERT INTO systems (id, label, x, y, layout_positions, status, criticality, business_capability_id, tech_stack, description, time_zone, owner_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'[]')`,
          values
        );
        created.systems++;
        auditEntries.push({ action: 'create', resourceType: 'system', resourceId: finalId, resourceLabel: label, after: s });
      }
    }

    for (const o of incomingObjects) {
      const finalId = objectPlan.idMap.get(o.id);
      if (!finalId) { skipped.dataObjects++; continue; }
      const name = objectPlan.relabel.get(finalId) || o.name;
      const masterSystemId = remap(systemPlan, o.master_system_id) || null;
      const values = [
        finalId, name, masterSystemId, JSON.stringify(o.system_object_names || {}),
        o.description || '', o.classification || 'internal',
      ];
      if (objectPlan.overwrite.has(finalId)) {
        await client.query(
          `UPDATE data_objects SET name=$2, master_system_id=$3, system_object_names=$4, description=$5, classification=$6 WHERE id=$1`,
          values
        );
        updated.dataObjects++;
        auditEntries.push({ action: 'update', resourceType: 'data_object', resourceId: finalId, resourceLabel: name, after: o });
      } else {
        await client.query(
          `INSERT INTO data_objects (id, name, master_system_id, system_object_names, description, classification)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          values
        );
        created.dataObjects++;
        auditEntries.push({ action: 'create', resourceType: 'data_object', resourceId: finalId, resourceLabel: name, after: o });
      }
    }

    for (const e of incomingEdges) {
      const finalId = edgePlan.idMap.get(e.id);
      if (!finalId) { skipped.edges++; continue; }
      const source = remap(systemPlan, e.source);
      const target = remap(systemPlan, e.target);
      const objectIds = (e.data_object_ids || []).map(id => remap(objectPlan, id)).filter(Boolean);
      const label = `${systemLabelByFinalId.get(source) || source} → ${systemLabelByFinalId.get(target) || target}`;
      const values = [finalId, source, target, JSON.stringify(objectIds), e.description || ''];
      if (edgePlan.overwrite.has(finalId)) {
        await client.query(`UPDATE edges SET source=$2, target=$3, data_object_ids=$4, description=$5 WHERE id=$1`, values);
        updated.edges++;
        auditEntries.push({ action: 'update', resourceType: 'edge', resourceId: finalId, resourceLabel: label, after: e });
      } else {
        await client.query(
          `INSERT INTO edges (id, source, target, data_object_ids, description, owner_ids) VALUES ($1,$2,$3,$4,$5,'[]')`,
          values
        );
        created.edges++;
        auditEntries.push({ action: 'create', resourceType: 'edge', resourceId: finalId, resourceLabel: label, after: e });
      }
    }

    // Detail rows follow their parent edge/object: if either was skipped, the detail is left alone
    // too rather than grafting new integration-mechanics data onto an edge/object the user chose
    // not to touch.
    for (const d of incomingDetails) {
      const edgeFinal = edgePlan.idMap.get(d.edge_id);
      const objectFinal = objectPlan.idMap.get(d.data_object_id);
      if (!edgeFinal || !objectFinal) continue;
      const typeId = (d.integration_type_id && typeIdMap.get(d.integration_type_id)) || d.integration_type_id || '';
      const softwareId = (d.integration_software_id && softwareIdMap.get(d.integration_software_id)) || d.integration_software_id || '';
      await client.query(
        `INSERT INTO edge_object_details (edge_id, data_object_id, source_pattern, target_pattern, schedule, integration_type_id, integration_software_id, at_risk)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (edge_id, data_object_id) DO UPDATE SET
           source_pattern = EXCLUDED.source_pattern, target_pattern = EXCLUDED.target_pattern, schedule = EXCLUDED.schedule,
           integration_type_id = EXCLUDED.integration_type_id, integration_software_id = EXCLUDED.integration_software_id,
           at_risk = EXCLUDED.at_risk`,
        [edgeFinal, objectFinal, d.source_pattern || '', d.target_pattern || '',
          JSON.stringify(d.schedule || { kind: 'daily', time: '02:00' }), typeId, softwareId, !!d.at_risk]
      );
    }

    await client.query('COMMIT');

    for (const entry of auditEntries) await logAudit(req, entry);

    // Edges that needed approval never touched the transaction above - turn them into real
    // change_requests rows now that the rest of the import has safely landed. Each one folds its
    // own edge_object_details (if any) into the same request rather than creating a second one,
    // remapping their integration type/software ids through the merge that already ran above.
    const queuedForApproval = { edges: 0 };
    for (const item of pendingEdgeQueue) {
      // Converted to the camelCase shape applyEdgeCreate/applyEdgeUpdate expect (a live
      // POST/PATCH body) - the bundle's own edge rows are the raw snake_case DB export shape.
      const payload = {
        id: item.edge.id,
        source: item.edge.source,
        target: item.edge.target,
        dataObjectIds: item.edge.data_object_ids || [],
        description: item.edge.description || '',
      };
      if (item.details.length > 0) {
        // Converted to the camelCase shape applyEdgeObjectDetailUpsert/buildUpdate expect (a live
        // PATCH body) - the bundle's own rows are the raw snake_case DB export shape instead.
        payload.edgeObjectDetails = item.details.map(d => ({
          dataObjectId: d.data_object_id,
          sourcePattern: d.source_pattern || '',
          targetPattern: d.target_pattern || '',
          schedule: d.schedule || { kind: 'daily', time: '02:00' },
          integrationTypeId: (d.integration_type_id && typeIdMap.get(d.integration_type_id)) || d.integration_type_id || '',
          integrationSoftwareId: (d.integration_software_id && softwareIdMap.get(d.integration_software_id)) || d.integration_software_id || '',
          atRisk: !!d.at_risk,
        }));
      }
      await createChangeRequest(req, {
        action: item.isNew ? 'create' : 'update',
        resourceType: 'edge',
        resourceId: item.edge.id,
        payload,
        affectedSystemIds: item.affectedSystemIds,
      });
      queuedForApproval.edges++;
    }

    await logAudit(req, {
      action: 'import', resourceType: 'import_export',
      resourceLabel: `${created.systems + updated.systems} systems, ${created.dataObjects + updated.dataObjects} objects, ${created.edges + updated.edges} edges`,
      after: { created, updated, skipped, queuedForApproval },
    });

    res.json({ success: true, created, updated, skipped, queuedForApproval });
  } catch (err) {
    await client.query('ROLLBACK');
    // Postgres error code 23503 = foreign_key_violation - by far the most likely way this
    // transaction can fail, since skipping a "new" row is otherwise unconstrained: nothing stops a
    // person from keeping a new edge/object while skipping the new system or object it points to.
    // The raw constraint-name error ("...violates foreign key constraint \"edges_target_fkey\"")
    // is meaningless to whoever's importing, so translate it into what actually needs fixing.
    const message = err.code === '23503'
      ? 'Import failed: something you kept references something else you chose to skip. Include that item too, or skip the one that depends on it.'
      : err.message;
    res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Change requests - the approval queue a system_owner's cross-system edge/edge-object-detail
// change lands in (see createChangeRequest/resolveEdgeAuthority above). Visible to anyone signed
// in (matches "pending changes are visible to everyone"), but only an eligible approver - an
// admin/superadmin, or an owner of one of the request's affected_system_ids - can decide one.
// ---------------------------------------------------------------------------
async function canDecideChangeRequest(user, changeRequest) {
  if (isPrivilegedRole(user.role)) return true;
  const affected = changeRequest.affected_system_ids || [];
  if (affected.length === 0) return false;
  const { rows } = await pool.query('SELECT owner_ids FROM systems WHERE id = ANY($1)', [affected]);
  return rows.some(r => (r.owner_ids || []).includes(user.id));
}

app.get('/api/change-requests', requireAuth, async (req, res) => {
  try {
    const { status = 'pending', scope = 'mine', resourceType, limit = '50', offset = '0' } = req.query;
    const clauses = [];
    const values = [];
    let i = 1;

    if (status && status !== 'all') { clauses.push(`cr.status = $${i++}`); values.push(status); }
    if (resourceType) { clauses.push(`cr.resource_type = $${i++}`); values.push(resourceType); }

    if (scope === 'mine') {
      clauses.push(`cr.requested_by = $${i++}`);
      values.push(req.user.id);
    } else if (scope === 'awaitingMe') {
      if (!isPrivilegedRole(req.user.role)) {
        const { rows: ownedRows } = await pool.query('SELECT id FROM systems WHERE owner_ids @> $1::jsonb', [JSON.stringify([req.user.id])]);
        const ownedIds = ownedRows.map(r => r.id);
        if (ownedIds.length === 0) return res.json({ changeRequests: [], total: 0 });
        clauses.push(`cr.affected_system_ids ?| $${i++}`);
        values.push(ownedIds);
      }
    } else if (scope === 'all') {
      if (!isPrivilegedRole(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do this' });
    } else if (scope === 'visible') {
      // Every pending change is meant to be visible to anyone signed in (shown dashed/badged on
      // the canvas so it's unmistakably "not active yet") - unlike 'all', this isn't admin-only,
      // but it's only ever used for that canvas-wide read, not for the Approvals page's own lists.
    } else {
      return res.status(400).json({ error: 'Invalid scope' });
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const rows = await pool.query(
      `SELECT cr.*, u.name AS requested_by_name, u.email AS requested_by_email
       FROM change_requests cr JOIN users u ON u.id = cr.requested_by
       ${where} ORDER BY cr.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...values, safeLimit, safeOffset]
    );
    const count = await pool.query(`SELECT COUNT(*) FROM change_requests cr ${where}`, values);
    res.json({ changeRequests: rows.rows, total: parseInt(count.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/change-requests/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cr.*, u.name AS requested_by_name, u.email AS requested_by_email
       FROM change_requests cr JOIN users u ON u.id = cr.requested_by WHERE cr.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const cr = rows[0];
    const { rows: systemRows } = await pool.query('SELECT id, label FROM systems WHERE id = ANY($1)', [cr.affected_system_ids || []]);
    res.json({ changeRequest: cr, affectedSystems: systemRows, canDecide: await canDecideChangeRequest(req.user, cr) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/change-requests/:id/approve', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM change_requests WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const cr = rows[0];
    if (!(await canDecideChangeRequest(req.user, cr))) return res.status(403).json({ error: 'You do not have permission to do this' });

    // Conditional UPDATE (not read-then-write) so two approvers deciding at nearly the same
    // moment can't both succeed - whichever request wins the race gets rowCount 1, the other 0.
    const { rows: updatedRows } = await pool.query(
      `UPDATE change_requests SET status = 'approved', decided_by = $1, decided_at = now() WHERE id = $2 AND status = 'pending' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (updatedRows.length === 0) return res.status(409).json({ error: 'This request was already decided.' });

    const { rows: requesterRows } = await pool.query('SELECT id, email, name, role, notification_email_prefs FROM users WHERE id = $1', [cr.requested_by]);
    const requester = requesterRows[0];

    // Re-verify the underlying resource is still in the state this request assumed before
    // replaying it - if it was deleted or changed out from under the request in the meantime,
    // applying a stale payload could resurrect something or clobber an unrelated edit. Auto-reject
    // instead of applying blindly (full field-level diffing against before_snapshot is out of
    // scope for now - this only checks the resource still exists).
    let stillValid = true;
    if (cr.action === 'update' || cr.action === 'delete') {
      if (cr.resource_type === 'edge') {
        stillValid = (await pool.query('SELECT id FROM edges WHERE id = $1', [cr.resource_id])).rows.length > 0;
      } else if (cr.resource_type === 'edge_object_detail') {
        stillValid = (await pool.query(
          'SELECT edge_id FROM edge_object_details WHERE edge_id = $1 AND data_object_id = $2', [cr.resource_id, cr.secondary_id]
        )).rows.length > 0;
      }
    }

    if (!stillValid) {
      await pool.query(`UPDATE change_requests SET status = 'rejected', decision_reason = $1 WHERE id = $2`,
        ['Automatically rejected: the underlying item no longer exists.', req.params.id]);
      if (requester) {
        await notify(requester, {
          type: 'change_request_rejected',
          title: 'Your proposed change could not be applied',
          body: 'The item it would have changed no longer exists.',
          linkView: 'approvals', linkId: req.params.id,
          emailSubject: 'Your proposed change could not be applied',
          emailHtml: `<p>Your proposed change could not be applied because the underlying item no longer exists.</p>`,
        });
      }
      await logAudit(req, { action: 'reject', resourceType: 'change_request', resourceId: req.params.id, resourceLabel: `${cr.resource_type} ${cr.action}`, metadata: { autoRejected: true } });
      return res.json({ success: true, applied: false, autoRejected: true });
    }

    if (cr.resource_type === 'edge') {
      if (cr.action === 'create') await applyEdgeCreate(req, cr.payload, requester);
      else if (cr.action === 'update') await applyEdgeUpdate(req, cr.resource_id, cr.payload, requester);
      else if (cr.action === 'delete') await applyEdgeDelete(req, cr.resource_id, requester);
      // A request that originated from a system_owner's import folds that edge's per-object flow
      // mechanics into this same payload (see the import/commit route) rather than spawning a
      // second change request - apply them now that the edge itself exists/is updated.
      if (cr.action !== 'delete' && Array.isArray(cr.payload?.edgeObjectDetails)) {
        for (const d of cr.payload.edgeObjectDetails) {
          await applyEdgeObjectDetailUpsert(req, cr.resource_id, d.dataObjectId, d, requester);
        }
      }
    } else if (cr.resource_type === 'edge_object_detail') {
      if (cr.action === 'delete') await applyEdgeObjectDetailDelete(req, cr.resource_id, cr.secondary_id, requester);
      else await applyEdgeObjectDetailUpsert(req, cr.resource_id, cr.secondary_id, cr.payload, requester);
    }

    if (requester) {
      await notify(requester, {
        type: 'change_request_approved',
        title: 'Your proposed change was approved',
        body: `${req.user.name || req.user.email} approved your change - it's now active.`,
        linkView: 'approvals', linkId: req.params.id,
        emailSubject: 'Your proposed change was approved',
        emailHtml: `<p><strong>${req.user.name || req.user.email}</strong> approved your proposed change - it's now active.</p>`,
      });
    }
    await logAudit(req, { action: 'approve', resourceType: 'change_request', resourceId: req.params.id, resourceLabel: `${cr.resource_type} ${cr.action}` });
    res.json({ success: true, applied: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/change-requests/:id/reject', requireAuth, async (req, res) => {
  try {
    const reason = (req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    const { rows } = await pool.query('SELECT * FROM change_requests WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const cr = rows[0];
    if (!(await canDecideChangeRequest(req.user, cr))) return res.status(403).json({ error: 'You do not have permission to do this' });

    const { rows: updatedRows } = await pool.query(
      `UPDATE change_requests SET status = 'rejected', decided_by = $1, decided_at = now(), decision_reason = $2 WHERE id = $3 AND status = 'pending' RETURNING *`,
      [req.user.id, reason, req.params.id]
    );
    if (updatedRows.length === 0) return res.status(409).json({ error: 'This request was already decided.' });

    const { rows: requesterRows } = await pool.query('SELECT id, email, name, notification_email_prefs FROM users WHERE id = $1', [cr.requested_by]);
    if (requesterRows[0]) {
      await notify(requesterRows[0], {
        type: 'change_request_rejected',
        title: 'Your proposed change was rejected',
        body: reason,
        linkView: 'approvals', linkId: req.params.id,
        emailSubject: 'Your proposed change was rejected',
        emailHtml: `<p><strong>${req.user.name || req.user.email}</strong> rejected your proposed change.</p><p>Reason: ${reason}</p>`,
      });
    }
    await logAudit(req, { action: 'reject', resourceType: 'change_request', resourceId: req.params.id, resourceLabel: `${cr.resource_type} ${cr.action}`, metadata: { reason } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/change-requests/:id/withdraw', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM change_requests WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const cr = rows[0];
    if (cr.requested_by !== req.user.id && !isPrivilegedRole(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }

    const { rows: updatedRows } = await pool.query(
      `UPDATE change_requests SET status = 'withdrawn', decided_by = $1, decided_at = now() WHERE id = $2 AND status = 'pending' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (updatedRows.length === 0) return res.status(409).json({ error: 'This request was already decided.' });
    await logAudit(req, { action: 'withdraw', resourceType: 'change_request', resourceId: req.params.id, resourceLabel: `${cr.resource_type} ${cr.action}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Notifications - the in-app inbox every notify() call writes to (see above). Own rows only; the
// email half of a notification is opt-out-able per type via PATCH /api/auth/me, but the in-app row
// here always gets written regardless.
// ---------------------------------------------------------------------------
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const { unreadOnly, limit = '30', offset = '0' } = req.query;
    const clauses = ['user_id = $1'];
    const values = [req.user.id];
    let i = 2;
    if (unreadOnly === 'true') clauses.push('read_at IS NULL');
    const where = `WHERE ${clauses.join(' AND ')}`;
    const safeLimit = Math.min(parseInt(limit, 10) || 30, 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const rows = await pool.query(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...values, safeLimit, safeOffset]
    );
    const unread = await pool.query('SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    res.json({ notifications: rows.rows, unreadCount: parseInt(unread.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Languages - which locales the app currently offers. Public (no requireAuth) because the login
// screen's language picker needs this before anyone is signed in; adding/removing is admin-only.
// ---------------------------------------------------------------------------
app.get('/api/languages', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT code, label FROM languages ORDER BY label');
    res.json({ languages: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/languages', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const code = (req.body.code || '').trim().toLowerCase();
    const label = (req.body.label || '').trim();
    if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(code)) {
      return res.status(400).json({ error: 'Language code must look like "en" or "en-us".' });
    }
    if (!label) return res.status(400).json({ error: 'A label is required.' });
    await pool.query('INSERT INTO languages (code, label) VALUES ($1, $2)', [code, label]);
    // Give the new locale a starting point for every existing key, copied from English - an admin
    // can then refine each one from Settings > Translations instead of starting from blank.
    await pool.query(
      `INSERT INTO translations (key, locale, value)
       SELECT key, $1, value FROM translations WHERE locale = 'en'
       ON CONFLICT (key, locale) DO NOTHING`,
      [code]
    );
    await logAudit(req, { action: 'create', resourceType: 'language', resourceId: code, resourceLabel: label, after: { code, label } });
    res.status(201).json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This language code already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/languages/:code', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { code } = req.params;
    if (code === 'en') {
      return res.status(400).json({ error: "English can't be removed - it's the fallback every other language falls back to." });
    }
    const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM languages');
    if (parseInt(countRows[0].count, 10) <= 1) {
      return res.status(400).json({ error: 'At least one language must remain.' });
    }
    const { rows: labelRows } = await pool.query('SELECT label FROM languages WHERE code = $1', [code]);
    await pool.query('DELETE FROM translations WHERE locale = $1', [code]);
    await pool.query('DELETE FROM languages WHERE code = $1', [code]);
    await logAudit(req, { action: 'delete', resourceType: 'language', resourceId: code, resourceLabel: labelRows[0]?.label || code, before: labelRows[0] || null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Translations - every UI string, per supported locale, editable from Settings > Translations.
// Public (no requireAuth) because the login and accept-invite screens need translated text before
// anyone is signed in; editing and the CSV export/import round trip are admin-only.
// ---------------------------------------------------------------------------
app.get('/api/translations', async (req, res) => {
  try {
    const locales = await getLanguageCodes();
    const rows = await pool.query('SELECT key, locale, value FROM translations');
    const byLocale = {};
    for (const locale of locales) byLocale[locale] = {};
    rows.rows.forEach(r => {
      if (!byLocale[r.locale]) byLocale[r.locale] = {};
      byLocale[r.locale][r.key] = r.value;
    });
    res.json({ locales, translations: byLocale });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/translations/:key/:locale', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { key, locale } = req.params;
    const { value } = req.body;
    if (!(await getLanguageCodes()).includes(locale)) return res.status(400).json({ error: 'Unsupported locale.' });
    if (typeof value !== 'string') return res.status(400).json({ error: 'A text value is required.' });
    const { rows: beforeRows } = await pool.query('SELECT value FROM translations WHERE key = $1 AND locale = $2', [key, locale]);
    await pool.query(
      `INSERT INTO translations (key, locale, value) VALUES ($1, $2, $3)
       ON CONFLICT (key, locale) DO UPDATE SET value = EXCLUDED.value`,
      [key, locale, value]
    );
    await logAudit(req, {
      action: beforeRows.length > 0 ? 'update' : 'create', resourceType: 'translation', resourceId: `${key}:${locale}`, resourceLabel: `${key} (${locale})`,
      before: beforeRows.length > 0 ? { value: beforeRows[0].value } : null, after: { value },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Spreadsheet-friendly round trip for bulk-editing translations outside the app (e.g. handing the
// file to a translator) instead of one cell at a time. Export is one row per key, one column per
// locale; import upserts any non-empty cell whose column header is a locale that still exists -
// an unknown column (a since-removed or mistyped locale) is silently ignored, and an empty cell is
// left alone rather than blanking out an existing translation.
app.get('/api/translations/export', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const locales = await getLanguageCodes();
    const rows = await pool.query('SELECT key, locale, value FROM translations');
    const byKey = {};
    rows.rows.forEach(r => { (byKey[r.key] ||= {})[r.locale] = r.value; });
    const keys = Object.keys(byKey).sort();
    let csv = csvRow(['key', ...locales]);
    for (const key of keys) {
      csv += csvRow([key, ...locales.map(l => byKey[key][l] || '')]);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="translations.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/translations/import', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { csv } = req.body;
    if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'CSV text is required.' });
    const rows = parseCsv(csv);
    if (rows.length < 2) return res.status(400).json({ error: 'CSV has no data rows.' });
    const [header, ...dataRows] = rows;
    const knownLocales = await getLanguageCodes();
    const localeColumns = header.slice(1).map(h => h.trim());
    let updated = 0;
    for (const row of dataRows) {
      const key = (row[0] || '').trim();
      if (!key) continue;
      for (let i = 0; i < localeColumns.length; i++) {
        const locale = localeColumns[i];
        if (!knownLocales.includes(locale)) continue;
        const value = row[i + 1];
        if (!value) continue;
        await pool.query(
          `INSERT INTO translations (key, locale, value) VALUES ($1, $2, $3)
           ON CONFLICT (key, locale) DO UPDATE SET value = EXCLUDED.value`,
          [key, locale, value]
        );
        updated++;
      }
    }
    // One summary row rather than one per cell - a single import can touch hundreds of cells, and
    // the individual before/after values aren't as useful here as knowing an import happened, by
    // whom, and how many cells it touched.
    await logAudit(req, { action: 'update', resourceType: 'translation_import', resourceLabel: 'CSV import', after: { updated } });
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Reference lists (Integration Types, Software) - admin-maintainable tags that an integration's
// object flows can carry one or more of. Both share the same {id, name} shape, so one route
// factory serves both. Frequency is deliberately not one of these: each flow defines its own
// mandatory schedule directly (edge_object_details.schedule), not a shared label.
// ---------------------------------------------------------------------------
function registerReferenceListRoutes(path, table, idPrefix, columns = REFERENCE_LIST_COLUMNS) {
  app.get(`/api/${path}`, requireAuth, async (req, res) => {
    try {
      const rows = await pool.query(`SELECT * FROM ${table} ORDER BY name`);
      res.json({ items: rows.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(`/api/${path}`, requireAuth, requireRole('admin', 'editor'), async (req, res) => {
    try {
      const id = req.body.id || `${idPrefix}-${Date.now()}`;
      await pool.query(`INSERT INTO ${table} (id, name) VALUES ($1, $2)`, [id, req.body.name]);
      const { sets, values } = buildUpdate(table, columns, req.body);
      if (sets.length > 0) {
        values.push(id);
        await pool.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
      }
      await logAudit(req, { action: 'create', resourceType: table, resourceId: id, resourceLabel: req.body.name, after: req.body });
      res.status(201).json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch(`/api/${path}/:id`, requireAuth, requireRole('admin', 'editor'), async (req, res) => {
    try {
      const { sets, values } = buildUpdate(table, columns, req.body);
      if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
      const { rows: beforeRows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      const beforeRow = beforeRows[0] || {};
      values.push(req.params.id);
      await pool.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
      const beforeSnapshot = {};
      for (const key of Object.keys(columns)) {
        if (key in req.body) beforeSnapshot[key] = beforeRow[columns[key]];
      }
      await logAudit(req, { action: 'update', resourceType: table, resourceId: req.params.id, resourceLabel: req.body.name || beforeRow.name || req.params.id, before: beforeSnapshot, after: req.body });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete(`/api/${path}/:id`, requireAuth, requireRole('admin', 'editor'), async (req, res) => {
    try {
      const { rows: beforeRows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      await logAudit(req, { action: 'delete', resourceType: table, resourceId: req.params.id, resourceLabel: beforeRows[0]?.name || req.params.id, before: beforeRows[0] || null });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

registerReferenceListRoutes('integration-types', 'integration_types', 'itype');
registerReferenceListRoutes('integration-software', 'integration_software', 'isw', SOFTWARE_LIST_COLUMNS);
registerReferenceListRoutes('business-capabilities', 'business_capabilities', 'bcap');

// ---------------------------------------------------------------------------
// System downtimes - planned or unplanned windows a system is unavailable, cross-referenced on
// the Schedule page against computed run times to flag impacted integrations.
// ---------------------------------------------------------------------------
app.get('/api/system-downtimes', requireAuth, async (req, res) => {
  try {
    const rows = await pool.query('SELECT * FROM system_downtimes ORDER BY starts_at');
    res.json({ downtimes: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A system_owner may only schedule/edit/remove downtimes for a system they own - self-serve,
// never queued for approval, since a downtime only ever affects the one system it's declared on.
app.post('/api/system-downtimes', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    const d = req.body;
    if (req.user.role === 'system_owner' && !(await isResourceOwner('systems', d.systemId, req.user.id))) {
      return res.status(403).json({ error: 'You can only schedule downtime for a system you own.' });
    }
    const id = d.id || `downtime-${Date.now()}`;
    await pool.query(
      `INSERT INTO system_downtimes (id, system_id, starts_at, ends_at, reason) VALUES ($1, $2, $3, $4, $5)`,
      [id, d.systemId, d.startsAt, d.endsAt, d.reason || '']
    );
    await logAudit(req, { action: 'create', resourceType: 'system_downtime', resourceId: id, resourceLabel: d.reason || id, after: d });
    res.status(201).json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/system-downtimes/:id', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    if (req.user.role === 'system_owner') {
      const { rows: currentRows } = await pool.query('SELECT system_id FROM system_downtimes WHERE id = $1', [req.params.id]);
      if (currentRows.length === 0) return res.status(404).json({ error: 'Not found' });
      if (!(await isResourceOwner('systems', currentRows[0].system_id, req.user.id))) {
        return res.status(403).json({ error: 'You do not have permission to do this' });
      }
    }
    const { sets, values } = buildUpdate('system_downtimes', SYSTEM_DOWNTIME_COLUMNS, req.body);
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    const { rows: beforeRows } = await pool.query('SELECT * FROM system_downtimes WHERE id = $1', [req.params.id]);
    const beforeRow = beforeRows[0] || {};
    values.push(req.params.id);
    await pool.query(`UPDATE system_downtimes SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    const beforeSnapshot = {};
    for (const key of Object.keys(SYSTEM_DOWNTIME_COLUMNS)) {
      if (key in req.body) beforeSnapshot[key] = beforeRow[SYSTEM_DOWNTIME_COLUMNS[key]];
    }
    await logAudit(req, { action: 'update', resourceType: 'system_downtime', resourceId: req.params.id, resourceLabel: req.body.reason || beforeRow.reason || req.params.id, before: beforeSnapshot, after: req.body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/system-downtimes/:id', requireAuth, requireRole('admin', 'editor', 'system_owner'), async (req, res) => {
  try {
    const { rows: beforeRows } = await pool.query('SELECT * FROM system_downtimes WHERE id = $1', [req.params.id]);
    if (beforeRows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'system_owner' && !(await isResourceOwner('systems', beforeRows[0].system_id, req.user.id))) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    await pool.query('DELETE FROM system_downtimes WHERE id = $1', [req.params.id]);
    await logAudit(req, { action: 'delete', resourceType: 'system_downtime', resourceId: req.params.id, resourceLabel: beforeRows[0]?.reason || req.params.id, before: beforeRows[0] || null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Audit log - the SOX-style "who did/saw what, when" trail. Mutations are logged inline at their
// own routes above; this section covers the other two pieces: recording a *view* of one specific
// record (the frontend pings this when a system/object/integration is opened for detail, not on
// every list fetch or background poll - see src/audit/logView.ts) and letting admins browse/export
// everything that's been recorded, for handing to an auditor.
// ---------------------------------------------------------------------------
const AUDIT_ACTIONS = ['view', 'create', 'update', 'delete', 'login', 'login_failed', 'logout', 'export', 'import', 'approve', 'reject', 'withdraw'];

app.post('/api/audit/log-view', requireAuth, async (req, res) => {
  try {
    const { resourceType, resourceId, resourceLabel } = req.body;
    if (!resourceType || typeof resourceType !== 'string') {
      return res.status(400).json({ error: 'resourceType is required.' });
    }
    await logAudit(req, { action: 'view', resourceType, resourceId: resourceId || null, resourceLabel: resourceLabel || null });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildAuditLogQuery(req) {
  const { from, to, actorUserId, resourceType, resourceId, action, search } = req.query;
  const clauses = [];
  const values = [];
  let i = 1;

  if (from) { clauses.push(`occurred_at >= $${i++}`); values.push(from); }
  if (to) { clauses.push(`occurred_at <= $${i++}`); values.push(to); }
  if (actorUserId) { clauses.push(`actor_user_id = $${i++}`); values.push(actorUserId); }
  if (resourceType) { clauses.push(`resource_type = $${i++}`); values.push(resourceType); }
  if (resourceId) { clauses.push(`resource_id = $${i++}`); values.push(resourceId); }
  if (action && AUDIT_ACTIONS.includes(action)) { clauses.push(`action = $${i++}`); values.push(action); }
  if (search) {
    clauses.push(`(actor_email ILIKE $${i} OR actor_name ILIKE $${i} OR resource_label ILIKE $${i})`);
    values.push(`%${search}%`);
    i++;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, values, nextIndex: i };
}

app.get('/api/audit-log', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { where, values, nextIndex } = buildAuditLogQuery(req);
    const { limit = '50', offset = '0' } = req.query;
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const rows = await pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY occurred_at DESC LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      [...values, safeLimit, safeOffset]
    );
    const count = await pool.query(`SELECT COUNT(*) FROM audit_log ${where}`, values);
    res.json({ entries: rows.rows, total: parseInt(count.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Same filters as the listing above, but unpaginated (capped at 50,000 rows so a runaway filter
// can't exhaust memory) and shaped as a flat CSV for handing straight to an auditor.
app.get('/api/audit-log/export', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { where, values } = buildAuditLogQuery(req);
    const rows = await pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY occurred_at DESC LIMIT 50000`,
      values
    );
    let csv = csvRow(['occurred_at', 'actor_name', 'actor_email', 'actor_role', 'action', 'resource_type', 'resource_id', 'resource_label', 'changed_fields', 'before', 'after', 'ip_address']);
    for (const r of rows.rows) {
      csv += csvRow([
        r.occurred_at instanceof Date ? r.occurred_at.toISOString() : r.occurred_at,
        r.actor_name || '', r.actor_email || '', r.actor_role || '',
        r.action, r.resource_type, r.resource_id || '', r.resource_label || '',
        r.changed_fields ? JSON.stringify(r.changed_fields) : '',
        r.before_data ? JSON.stringify(r.before_data) : '',
        r.after_data ? JSON.stringify(r.after_data) : '',
        r.ip_address || '',
      ]);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
