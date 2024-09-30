const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://brusliste.vercel.app',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204
}));

app.use(express.json());

const pool = nw Pool({
	connectionString: process.env.POSTGRES_URL,
});

// Helper function to write data to file
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
	} finally {
		client.release();
	}
}

initializeDatabase().catch(console.error);

// GET endpoint to retrieve all people
app.get('/api/people', async (req, res) => {
	try {
		const result = await pool.query('SELECT * FROM people ORDER BY name');
		res.json(result.rows);
	}	catch (error) {
		console.error('Error fetching people:', error);
		res.status(500).json({ error: 'Internal server error});
	}
});

// POST endpoint to add or update a person
app.post('/api/people', async (req, res) => {
	const { name, beverages } = req.body;
	try {
		const result = await pool.query(
		INSERT INTO people (name, beverages) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET beverages = $2 RETURNING *',
		[name, beverages]
		);
		const updatedPeople = await pool.query('SELECT * FROM people ORDER BY name');
		res.json(updatedPeople.rows);
	}	catch (error) {
		console.error('Error adding/updating person:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// DELETE endpoint to remove a person
app.delete('/api/people/:name', async (req, res) => {
  const { name } = req.params;
  try {
	  await pool.query('DELETE FROM people WHERE name = $1',[name]);
	  const updatedPeople = await pool.query('SELECT * FROM people ORDER BY name');
	  res.json(updatedPeople.rows);
  }	catch (error) {
	  console.error('Error removing person:', error);
	  res.status(500).json({ error: 'Internal server error' });
  }  
});

app.options('*', cors());
// Vercel serverless function handler
module.exports = app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}