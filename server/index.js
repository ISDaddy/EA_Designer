const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

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

initDB().catch(console.error);

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
// Aggregate read - used to hydrate the canvas in one round trip.
// ---------------------------------------------------------------------------
app.get('/api/state', async (req, res) => {
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
app.get('/api/systems', async (req, res) => {
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

app.post('/api/systems', async (req, res) => {
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

app.patch('/api/systems/:id', async (req, res) => {
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

app.delete('/api/systems/:id', async (req, res) => {
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
app.get('/api/data-objects', async (req, res) => {
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

app.post('/api/data-objects', async (req, res) => {
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

app.patch('/api/data-objects/:id', async (req, res) => {
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

app.delete('/api/data-objects/:id', async (req, res) => {
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
app.get('/api/edges', async (req, res) => {
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

app.post('/api/edges', async (req, res) => {
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

app.patch('/api/edges/:id', async (req, res) => {
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

app.delete('/api/edges/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM edges WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
