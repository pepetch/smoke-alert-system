const express = require("express");
const { Pool } = require("pg");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

//////////////////////////////////////////////////
// CONNECT POSTGRES
//////////////////////////////////////////////////

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

//////////////////////////////////////////////////
// AUTO CREATE TABLE (เพิ่ม status)
//////////////////////////////////////////////////

async function initDB() {
  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS smoke_logs (
        id SERIAL PRIMARY KEY,
        smoke FLOAT,
        status VARCHAR(20),
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
// GET ALL LOGS
//////////////////////////////////////////////////

app.get("/logs", async (req, res) => {

  try {

    const result = await pool.query(
      "SELECT * FROM smoke_logs ORDER BY created_at DESC LIMIT 100"
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).send("DB ERROR");
  }
});

//////////////////////////////////////////////////
// GET LATEST
//////////////////////////////////////////////////

app.get("/latest", async (req, res) => {

  try {

    const result = await pool.query(
      "SELECT * FROM smoke_logs ORDER BY created_at DESC LIMIT 1"
    );

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

    const { smoke, status } = req.body;

    if (smoke === undefined || status === undefined) {
      return res.status(400).send("Missing data");
    }

    console.log("🔥 Smoke:", smoke, "| Status:", status);

    // Save DB
    await pool.query(
      "INSERT INTO smoke_logs(smoke, status) VALUES($1, $2)",
      [smoke, status]
    );

    console.log("✅ SAVED TO DB");

    // Send LINE if DANGER or FIRE
    if (status === "DANGER" || status === "FIRE") {
      await sendLineAlert(smoke, status);
    }

    res.send("OK");

  } catch (err) {

    console.error(err);
    res.status(500).send("SERVER ERROR");
  }
});

//////////////////////////////////////////////////
// LINE ALERT (ส่งจาก SERVER)
//////////////////////////////////////////////////

async function sendLineAlert(smoke, status) {

  const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!LINE_TOKEN) {
    console.log("⚠ LINE token not set");
    return;
  }

  await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({
      messages: [{
        type: "text",
        text: `🚨 ALERT\nSmoke: ${smoke} ppm\nStatus: ${status}`
      }]
    })
  });

  console.log("📲 LINE SENT");
}

//////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Server running on port", PORT);
});
