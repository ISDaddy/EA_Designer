require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app = express();
// `credentials: true` + reflecting the request origin (rather than `*`) is required for the
// session cookie to survive cross-origin requests - the frontend and backend are served from the
// same host but different ports, which browsers treat as different origins.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
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
      aliases JSONB DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS edges (
      id VARCHAR(255) PRIMARY KEY,
      source VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      target VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      data_object_ids JSONB DEFAULT '[]'
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

    -- Singleton row (id is always 1) holding the SMTP sender credentials admins configure from
    -- Settings, so they're editable at runtime instead of being fixed at container start via env
    -- vars. The env vars (see secrets.env) remain the fallback for a fresh install.
    CREATE TABLE IF NOT EXISTS smtp_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      smtp_user VARCHAR(255),
      smtp_pass VARCHAR(255),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT smtp_settings_singleton CHECK (id = 1)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
  `);

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
  await addColumnIfMissing('systems', "owner VARCHAR(255) DEFAULT ''");
  await addColumnIfMissing('systems', "status VARCHAR(50) DEFAULT 'active'");
  await addColumnIfMissing('systems', "criticality VARCHAR(50) DEFAULT 'medium'");
  await addColumnIfMissing('systems', "business_capability VARCHAR(255) DEFAULT ''");
  await addColumnIfMissing('systems', "tech_stack JSONB DEFAULT '[]'");
  await addColumnIfMissing('systems', "description TEXT DEFAULT ''");

  await addColumnIfMissing('data_objects', "aliases JSONB DEFAULT '{}'");
  await addColumnIfMissing('data_objects', "description TEXT DEFAULT ''");
  await addColumnIfMissing('data_objects', "classification VARCHAR(50) DEFAULT 'internal'");

  await addColumnIfMissing('edges', "description TEXT DEFAULT ''");
  await addColumnIfMissing('edges', "integration_pattern VARCHAR(50) DEFAULT ''");
  await addColumnIfMissing('edges', "frequency VARCHAR(50) DEFAULT ''");

  // Indexes matter once a landscape has hundreds/thousands of systems - without them, every
  // filter-by-system, filter-by-object, or master-system lookup becomes a full table scan.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    CREATE INDEX IF NOT EXISTS idx_data_objects_master ON data_objects(master_system_id);
    CREATE INDEX IF NOT EXISTS idx_systems_label ON systems(label);
    CREATE INDEX IF NOT EXISTS idx_systems_status ON systems(status);
    CREATE INDEX IF NOT EXISTS idx_systems_criticality ON systems(criticality);
  `);
}

initDB().then(loadSmtpConfig).catch(console.error);

// ---------------------------------------------------------------------------
// Auth - opaque session tokens stored server-side (not JWTs), so a session can be revoked just by
// deleting its row. Three roles: 'admin' (manage the landscape and the team), 'editor' (manage the
// landscape), 'viewer' (read-only).
// ---------------------------------------------------------------------------
const ROLES = ['admin', 'editor', 'viewer'];
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  // Not marked `secure` because this stack is typically served over plain HTTP on a LAN/self-host
  // (see docker-compose.yml) - a secure-only cookie would silently never be sent in that setup.
  secure: false,
  maxAge: SESSION_TTL_MS,
};

const newToken = () => crypto.randomBytes(32).toString('hex');

async function getSessionUser(req) {
  const token = req.cookies?.sid;
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return result.rows[0] || null;
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

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

async function createSession(res, userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, userId, expiresAt]);
  res.cookie('sid', token, COOKIE_OPTS);
}

// Admins can demote/remove other admins freely, but never the last one - otherwise the team could
// be locked out of user management entirely.
async function countOtherAdmins(excludeUserId) {
  const result = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND id != $1`, [excludeUserId]);
  return parseInt(result.rows[0].count, 10);
}

// The SMTP sender is admin-configurable at runtime (Settings > Email) rather than fixed at
// container start, so `smtpConfig`/`mailTransporter` are mutable module state instead of
// constants. They start from the env vars (see secrets.env) as a working-out-of-the-box default,
// then get overridden by whatever's stored in `smtp_settings` once an admin saves one via the API
// - see `loadSmtpConfig`, called once `initDB` has created that table.
let smtpConfig = { user: process.env.SMTP_USER || null, pass: process.env.SMTP_PASS || null };
let mailTransporter = null;

function buildTransporter(config) {
  if (!config.user || !config.pass) return null;
  return nodemailer.createTransport({ service: 'gmail', auth: { user: config.user, pass: config.pass } });
}

async function loadSmtpConfig() {
  try {
    const result = await pool.query('SELECT smtp_user, smtp_pass FROM smtp_settings WHERE id = 1');
    if (result.rows[0]) {
      smtpConfig = { user: result.rows[0].smtp_user, pass: result.rows[0].smtp_pass };
    }
  } catch (err) {
    console.error('Failed to load SMTP settings from the database:', err.message);
  }
  mailTransporter = buildTransporter(smtpConfig);
  if (!mailTransporter) {
    console.warn('Email is not configured - invite emails will not be sent (the invite link can still be copied and shared manually). Configure one in Settings > Email.');
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
  owner: 'owner',
  status: 'status',
  criticality: 'criticality',
  businessCapability: 'business_capability',
  techStack: 'tech_stack',
  description: 'description',
};

const DATA_OBJECT_COLUMNS = {
  name: 'name',
  masterSystemId: 'master_system_id',
  aliases: 'aliases',
  description: 'description',
  classification: 'classification',
};

const EDGE_COLUMNS = {
  source: 'source',
  target: 'target',
  dataObjectIds: 'data_object_ids',
  description: 'description',
  integrationPattern: 'integration_pattern',
  frequency: 'frequency',
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
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, 'admin')`,
      [id, email.toLowerCase().trim(), passwordHash, name.trim()]
    );
    await createSession(res, id);
    res.status(201).json({ id, email: email.toLowerCase().trim(), name: name.trim(), role: 'admin' });
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
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await createSession(res, user.id);
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.cookies?.sid;
    if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.clearCookie('sid', COOKIE_OPTS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
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
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, invite.email, passwordHash, name.trim(), invite.role]
    );
    await pool.query(`UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = $1`, [invite.id]);
    await createSession(res, id);
    res.status(201).json({ id, email: invite.email, name: name.trim(), role: invite.role });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Users and invites (admin only) - the Settings > Team page.
