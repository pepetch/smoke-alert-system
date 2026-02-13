const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

//////////////////////////////////////////////////
// CONNECT POSTGRES
//////////////////////////////////////////////////

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

//////////////////////////////////////////////////
// AUTO CREATE TABLE
//////////////////////////////////////////////////

async function initDB() {
  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS smoke_logs (
        id SERIAL PRIMARY KEY,
        smoke INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("✅ smoke_logs table ready");

  } catch (err) {

    console.error("DB ERROR:", err);
  }
}

initDB();

//////////////////////////////////////////////////
// ROOT
//////////////////////////////////////////////////

app.get("/", (req, res) => {
  res.send("🔥 Smoke Alert Server Running...");
});

//////////////////////////////////////////////////
// TEST DB
//////////////////////////////////////////////////

app.get("/test-db", async (req, res) => {

  const result = await pool.query("SELECT NOW()");
  res.json(result.rows);

});

//////////////////////////////////////////////////
// GET ALL LOGS ⭐⭐⭐
//////////////////////////////////////////////////

app.get("/logs", async (req, res) => {

  try{

    const result = await pool.query(
      "SELECT * FROM smoke_logs ORDER BY created_at DESC LIMIT 50"
    );

    res.json(result.rows);

  }catch(err){

    console.error(err);
    res.status(500).send("DB ERROR");
  }
});

//////////////////////////////////////////////////
// GET LATEST ⭐⭐⭐
//////////////////////////////////////////////////

app.get("/latest", async (req, res) => {

  try{

    const result = await pool.query(
      "SELECT * FROM smoke_logs ORDER BY created_at DESC LIMIT 1"
    );

    res.json(result.rows[0]);

  }catch(err){

    console.error(err);
    res.status(500).send("DB ERROR");
  }
});

//////////////////////////////////////////////////
// RECEIVE DATA FROM ESP8266 ⭐⭐⭐
//////////////////////////////////////////////////

app.post("/smoke", async (req, res) => {

  try {

    // 🔥 รับได้ทั้ง value และ smoke
    const smokeValue = req.body.value || req.body.smoke;

    if(smokeValue === undefined){
      return res.status(400).send("No smoke value");
    }

    console.log("🔥 Smoke:", smokeValue);

    await pool.query(
      "INSERT INTO smoke_logs(smoke) VALUES($1)",
      [smokeValue]
    );

    console.log("✅ SAVED TO DB");

    res.send("OK");

  } catch (err) {

    console.error(err);
    res.status(500).send("DB INSERT ERROR");
  }
});

//////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Server running on port", PORT);
});
