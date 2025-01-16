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

app.post('/api/people', async (req, res) => {
  const { name, beverages, beverageType } = req.body;
  try {
    let person;
    const { data: existingPerson, error: fetchError } = await supabase
      .from('people')
      .select('*')
      .eq('name', name)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

    if (existingPerson) {
      const { data, error } = await supabase
        .from('people')
        .update({ 
          beverages: existingPerson.beverages + beverages, 
          beverage_type: beverageType 
        })
        .eq('id', existingPerson.id)
        .select()
        .single();
      
      if (error) throw error;
      person = data;
    } else {
      const { data, error } = await supabase
        .from('people')
        .insert({ name, beverages, beverage_type: beverageType })
        .select()
        .single();
      
      if (error) throw error;
      person = data;
    }

    if (beverages !== 0) {
      const { error: transactionError } = await supabase
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

    const { data: updatedPeople, error: peopleError } = await supabase
      .from('people')
      .select('*')
      .order('name');
    
    if (peopleError) throw peopleError;
    res.json(updatedPeople);
  } catch (error) {
    console.error('Error updating beverages:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.post('/api/people/:id/pay', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: person, error: personError } = await supabase
      .from('people')
      .select('*')
      .eq('id', id)
      .single();
    
    if (personError) throw personError;

    if (person && person.beverages > 0) {
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          id: generateUniqueId(),
          person_id: person.id,
          beverages: person.beverages,
          amount: person.beverages * 10,
          type: 'payment',
          beverage_type: person.beverage_type
        });
      
      if (transactionError) throw transactionError;

      const { error: updateError } = await supabase
        .from('people')
        .update({ beverages: 0 })
        .eq('id', id);
      
      if (updateError) throw updateError;
    }

    const { data: updatedPeople, error: peopleError } = await supabase
      .from('people')
      .select('*')
      .order('name');
    
    if (peopleError) throw peopleError;
    res.json(updatedPeople);
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    res.json(data.map(t => ({ ...t, name: t.people.name })));
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/quickbuy', async (req, res) => {
  const { beverageType } = req.body;
  try {
    const { data, error } = await supabase
      .from('transactions')
      .insert({
        id: generateUniqueId(),
        person_id: null,
        beverages: 1,
        amount: 10,
        type: 'quickbuy',
        beverage_type: beverageType
      })
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error processing quick buy:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New endpoints for coffee tracking

app.get('/api/coffee-mode', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coffee_tracker')
      .select('*')
      .order('user_id');
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching coffee data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/coffee-tracker', async (req, res) => {
  const { userId, cupsConsumed, coffeePurchased } = req.body;
  try {
    const { data: existingRecord, error: fetchError } = await supabase
      .from('coffee_tracker')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

    let result;
    if (existingRecord) {
      const { data, error } = await supabase
        .from('coffee_tracker')
        .update({ 
          cups_consumed: existingRecord.cups_consumed + cupsConsumed,
          coffee_purchased: existingRecord.coffee_purchased + coffeePurchased,
          updated_at: new Date()
        })
        .eq('user_id', userId)
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('coffee_tracker')
        .insert({ 
          user_id: userId, 
          cups_consumed: cupsConsumed, 
          coffee_purchased: coffeePurchased 
        })
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    }

    if (cupsConsumed > 0) {
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          id: generateUniqueId(),
          person_id: userId,
          beverages: cupsConsumed,
          amount: cupsConsumed,
          type: 'purchase',
          beverage_type: 'Coffee'
        });
      
      if (transactionError) throw transactionError;
    }

    if (coffeePurchased > 0) {
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          id: generateUniqueId(),
          person_id: userId,
          beverages: 0,
          amount: -coffeePurchased,
          type: 'coffee_purchase',
          beverage_type: 'Ground Coffee'
        });
      
      if (transactionError) throw transactionError;
    }

    res.json(result);
  } catch (error) {
    console.error('Error updating coffee tracker:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/coffee-balance', async (req, res) => {
  try {
    console.log('Fetching coffee balance...');
    const { data, error } = await supabase.rpc('get_coffee_balance');
    
    if (error) {
      console.error('Supabase error:', JSON.stringify(error, null, 2));
      throw error;
    }
    
    console.log('Coffee balance data:', JSON.stringify(data, null, 2));
    res.json(data);
  } catch (error) {
    console.error('Error fetching coffee balance:', JSON.stringify(error, null, 2));
    res.status(500).json({ 
      error: 'Intern serverfeil', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}