// ---------------------------------------------------------------------------
app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, name, role, created_at, last_login_at FROM users ORDER BY created_at ASC');
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { role, name } = req.body;
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

    if (role && role !== 'admin') {
      const target = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
      if (target.rows[0]?.role === 'admin' && (await countOtherAdmins(req.params.id)) === 0) {
        return res.status(400).json({ error: 'Cannot demote the last remaining admin.' });
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const target = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    if (target.rows[0]?.role === 'admin' && (await countOtherAdmins(req.params.id)) === 0) {
      return res.status(400).json({ error: 'Cannot remove the last remaining admin.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
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

    res.status(201).json({ id, email: normalizedEmail, role, link, emailSent: emailResult.sent, emailError: emailResult.reason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/invites/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`UPDATE invites SET status = 'revoked' WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Email settings (admin only) - the Gmail SMTP sender used for invite emails, editable at
// runtime from Settings instead of being fixed at container start. The password is write-only:
// it's never returned once saved, only whether one is configured and which address it's for.
// ---------------------------------------------------------------------------
app.get('/api/settings/email', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ configured: !!mailTransporter, smtpUser: smtpConfig.user || null });
});

app.put('/api/settings/email', requireAuth, requireRole('admin'), async (req, res) => {
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

    smtpConfig = { user: smtpUser, pass: smtpPass };
    mailTransporter = candidate;
    res.json({ configured: true, smtpUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/settings/email', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM smtp_settings WHERE id = 1');
    smtpConfig = { user: null, pass: null };
    mailTransporter = null;
    res.json({ configured: false, smtpUser: null });
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

    res.json({
      systems: systemsRes.rows,
      dataObjects: objectsRes.rows,
      edges: edgesRes.rows
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
    const { search, status, criticality, limit = '50', offset = '0' } = req.query;
    const clauses = [];
    const values = [];
    let i = 1;

    if (search) {
      clauses.push(`(label ILIKE $${i} OR owner ILIKE $${i} OR business_capability ILIKE $${i})`);
      values.push(`%${search}%`);
      i++;
    }
    if (status) {
      clauses.push(`status = $${i}`);
      values.push(status);
      i++;
    }
    if (criticality) {
      clauses.push(`criticality = $${i}`);
      values.push(criticality);
      i++;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const rows = await pool.query(
      `SELECT * FROM systems ${where} ORDER BY label LIMIT $${i} OFFSET $${i + 1}`,
      [...values, safeLimit, safeOffset]
    );
    const count = await pool.query(`SELECT COUNT(*) FROM systems ${where}`, values);

    res.json({ systems: rows.rows, total: parseInt(count.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/systems', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const s = req.body;
    await pool.query(
      `INSERT INTO systems (id, label, x, y, layout_positions, owner, status, criticality, business_capability, tech_stack, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        s.id, s.label, s.x, s.y,
        JSON.stringify(s.layoutPositions || {}),
        s.owner || '', s.status || 'active', s.criticality || 'medium',
        s.businessCapability || '', JSON.stringify(s.techStack || []), s.description || ''
      ]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/systems/:id', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const { sets, values } = buildUpdate('systems', SYSTEM_COLUMNS, req.body);
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    values.push(req.params.id);
    await pool.query(`UPDATE systems SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/systems/:id', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    // ON DELETE CASCADE on data_objects.master_system_id and edges.source/target handles cleanup.
    await pool.query('DELETE FROM systems WHERE id = $1', [req.params.id]);
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

app.post('/api/data-objects', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const o = req.body;
    await pool.query(
      `INSERT INTO data_objects (id, name, master_system_id, aliases, description, classification)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [o.id, o.name, o.masterSystemId, JSON.stringify(o.aliases || {}), o.description || '', o.classification || 'internal']
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/data-objects/:id', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const { sets, values } = buildUpdate('data_objects', DATA_OBJECT_COLUMNS, req.body);
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    values.push(req.params.id);
    await pool.query(`UPDATE data_objects SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/data-objects/:id', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    await pool.query('DELETE FROM data_objects WHERE id = $1', [req.params.id]);
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

app.post('/api/edges', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const e = req.body;
    await pool.query(
      `INSERT INTO edges (id, source, target, data_object_ids, description, integration_pattern, frequency)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [e.id, e.source, e.target, JSON.stringify(e.dataObjectIds || []), e.description || '', e.integrationPattern || '', e.frequency || '']
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/edges/:id', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const { sets, values } = buildUpdate('edges', EDGE_COLUMNS, req.body);
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    values.push(req.params.id);
    await pool.query(`UPDATE edges SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/edges/:id', requireAuth, requireRole('admin', 'editor'), async (req, res) => {
  try {
    await pool.query('DELETE FROM edges WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
