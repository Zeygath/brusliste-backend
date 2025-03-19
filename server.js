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

const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header("X-API-Key")
  if (!apiKey) {
    return res.status(401).json({ error: "API key is missing" })
  }

  try {
    const { data, error } = await supabase.from("api_keys").select("*").eq("key", apiKey).single()

    if (error || !data) {
      return res.status(401).json({ error: "Invalid API key" })
    }
    next()
  } catch (error) {
    console.error("Error verifying API key:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

app.use("/api", apiKeyAuth)

// Add this near the top of your file, after creating the supabase client
app.use("/api", (req, res, next) => {
  // Get location_id from query parameter, header, or default to 1 (Office 1)
  const locationId = Number.parseInt(req.query.location_id || req.header("X-Location-Id") || 1)
  req.locationId = locationId
  next()
})

// Existing endpoints...

// New endpoint for inventory management
app.get("/api/inventory", async (req, res) => {
  try {
    const { data, error } = await supabase.from("inventory").select("*").eq("location_id", req.locationId)

    if (error) throw error
    res.json(data)
  } catch (error) {
    console.error("Error fetching inventory:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

app.post("/api/inventory/update", async (req, res) => {
  const { beverageType, quantity } = req.body
  try {
    const { data, error } = await supabase
      .from("inventory")
      .upsert(
        {
          beverage_type: beverageType,
          quantity,
          location_id: req.locationId,
        },
        {
          onConflict: "beverage_type,location_id",
        },
      )
      .select()

    if (error) throw error
    res.json(data[0])
  } catch (error) {
    console.error("Error updating inventory:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Update existing endpoints to manage inventory

// Update the /api/people endpoint
app.get("/api/people", async (req, res) => {
  try {
    const { data, error } = await supabase.from("people").select("*").eq("location_id", req.locationId).order("name")

    if (error) throw error
    res.json(data)
  } catch (error) {
    console.error("Error fetching people:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Update the POST /api/people endpoint
app.post("/api/people", async (req, res) => {
  const { name, beverages, beverageType } = req.body
  try {
    let person
    const { data: existingPerson, error: fetchError } = await supabase
      .from("people")
      .select("*")
      .eq("name", name)
      .eq("location_id", req.locationId)
      .single()

    if (fetchError && fetchError.code !== "PGRST116") throw fetchError

    if (existingPerson) {
      const { data, error } = await supabase
        .from("people")
        .update({
          beverages: existingPerson.beverages + beverages,
          beverage_type: beverageType,
        })
        .eq("id", existingPerson.id)
        .select()
        .single()

      if (error) throw error
      person = data
    } else {
      const { data, error } = await supabase
        .from("people")
        .insert({
          name,
          beverages,
          beverage_type: beverageType,
          location_id: req.locationId,
        })
        .select()
        .single()

      if (error) throw error
      person = data
    }

    if (beverages !== 0) {
      const { error: transactionError } = await supabase.from("transactions").insert({
        person_id: person.id,
        beverages,
        amount: Math.abs(beverages) * 10,
        type: beverages > 0 ? "purchase" : "return",
        beverage_type: beverageType,
        location_id: req.locationId,
      })

      if (transactionError) throw transactionError

      // Update inventory
      const { data: inventoryData, error: inventoryError } = await supabase
        .from("inventory")
        .select("quantity")
        .eq("beverage_type", beverageType)
        .eq("location_id", req.locationId)
        .single()

      if (inventoryError && inventoryError.code !== "PGRST116") throw inventoryError

      const currentQuantity = inventoryData ? inventoryData.quantity : 0
      const newQuantity = currentQuantity - beverages

      const { error: updateInventoryError } = await supabase.from("inventory").upsert(
        {
          beverage_type: beverageType,
          quantity: newQuantity,
          location_id: req.locationId,
        },
        {
          onConflict: "beverage_type,location_id",
        },
      )

      if (updateInventoryError) throw updateInventoryError
    }

    const { data: updatedPeople, error: peopleError } = await supabase
      .from("people")
      .select("*")
      .eq("location_id", req.locationId)
      .order("name")

    if (peopleError) throw peopleError
    res.json(updatedPeople)
  } catch (error) {
    console.error("Error updating beverages:", error)
    res.status(500).json({ error: "Internal server error", details: error.message })
  }
})

// Update the /api/quickbuy endpoint
app.post("/api/quickbuy", async (req, res) => {
  const { beverageType } = req.body
  try {
    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .insert({
        person_id: null,
        beverages: 1,
        amount: 10,
        type: "quickbuy",
        beverage_type: beverageType,
        location_id: req.locationId,
      })
      .select()
      .single()

    if (transactionError) throw transactionError

    // Update inventory
    const { data: inventoryData, error: inventoryError } = await supabase
      .from("inventory")
      .select("quantity")
      .eq("beverage_type", beverageType)
      .eq("location_id", req.locationId)
      .single()

    if (inventoryError && inventoryError.code !== "PGRST116") throw inventoryError

    const currentQuantity = inventoryData ? inventoryData.quantity : 0
    const newQuantity = currentQuantity - 1

    const { error: updateInventoryError } = await supabase.from("inventory").upsert(
      {
        beverage_type: beverageType,
        quantity: newQuantity,
        location_id: req.locationId,
      },
      {
        onConflict: "beverage_type,location_id",
      },
    )

    if (updateInventoryError) throw updateInventoryError

    res.json(transaction)
  } catch (error) {
    console.error("Error processing quick buy:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

app.delete("/api/people/:id", async (req, res) => {
  const { id } = req.params
  try {
    // First verify the person belongs to the current location
    const { data: person, error: personError } = await supabase
      .from("people")
      .select("*")
      .eq("id", id)
      .eq("location_id", req.locationId)
      .single()

    if (personError) throw personError

    if (!person) {
      return res.status(404).json({ error: "Person not found in this location" })
    }

    const { error } = await supabase.from("people").delete().eq("id", id)

    if (error) throw error

    const { data: updatedPeople, error: peopleError } = await supabase
      .from("people")
      .select("*")
      .eq("location_id", req.locationId)
      .order("name")

    if (peopleError) throw peopleError
    res.json(updatedPeople)
  } catch (error) {
    console.error("Error deleting person:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

app.get("/api/statistics", async (req, res) => {
  try {
    // Current month leaderboard
    const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
    const { data: currentMonthLeaderboard, error: currentMonthError } = await supabase
      .from("transactions")
      .select("person_id, people(name), sum(beverages)")
      .eq("type", "purchase")
      .eq("location_id", req.locationId)
      .gte("date", `${currentMonth}-01`)
      .group("person_id, people(name)")
      .order("sum", { ascending: false })
      .limit(5)

    if (currentMonthError) throw currentMonthError

    // All-time leaderboard
    const { data: allTimeLeaderboard, error: allTimeError } = await supabase
      .from("transactions")
      .select("person_id, people(name), sum(beverages)")
      .eq("type", "purchase")
      .eq("location_id", req.locationId)
      .group("person_id, people(name)")
      .order("sum", { ascending: false })
      .limit(5)

    if (allTimeError) throw allTimeError

    // Beverage type distribution
    const { data: beverageTypeDistribution, error: distributionError } = await supabase
      .from("transactions")
      .select("beverage_type, count(*)")
      .eq("location_id", req.locationId)
      .group("beverage_type")
      .order("count", { ascending: false })

    if (distributionError) throw distributionError

    // Calculate total transactions for percentage
    const { count: totalTransactions, error: countError } = await supabase
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .eq("location_id", req.locationId)

    if (countError) throw countError

    // Calculate percentages
    const distributionWithPercentage = beverageTypeDistribution.map((item) => ({
      beverage_type: item.beverage_type,
      count: item.count,
      percentage: ((item.count * 100.0) / totalTransactions).toFixed(2),
    }))

    res.json({
      currentMonthLeaderboard: currentMonthLeaderboard.map((item) => ({
        name: item.people.name,
        total_beverages: item.sum,
      })),
      allTimeLeaderboard: allTimeLeaderboard.map((item) => ({
        name: item.people.name,
        total_beverages: item.sum,
      })),
      beverageTypeDistribution: distributionWithPercentage,
    })
  } catch (error) {
    console.error("Error fetching statistics:", error)
    res.status(500).json({ error: "Internal server error", details: error.message })
  }
})

// Add a new endpoint to get available locations
app.get("/api/locations", async (req, res) => {
  try {
    const { data, error } = await supabase.from("locations").select("*").order("name")

    if (error) throw error
    res.json(data)
  } catch (error) {
    console.error("Error fetching locations:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

module.exports = app


if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}