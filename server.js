const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const cors = require('cors');
const app = express();

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

// Middleware for API key auth
const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey) {
    return res.status(401).json({ error: 'API key is missing' });
  }

  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key', apiKey)
      .single();

    if (error || !data) {
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

// Get all people
app.get('/api/people', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('people')
      .select('*')
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching people:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add or update a person
app.post('/api/people', async (req, res) => {
  const { name, beverages, beverageType } = req.body;
  const client = supabase;
  try {
    await client.rpc('begin');
    
    const { data: existingPerson, error: selectError } = await client
      .from('people')
      .select('*')
      .eq('name', name)
      .single();

    if (selectError && selectError.code !== 'PGRST116') throw selectError;

    let person;
    if (existingPerson) {
      const { data, error } = await client
        .from('people')
        .update({ beverages: existingPerson.beverages + beverages, beverage_type: beverageType })
        .eq('id', existingPerson.id)
        .select();
      if (error) throw error;
      person = data[0];
    } else {
      const { data, error } = await client
        .from('people')
        .insert({ name, beverages, beverage_type: beverageType })
        .select();
      if (error) throw error;
      person = data[0];
    }

    if (beverages !== 0) {
      const { error: transactionError } = await client
        .from('transactions')
        .insert({
          person_id: person.id,
          beverages,
          amount: Math.abs(beverages) * 10,
          type: beverages > 0 ? 'purchase' : 'return',
          beverage_type: beverageType
        });
      if (transactionError) throw transactionError;
    }

    await client.rpc('commit');
    
    const { data: updatedPeople, error: peopleError } = await supabase
      .from('people')
      .select('*')
      .order('name');
    if (peopleError) throw peopleError;

    res.json(updatedPeople);
  } catch (error) {
    await client.rpc('rollback');
    console.error('Error updating beverages:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Process payment for a person
app.post('/api/people/:id/pay', async (req, res) => {
  const { id } = req.params;
  const client = supabase;
  try {
    await client.rpc('begin');
    
    const { data: person, error: personError } = await client
      .from('people')
      .select('*')
      .eq('id', id)
      .single();
    
    if (personError) throw personError;
    
    if (person && person.beverages > 0) {
      const { error: transactionError } = await client
        .from('transactions')
        .insert({
          person_id: person.id,
          beverages: person.beverages,
          amount: person.beverages * 10,
          type: 'payment',
          beverage_type: person.beverage_type
        });
      if (transactionError) throw transactionError;

      const { error: updateError } = await client
        .from('people')
        .update({ beverages: 0 })
        .eq('id', id);
      if (updateError) throw updateError;
    }
    
    await client.rpc('commit');
    
    const { data: updatedPeople, error: peopleError } = await supabase
      .from('people')
      .select('*')
      .order('name');
    if (peopleError) throw peopleError;

    res.json(updatedPeople);
  } catch (error) {
    await client.rpc('rollback');
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        *,
        people (name)
      `)
      .order('date', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process a quick buy
app.post('/api/quickbuy', async (req, res) => {
  const { beverageType } = req.body;
  const client = supabase;
  try {
    await client.rpc('begin');
    
    const { data, error } = await client
      .from('transactions')
      .insert({
        person_id: null,
        beverages: 1,
        amount: 10,
        type: 'quickbuy',
        beverage_type: beverageType
      })
      .select();

    if (error) throw error;
    
    await client.rpc('commit');
    
    res.json(data[0]);
  } catch (error) {
    await client.rpc('rollback');
    console.error('Error processing quick buy:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update transaction type
app.post('/api/update-transaction-type', async (req, res) => {
  const { transactionId, beverageType } = req.body;
  try {
    const { data, error } = await supabase
      .from('transactions')
      .update({ beverage_type: beverageType })
      .eq('id', transactionId)
      .select();

    if (error) throw error;
    if (data.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json(data[0]);
  } catch (error) {
    console.error('Error updating transaction type:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get statistics
app.get('/api/statistics', async (req, res) => {
  try {
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    const [currentMonthLeaderboard, allTimeLeaderboard, beverageTypeDistribution] = await Promise.all([
      // Current month leaderboard
      supabase
        .from('transactions')
        .select('people(name), beverages')
        .gte('date', currentMonthStart.toISOString())
        .eq('type', 'purchase')
        .order('beverages', { ascending: false })
        .limit(5),

      // All-time leaderboard
      supabase
        .from('transactions')
        .select('people(name), beverages')
        .eq('type', 'purchase')
        .order('beverages', { ascending: false })
        .limit(5),

      // Beverage type distribution
      supabase
        .from('transactions')
        .select('beverage_type, count')
        .eq('type', 'purchase')
        .group('beverage_type')
    ]);

    if (currentMonthLeaderboard.error) throw currentMonthLeaderboard.error;
    if (allTimeLeaderboard.error) throw allTimeLeaderboard.error;
    if (beverageTypeDistribution.error) throw beverageTypeDistribution.error;

    const totalPurchases = beverageTypeDistribution.data.reduce((sum, item) => sum + item.count, 0);
    const distributionWithPercentage = beverageTypeDistribution.data.map(item => ({
      ...item,
      percentage: (item.count / totalPurchases) * 100
    }));

    res.json({
      currentMonthLeaderboard: currentMonthLeaderboard.data,
      allTimeLeaderboard: allTimeLeaderboard.data,
      beverageTypeDistribution: distributionWithPercentage
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Generate API key
app.post('/generate-api-key', async (req, res) => {
  const apiKey = crypto.randomBytes(32).toString('hex');
  try {
    const { error } = await supabase
      .from('api_keys')
      .insert({ key: apiKey });
    if (error) throw error;
    res.json({ apiKey });
  } catch (error) {
    console.error('Error generating API key:', error);
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