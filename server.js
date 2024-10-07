const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const cors = require('cors');
const app = express();


const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'https://brusliste.vercel.app',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

app.use(express.json());

//Middleware for API key auth
const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey) {
    return res.status(401).json({ error: 'API key is missing' });
  }

  try {
    const result = await pool.query('SELECT * FROM api_keys WHERE key = $1', [apiKey]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    // You might want to check if the key is expired here
    next();
  } catch (error) {
    console.error('Error verifying API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.use('/api', apiKeyAuth);

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS people (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        beverages INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        person_id INTEGER REFERENCES people(id),
        date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        beverages INTEGER NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        type TEXT NOT NULL
      )
    `);
  } finally {
    client.release();
  }
}

initializeDatabase().catch(console.error);

app.get('/api/people', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM people ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching people:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/generate-api-key', async (req, res) => {
  const apiKey = crypto.randomBytes(32).toString('hex');
  try {
    await pool.query('INSERT INTO api_keys (key) VALUES ($1)', [apiKey]);
    res.json({ apiKey });
  } catch (error) {
    console.error('Error generating API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/people', async (req, res) => {
  const { name, beverages, beverageType } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // First, check if the person exists
    const personCheck = await client.query('SELECT * FROM people WHERE name = $1', [name]);
    
    let person;
    if (personCheck.rows.length === 0) {
      // If person doesn't exist, insert a new record
      const insertResult = await client.query(
        'INSERT INTO people (name, beverages, beverage_type) VALUES ($1, $2, $3) RETURNING *',
        [name, beverages, beverageType]
      );
      person = insertResult.rows[0];
    } else {
      // If person exists, update their record
      const updateResult = await client.query(
        'UPDATE people SET beverages = beverages + $1, beverage_type = $2 WHERE name = $3 RETURNING *',
        [beverages, beverageType, name]
      );
      person = updateResult.rows[0];
    }
    
    // Only insert a transaction if beverages were added or removed
    if (beverages !== 0) {
      await client.query(
        'INSERT INTO transactions (person_id, beverages, amount, type, beverage_type) VALUES ($1, $2, $3, $4, $5)',
        [person.id, beverages, Math.abs(beverages) * 10, beverages > 0 ? 'purchase' : 'return', beverageType]
      );
    }
    
    await client.query('COMMIT');
    
    const updatedPeople = await client.query('SELECT * FROM people ORDER BY name');
    res.json(updatedPeople.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating beverages:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/people/:id/pay', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const personResult = await client.query('SELECT * FROM people WHERE id = $1', [id]);
    const person = personResult.rows[0];
    
    if (person && person.beverages > 0) {
      await client.query(
        'INSERT INTO transactions (person_id, beverages, amount, type, beverage_type) VALUES ($1, $2, $3, $4, $5)',
        [person.id, person.beverages, person.beverages * 10, 'payment', person.beverage_type]
      );
      await client.query('UPDATE people SET beverages = 0 WHERE id = $1', [id]);
    }
    
    await client.query('COMMIT');
    
    const updatedPeople = await client.query('SELECT * FROM people ORDER BY name');
    res.json(updatedPeople.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, p.name 
      FROM transactions t 
      JOIN people p ON t.person_id = p.id 
      ORDER BY t.date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/quickbuy', async (req, res) => {
  const { beverageType } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert a new transaction for the quick buy
    const result = await client.query(
      'INSERT INTO transactions (person_id, beverages, amount, type, beverage_type) VALUES (NULL, 1, 10, $1, $2) RETURNING *',
      ['quickbuy', beverageType]
    );

    await client.query('COMMIT');
    
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing quick buy:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.post('/api/update-transaction-type', async (req, res) => {
  const { transactionId, beverageType } = req.body;
  try {
    const result = await pool.query(
      'UPDATE transactions SET beverage_type = $1 WHERE id = $2 RETURNING *',
      [beverageType, transactionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating transaction type:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/statistics', async (req, res) => {
  const client = await pool.connect();
  try {
    // Current month leaderboard
    const currentMonthLeaderboard = await client.query(`
      SELECT p.name, SUM(t.beverages) as total_beverages
      FROM transactions t
      JOIN people p ON t.person_id = p.id
      WHERE t.date >= DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY p.name
      ORDER BY total_beverages DESC
      LIMIT 5
    `);

    // All-time leaderboard
    const allTimeLeaderboard = await client.query(`
      SELECT p.name, SUM(t.beverages) as total_beverages
      FROM transactions t
      JOIN people p ON t.person_id = p.id
      GROUP BY p.name
      ORDER BY total_beverages DESC
      LIMIT 5
    `);

    // Beverage type distribution
    const beverageTypeDistribution = await client.query(`
      SELECT beverage_type, COUNT(*) as count, 
             COUNT(*) * 100.0 / (SELECT COUNT(*) FROM transactions) as percentage
      FROM transactions
      GROUP BY beverage_type
      ORDER BY count DESC
    `);

    res.json({
      currentMonthLeaderboard: currentMonthLeaderboard.rows,
      allTimeLeaderboard: allTimeLeaderboard.rows,
      beverageTypeDistribution: beverageTypeDistribution.rows
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  } finally {
    client.release();
  }
});

app.options('*', cors(corsOptions));

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}