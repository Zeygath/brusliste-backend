const express = require('express');
const { Pool } = require('pg');

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://brusliste.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

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

app.post('/api/people', async (req, res) => {
  const { name, beverages } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const personResult = await client.query(
      'INSERT INTO people (name, beverages) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET beverages = people.beverages + $2 RETURNING *',
      [name, beverages]
    );
    const person = personResult.rows[0];
    
    if (beverages > 0) {
      await client.query(
        'INSERT INTO transactions (person_id, beverages, amount, type) VALUES ($1, $2, $3, $4)',
        [person.id, beverages, beverages * 2, 'purchase']
      );
    }
    
    await client.query('COMMIT');
    
    const updatedPeople = await client.query('SELECT * FROM people ORDER BY name');
    res.json(updatedPeople.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding/updating person:', error);
    res.status(500).json({ error: 'Internal server error' });
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
        'INSERT INTO transactions (person_id, beverages, amount, type) VALUES ($1, $2, $3, $4)',
        [person.id, person.beverages, person.beverages * 2, 'payment']
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

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}