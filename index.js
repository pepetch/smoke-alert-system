const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

//////////////////////////////////////////////////
// CONNECT POSTGRES
//////////////////////////////////////////////////

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

//////////////////////////////////////////////////
// AUTO CREATE TABLE
//////////////////////////////////////////////////

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS smoke_logs (
      id SERIAL PRIMARY KEY,
      smoke FLOAT,
      alcohol FLOAT,
      lpg FLOAT,
      status VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("✅ smoke_logs table ready");
}

initDB();

//////////////////////////////////////////////////
// ROOT
//////////////////////////////////////////////////

app.get("/", (req, res) => {
  res.send("🔥 Smoke Alert Server Running...");
});

//////////////////////////////////////////////////
// GET ALL LOGS
//////////////////////////////////////////////////

app.get("/logs", async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT 
        id,
        smoke,
        alcohol,
        lpg,
        status,
        TO_CHAR(created_at AT TIME ZONE 'Asia/Bangkok',
                'DD/MM/YYYY HH24:MI:SS') AS created_at
      FROM smoke_logs
      ORDER BY id DESC
      LIMIT 50
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).send("DB ERROR");
  }
});

//////////////////////////////////////////////////
// GET LATEST
//////////////////////////////////////////////////

app.get("/smocklog", async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT 
        id,
        smoke,
        alcohol,
        lpg,
        status,
        TO_CHAR(created_at AT TIME ZONE 'Asia/Bangkok',
                'DD/MM/YYYY HH24:MI:SS') AS created_at
      FROM smoke_logs
      ORDER BY id DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({});
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).send("DB ERROR");
  }
});

//////////////////////////////////////////////////
// RECEIVE DATA FROM ESP8266
//////////////////////////////////////////////////

app.post("/smoke", async (req, res) => {
  try {

    const { smoke, alcohol, lpg, status } = req.body;

    if (smoke === undefined || alcohol === undefined || lpg === undefined || !status) {
      return res.status(400).send("Missing data");
    }

    await pool.query(
      "INSERT INTO smoke_logs(smoke, alcohol, lpg, status) VALUES($1,$2,$3,$4)",
      [smoke, alcohol, lpg, status]
    );

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
