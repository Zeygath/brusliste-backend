const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const dataFile = path.join(__dirname, 'beverageData.json');

// Helper function to read data from file
async function readData() {
  try {
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

app.listen(port, () => {
  console.log(`Server running at https://brusliste-backend.vercel.app:${port}`);
});