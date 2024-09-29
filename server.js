const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://brusliste.vercel.app',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// Use /tmp directory for file storage on Vercel
const dataFile = path.join('/tmp', 'beverageData.json');

// Helper function to read data from file
async function readData() {
  try {
    await fs.access(dataFile);
    const data = await fs.readFile(dataFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading file:', error);
    return [];
  }
}

// Helper function to write data to file
async function writeData(data) {
  try {
    await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing file:', error);
  }
}

// GET endpoint to retrieve all people
app.get('/api/people', async (req, res) => {
  const people = await readData();
  res.json(people);
});

// POST endpoint to add or update a person
app.post('/api/people', async (req, res) => {
  const { name, beverages } = req.body;
  const people = await readData();
  const existingPersonIndex = people.findIndex(p => p.name === name);
  
  if (existingPersonIndex !== -1) {
    people[existingPersonIndex].beverages = beverages;
  } else {
    people.push({ name, beverages });
  }
  
  await writeData(people);
  res.json(people);
});

// DELETE endpoint to remove a person
app.delete('/api/people/:name', async (req, res) => {
  const { name } = req.params;
  let people = await readData();
  people = people.filter(p => p.name !== name);
  await writeData(people);
  res.json(people);
});

// Vercel serverless function handler
module.exports = app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}