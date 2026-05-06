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
    
    DO $$ 
    BEGIN 
      BEGIN 
        ALTER TABLE systems ADD COLUMN layout_positions JSONB DEFAULT '{}'; 
      EXCEPTION 
        WHEN duplicate_column THEN NULL; 
      END; 
    END $$;
    
    CREATE TABLE IF NOT EXISTS data_objects (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      master_system_id VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      aliases JSONB DEFAULT '{}'
    );
    
    -- Add aliases column if it doesn't exist (for existing DBs)
    DO $$ 
    BEGIN 
      BEGIN 
        ALTER TABLE data_objects ADD COLUMN aliases JSONB DEFAULT '{}'; 
      EXCEPTION 
        WHEN duplicate_column THEN NULL; 
      END; 
    END $$;

    CREATE TABLE IF NOT EXISTS edges (
      id VARCHAR(255) PRIMARY KEY,
      source VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      target VARCHAR(255) REFERENCES systems(id) ON DELETE CASCADE,
      data_object_ids JSONB DEFAULT '[]'
    );
  `);
}

initDB().catch(console.error);

// GET all state
app.get('/api/state', async (req, res) => {
  try {
    const systemsRes = await pool.query('SELECT * FROM systems');
    const objectsRes = await pool.query('SELECT * FROM data_objects');
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

// POST to update entire state (simplest way to sync)
// For a production app we'd want individual CRUD, but full-state sync is easiest for a visual canvas.
app.post('/api/state', async (req, res) => {
  const { systems, dataObjects, edges } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Clear existing
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM data_objects');
    await client.query('DELETE FROM systems');

    // Insert systems
    for (const sys of systems) {
      await client.query('INSERT INTO systems (id, label, x, y, layout_positions) VALUES ($1, $2, $3, $4, $5)', 
        [sys.id, sys.data.label, sys.position.x, sys.position.y, JSON.stringify(sys.data.layoutPositions || {})]);
    }

    // Insert data objects
    for (const obj of dataObjects) {
      await client.query('INSERT INTO data_objects (id, name, master_system_id, aliases) VALUES ($1, $2, $3, $4)', 
        [obj.id, obj.name, obj.masterSystemId, JSON.stringify(obj.aliases || {})]);
    }

    // Insert edges
    for (const edge of edges) {
      await client.query('INSERT INTO edges (id, source, target, data_object_ids) VALUES ($1, $2, $3, $4)', 
        [edge.id, edge.source, edge.target, JSON.stringify(edge.data.dataObjectIds)]);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
