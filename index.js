const express = require("express");
const { Pool } = require("pg");
const ExcelJS = require("exceljs");
const axios = require("axios");

const app = express();
app.use(express.json());
//////////////////////////////////////////////////
// LINE ALERT SYSTEM
//////////////////////////////////////////////////

let lastSmokeAlert = 0;
let lastAlcoholAlert = 0;
let lastLpgAlert = 0;
let lastGlobalAlert = 0;

const FIRE_COOLDOWN = 60000;      // 1 นาที
const DANGER_COOLDOWN = 300000;   // 5 นาที
const GLOBAL_ALERT_COOLDOWN = 15000; // กัน spam 15 วินาที
//////////////////////////////////////////////////
// CONNECT POSTGRES
//////////////////////////////////////////////////

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});
//////////////////////////////////////////////////
// 🔥 TEMPLATE FUNCTION (วางตรงนี้)
//////////////////////////////////////////////////

function renderSubPage(title, headers, rows, exportUrl) {
  return `
  <html>
  <head>
    <title>${title}</title>
    <style>
      body {
        font-family: Arial;
        background:#111;
        color:white;
        margin:0;
        padding:20px;
      }

      h2 {
        margin-bottom: 15px;
      }

      .btn-export {
        background:#28a745;
        color:white;
        text-decoration:none;
        padding:10px 15px;
        border-radius:5px;
        margin-right:10px;
        display:inline-block;
      }

      .btn-delete {
        background:#dc3545;
        color:white;
        padding:10px 15px;
        border-radius:5px;
        text-decoration:none;
        margin-right:10px;
        display:inline-block;
      }

      .btn-back {
        background:#007bff;
        color:white;
        padding:10px 15px;
        border-radius:5px;
        text-decoration:none;
        margin-right:10px;
        display:inline-block;
      }

      table {
        border-collapse: collapse;
        width:100%;
        margin-top:15px;
      }

      th, td {
        border: 1px solid #555;
        padding: 10px;
        text-align: center;
      }

      th {
        background:#222;
      }

      tr:nth-child(even) {
        background:#1a1a1a;
      }

    </style>
  </head>
  <body>

    <h2>${title}</h2>

    <div style="margin-bottom:15px;">
      <a href="/table" class="btn-back">⬅ Back</a>
      <a href="${exportUrl}" class="btn-export">📊 Export Excel</a>
      <a href="/delete-all" class="btn-delete">🗑 Clear Data</a>
    </div>

    <table>
      ${headers}
      ${rows}
    </table>

  </body>
  </html>
  `;
}

//////////////////////////////////////////////////
// START SERVER AFTER DB READY
//////////////////////////////////////////////////

async function startServer() {
  try {
    await pool.query("SELECT NOW()");
    console.log("✅ Database Connected");


    // สร้างใหม่ให้ครบทุก column
    await pool.query(`
      CREATE TABLE IF NOT EXISTS smoke_logs (
        id SERIAL PRIMARY KEY,
        smoke FLOAT,
        smoke_status VARCHAR(20),
        alcohol FLOAT,
        alcohol_status VARCHAR(20),
        lpg FLOAT,
        lpg_status VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`
      ALTER TABLE smoke_logs
      ADD COLUMN IF NOT EXISTS smoke_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS alcohol_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS lpg_status VARCHAR(20);
    `);

    console.log("✅ Table recreated completely");

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log("🔥 Server running on port", PORT);
    });

  } catch (err) {
    console.error("❌ STARTUP ERROR:", err);
  }
}
//////////////////////////////////////////////////
// ROUTES
//////////////////////////////////////////////////
//////////////////////////////////////////////////
// TEST MODE CONTROL
//////////////////////////////////////////////////

let currentMode = 0; 
// 0 = AUTO
// 1 = Smoke
// 2 = Alcohol
// 3 = LPG

// Root
app.get("/", (req, res) => {
  res.send("🔥 Smoke Alert Server Running...");
});

// ให้ ESP ดึงโหมด
app.get("/get-mode", (req, res) => {
  res.json({ mode: currentMode });
});

// เปลี่ยนโหมดจากเว็บ
app.get("/set-mode/:id", (req, res) => {

  const mode = parseInt(req.params.id);

  if (mode >= 0 && mode <= 3) {
    currentMode = mode;
  }

  res.redirect("/table");
});

// Get all logs
app.get("/logs", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
        smoke,
        smoke_status,
        alcohol,
        alcohol_status,
        lpg,
        lpg_status
      FROM smoke_logs
      ORDER BY id DESC
      LIMIT 50
    `);

    res.json(result.rows);

  } catch (err) {
    console.error("❌ GET LOGS ERROR:", err);
    res.status(500).send("DB ERROR");
  }
});

// Get latest log
app.get("/smokelog", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
        smoke,
        alcohol,
        lpg,
        smoke_status,
        alcohol_status,
        lpg_status
      FROM smoke_logs
      ORDER BY id DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({});
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("❌ GET LATEST ERROR:", err);
    res.status(500).send("DB ERROR");
  }
});
app.get("/table", async (req, res) => {
  try {
  const result = await pool.query(`
    SELECT 
      id,
      TO_CHAR(created_at,'DD/MM/YYYY HH24:MI:SS') AS created_at,
      smoke,
      smoke_status,
      alcohol,
      alcohol_status,
      lpg,
      lpg_status
    FROM smoke_logs
    ORDER BY id DESC
    LIMIT 1000
  `);

let rows = result.rows.map(row => {

  function color(status){
    if(status === "SAFE") return "#28a745";
    if(status === "WARNING") return "#ffc107";
    if(status === "DANGER") return "#fd7e14";
    if(status === "FIRE") return "#dc3545";
    return "white";
  }

  return `
    <tr>
      <td>${row.id}</td>
      <td>${row.created_at}</td>

      <td>${row.smoke}</td>
      <td style="color:${color(row.smoke_status)};font-weight:bold;">
        ${row.smoke_status}
      </td>

      <td>${row.alcohol}</td>
      <td style="color:${color(row.alcohol_status)};font-weight:bold;">
        ${row.alcohol_status}
      </td>

      <td>${row.lpg}</td>
      <td style="color:${color(row.lpg_status)};font-weight:bold;">
        ${row.lpg_status}
      </td>
    </tr>
  `;
}).join("");

res.send(`
  <html>
  <head>
    <title>Smoke Logs</title>
  <style>
    body {
      font-family: Arial;
      background:#111;
      color:white;
      margin:0;
      padding:20px;
    }

    h2 {
      margin-bottom: 15px;
    }

    .table-container {
      width:100%;
      overflow-x:auto;
    }

    table {
      border-collapse: collapse;
      width:100%;
      min-width:700px;
    }

    th, td {
      border: 1px solid #555;
      padding: 10px;
      text-align: center;
      white-space: nowrap;
    }

    th {
      background:#222;
    }

    tr:nth-child(even) {
      background:#1a1a1a;
    }

    button {
      padding:10px 15px;
      border:none;
      border-radius:5px;
      cursor:pointer;
    }

    .btn-export {
      background:#28a745;
      color:white;
      text-decoration:none;
      padding:10px 15px;
      border-radius:5px;
      margin-right:10px;
    }

    .btn-delete {
      background:#dc3545;
      color:white;
    }

  </style>
  </head>
  <body>

    <h2>🔥 Alert Logs</h2>

  <div style="margin-bottom:15px;">
  
    <a href="/export-excel" class="btn-export">
      📊 Export Excel
    </a>
  
    <a href="/smoke-data" class="btn-export">
      💨 Smoke
    </a>
  
    <a href="/alcohol-data" class="btn-export">
      🧴 Alcohol
    </a>
  
    <a href="/lpg-data" class="btn-export">
      🧯 LPG
    </a>
  
    <form action="/delete-all" method="GET" style="display:inline;">
      <button type="submit" class="btn-delete">
        🗑 Clear Data
      </button>
    </form>

    <hr style="margin:10px 0;">

<b>Test Mode:</b><br><br>

<a href="/set-mode/0" class="btn-export">🟢 AUTO</a>
<a href="/set-mode/1" class="btn-export">💨 Test Smoke</a>
<a href="/set-mode/2" class="btn-export">🧴 Test Alcohol</a>
<a href="/set-mode/3" class="btn-export">🧯 Test LPG</a>
  
  </div>

    <div class="table-container">
      <table>
      <tr>
      <th>ID</th>
      <th>Datetime</th>
      <th>Smoke</th>
      <th>Smoke Status</th>
      <th>Alcohol</th>
      <th>Alcohol Status</th>
      <th>LPG</th>
      <th>LPG Status</th>
      </tr>
        ${rows}
      </table>
    </div>

  </body>
  </html>
`);

  } catch (err) {
    res.status(500).send("DB ERROR");
  }
});

// Receive data from ESP8266
app.post("/smoke", async (req, res) => {
  try {
    let shouldSend = false;
    const {
  smoke, smoke_status,
  alcohol, alcohol_status,
  lpg, lpg_status
  } = req.body;

    if (
      smoke === undefined ||
      smoke_status === undefined ||
      alcohol === undefined ||
      alcohol_status === undefined ||
      lpg === undefined ||
      lpg_status === undefined
    )
    {
      return res.status(400).send("Missing data");
    }

    await pool.query(
      `INSERT INTO smoke_logs
       (smoke, smoke_status, alcohol, alcohol_status, lpg, lpg_status)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [smoke, smoke_status, alcohol, alcohol_status, lpg, lpg_status]
    );
  
 const time = new Date().toLocaleString("th-TH", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

const message = buildLineMessage(
  smoke,
  alcohol,
  lpg,
  smoke_status,
  alcohol_status,
  lpg_status,
  time,
  currentMode
);

//////////////////////////////////////////////////
// SMOKE ALERT
//////////////////////////////////////////////////

if ((currentMode === 0 || currentMode === 1) &&
   (smoke_status === "FIRE" || smoke_status === "DANGER")) {

  const cooldown =
    smoke_status === "FIRE" ? FIRE_COOLDOWN : DANGER_COOLDOWN;

  if (Date.now() - lastSmokeAlert > cooldown) {
    lastSmokeAlert = Date.now();
    shouldSend = true;
  }

}

//////////////////////////////////////////////////
// ALCOHOL ALERT
//////////////////////////////////////////////////

if ((currentMode === 0 || currentMode === 2) &&
   (alcohol_status === "FIRE" || alcohol_status === "DANGER")) {

  const cooldown =
    alcohol_status === "FIRE" ? FIRE_COOLDOWN : DANGER_COOLDOWN;

  if (Date.now() - lastAlcoholAlert > cooldown) {
    lastAlcoholAlert = Date.now();
    shouldSend = true;
  }

}

//////////////////////////////////////////////////
// LPG ALERT
//////////////////////////////////////////////////

if ((currentMode === 0 || currentMode === 3) &&
   (lpg_status === "FIRE" || lpg_status === "DANGER")) {

  const cooldown =
    lpg_status === "FIRE" ? FIRE_COOLDOWN : DANGER_COOLDOWN;

  if (Date.now() - lastLpgAlert > cooldown) {
    lastLpgAlert = Date.now();
    shouldSend = true;
  }

}

//////////////////////////////////////////////////
// SEND LINE
//////////////////////////////////////////////////

if (shouldSend && Date.now() - lastGlobalAlert > GLOBAL_ALERT_COOLDOWN) {
  lastGlobalAlert = Date.now();
  await sendLine(message);
}

res.send("OK");

  } catch (err) {
    console.error("❌ INSERT ERROR:", err);
    res.status(500).send("DB INSERT ERROR");
  }
});

app.get("/smoke-data", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id,
      TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
      smoke,
      smoke_status
      FROM smoke_logs
      ORDER BY id DESC
      LIMIT 1000
    `);

    let headers = `
      <tr>
        <th>ID</th>
        <th>Datetime</th>
        <th>Smoke</th>
        <th>Status</th>
      </tr>
    `;

    function color(status){
    if(status === "SAFE") return "#28a745";
    if(status === "WARNING") return "#ffc107";
    if(status === "DANGER") return "#fd7e14";
    if(status === "FIRE") return "#dc3545";
    return "white";
  }
    let rows = result.rows.map(row => `
      <tr>
        <td>${row.id}</td>
        <td>${row.created_at}</td>
        <td>${row.smoke}</td>
        <td style="color:${color(row.smoke_status)};font-weight:bold;">
        ${row.smoke_status}
        </td>
      </tr>
    `).join("");

res.send(
  renderSubPage("💨 Smoke Data", headers, rows, "/export-smoke")
);

  } catch (err) {
    res.status(500).send("DB ERROR");
  }
});

app.get("/alcohol-data", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id,
      TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
      alcohol,
      alcohol_status
      FROM smoke_logs
      ORDER BY id DESC
      LIMIT 1000
    `);

    let headers = `
      <tr>
        <th>ID</th>
        <th>Datetime</th>
        <th>Alcohol</th>
        <th>Status</th>
      </tr>
    `;
    function color(status){
    if(status === "SAFE") return "#28a745";
    if(status === "WARNING") return "#ffc107";
    if(status === "DANGER") return "#fd7e14";
    if(status === "FIRE") return "#dc3545";
    return "white";
  }
    let rows = result.rows.map(row => `
      <tr>
        <td>${row.id}</td>
        <td>${row.created_at}</td>
        <td>${row.alcohol}</td>
        <td style="color:${color(row.alcohol_status)};font-weight:bold;">
        ${row.alcohol_status}
        </td>
      </tr>
    `).join("");

res.send(
  renderSubPage("🧴 Alcohol Data", headers, rows, "/export-alcohol")
);

  } catch (err) {
    res.status(500).send("DB ERROR");
  }
});

app.get("/lpg-data", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id,
      TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
      lpg,
      lpg_status
      FROM smoke_logs
      ORDER BY id DESC
      LIMIT 1000
    `);

    let headers = `
      <tr>
        <th>ID</th>
        <th>Datetime</th>
        <th>LPG</th>
        <th>Status</th>
      </tr>
    `;
    function color(status){
    if(status === "SAFE") return "#28a745";
    if(status === "WARNING") return "#ffc107";
    if(status === "DANGER") return "#fd7e14";
    if(status === "FIRE") return "#dc3545";
    return "white";
  }
    let rows = result.rows.map(row => `
      <tr>
        <td>${row.id}</td>
        <td>${row.created_at}</td>
        <td>${row.lpg}</td>
        <td style="color:${color(row.lpg_status)};font-weight:bold;">
        ${row.lpg_status}
        </td>
      </tr>
    `).join("");

res.send(
  renderSubPage("🧯 LPG Data", headers, rows, "/export-lpg")
);

  } catch (err) {
    res.status(500).send("DB ERROR");
  }
});

// LINE Webhook
app.post("/webhook", (req, res) => {
  console.log("LINE Webhook Received:");
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});
// 🔥 Delete all logs
app.get("/delete-all", async (req, res) => {
  try {
    await pool.query("TRUNCATE TABLE smoke_logs RESTART IDENTITY;");
    res.redirect("/table");
  } catch (err) {
    console.error("❌ DELETE ERROR:", err);
    res.status(500).send("DELETE ERROR");
  }
});
// 📊 Export Excel
app.get("/export-excel", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
        smoke,
        alcohol,
        lpg,
        smoke_status,
        alcohol_status,
        lpg_status
      FROM smoke_logs
      ORDER BY id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Smoke Logs");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Datetime", key: "created_at", width: 25 },
      { header: "Smoke", key: "smoke", width: 15 },
      { header: "Smoke Status", key: "smoke_status", width: 15 },
      { header: "Alcohol", key: "alcohol", width: 15 },
      { header: "Alcohol Status", key: "alcohol_status", width: 15 },
      { header: "LPG", key: "lpg", width: 15 },
      { header: "LPG Status", key: "lpg_status", width: 15 },
    ];

    result.rows.forEach(row => {
      worksheet.addRow(row);
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=smoke_logs.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("❌ EXPORT ERROR:", err);
    res.status(500).send("EXPORT ERROR");
  }
});
// 🔥 Export Smoke Only
app.get("/export-smoke", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at, 
      smoke, smoke_status
      FROM smoke_logs
      ORDER BY id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Smoke Data");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Datetime", key: "created_at", width: 25 },
      { header: "Smoke", key: "smoke", width: 15 },
      { header: "Smoke Status", key: "smoke_status", width: 15 },
    ];

    result.rows.forEach(row => worksheet.addRow(row));

    res.setHeader("Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",
      "attachment; filename=smoke_data.xlsx");

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    res.status(500).send("EXPORT ERROR");
  }
});


// 🍺 Export Alcohol Only
app.get("/export-alcohol", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
      alcohol, alcohol_status
      FROM smoke_logs
      ORDER BY id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Alcohol Data");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Datetime", key: "created_at", width: 25 },
      { header: "Alcohol", key: "alcohol", width: 15 },
      { header: "Alcohol Status", key: "alcohol_status", width: 15 },
    ];

    result.rows.forEach(row => worksheet.addRow(row));

    res.setHeader("Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",
      "attachment; filename=alcohol_data.xlsx");

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    res.status(500).send("EXPORT ERROR");
  }
});

// 🔥 Export LPG Only
app.get("/export-lpg", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
      lpg, lpg_status
      FROM smoke_logs
      ORDER BY id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("LPG Data");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Datetime", key: "created_at", width: 25 },
      { header: "LPG", key: "lpg", width: 15 },
      { header: "LPG Status", key: "lpg_status", width: 15 },
    ];

    result.rows.forEach(row => worksheet.addRow(row));

    res.setHeader("Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",
      "attachment; filename=lpg_data.xlsx");

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    res.status(500).send("EXPORT ERROR");
  } 
});
//////////////////////////////////////////////////
// LINE ALERT FUNCTION
//////////////////////////////////////////////////
async function sendLine(message) {

  if (!process.env.LINE_CHANNEL_TOKEN) {
    console.log("⚠ LINE TOKEN NOT SET");
    return;
  }

  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/broadcast",
      {
        messages: [
          {
            type: "text",
            text: message
          }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + process.env.LINE_CHANNEL_TOKEN
        }
      }
    );

    console.log("✅ LINE BROADCAST SENT");

  } catch (err) {
    console.log("❌ LINE ERROR:", err.response?.data || err.message);
  }
}

function getRiskLevel(smokeStatus, alcoholStatus, lpgStatus) {

  if (
    smokeStatus === "FIRE" ||
    alcoholStatus === "FIRE" ||
    lpgStatus === "FIRE"
  ) {
    return "HIGH RISK";
  }

  if (
    smokeStatus === "DANGER" ||
    alcoholStatus === "DANGER" ||
    lpgStatus === "DANGER"
  ) {
    return "MEDIUM RISK";
  }

  return "LOW RISK";
}
function getAdvice(smokeStatus, alcoholStatus, lpgStatus) {

  let advice = "";

  if (smokeStatus === "FIRE") {
    advice += `
💨 Smoke (🔴FIRE)
🆘ตรวจพบควันในระดับอันตราย เสี่ยงเกิดเพลิงไหม้
⚠️โปรดตรวจสอบพื้นที่ทันทีและออกจากพื้นที่โดยเร็ว
`;
  }

  if (smokeStatus === "DANGER") {
    advice += `
💨 Smoke (🟠DANGER)
🆘ตรวจพบควันสูงกว่าปกติ อาจมีการเผาไหม้
⚠️โปรดตรวจสอบพื้นที่ทันที และเพิ่มการระบายอากาศ
`;
  }

  if (lpgStatus === "FIRE") {
    advice += `
⛽ LPG (🔴FIRE)
🆘ตรวจพบก๊าซ LPG ในระดับอันตราย เสี่ยงระเบิด
⚠️หลีกเลี่ยงประกายไฟ และออกจากพื้นที่โดยเร็ว

`;
  }

  if (lpgStatus === "DANGER") {
    advice += `
⛽ LPG (🟠DANGER)
🆘ตรวจพบก๊าซ LPG สูงกว่าปกติ อาจมีการรั่วไหล
⚠️ตรวจสอบจุดรั่ว และเพิ่มการระบายอากาศ
`;
  }

  if (alcoholStatus === "FIRE") {
    advice += `
🧴 Alcohol (🔴FIRE)
🆘ตรวจพบไอแอลกอฮอล์ในระดับอันตราย เสี่ยงติดไฟ
⚠️หลีกเลี่ยงประกายไฟ และออกจากพื้นที่โดยเร็ว
`;
  }

  if (alcoholStatus === "DANGER") {
    advice += `
🧴 Alcohol (🟠DANGER)
🆘ตรวจพบไอแอลกอฮอล์สูงกว่าปกติ
⚠️เพิ่มการระบายอากาศ และหลีกเลี่ยงประกายไฟ
`;
  }

  return advice.trim();
}
function statusEmoji(status) {

  if (status === "SAFE") return "🟢 SAFE";
  if (status === "WARNING") return "🟡 WARNING";
  if (status === "DANGER") return "🟠 DANGER";
  if (status === "FIRE") return "🔴 FIRE";

  return status;
}
function buildLineMessage(smoke, alcohol, lpg, smokeStatus, alcoholStatus, lpgStatus, time, mode) {

let gasText = "";
let advice = "";
let risk = "LOW RISK";

//////////////////////////////////////////////////
// SMOKE
//////////////////////////////////////////////////

if (mode === 1 || mode === 0) {

gasText = `💨 Smoke : ${smoke} ppm ${statusEmoji(smokeStatus)}`;

if (smokeStatus === "FIRE") {
risk = "HIGH RISK";
advice = `
💨 Smoke (🔴FIRE)
🆘ตรวจพบควันในระดับอันตราย เสี่ยงเกิดเพลิงไหม้
⚠️โปรดตรวจสอบพื้นที่ทันทีและออกจากพื้นที่โดยเร็ว`;
}

if (smokeStatus === "DANGER") {
risk = "MEDIUM RISK";
advice = `
💨 Smoke (🟠DANGER)
🆘ตรวจพบควันสูงกว่าปกติ อาจมีการเผาไหม้
⚠️โปรดตรวจสอบพื้นที่ทันที และเพิ่มการระบายอากาศ`;
}

}

//////////////////////////////////////////////////
// ALCOHOL
//////////////////////////////////////////////////

if (mode === 2) {

gasText = `🧴 Alcohol : ${alcohol} ppm ${statusEmoji(alcoholStatus)}`;

if (alcoholStatus === "FIRE") {
risk = "HIGH RISK";
advice = `
🧴 Alcohol (🔴FIRE)
🆘ตรวจพบไอแอลกอฮอล์ในระดับอันตราย เสี่ยงติดไฟ
⚠️หลีกเลี่ยงประกายไฟ และออกจากพื้นที่โดยเร็ว`;
}

if (alcoholStatus === "DANGER") {
risk = "MEDIUM RISK";
advice = `
🧴 Alcohol (🟠DANGER)
🆘ตรวจพบไอแอลกอฮอล์สูงกว่าปกติ
⚠️เพิ่มการระบายอากาศ และหลีกเลี่ยงประกายไฟ`;
}

}

//////////////////////////////////////////////////
// LPG
//////////////////////////////////////////////////

if (mode === 3) {

gasText = `⛽ LPG : ${lpg} ppm ${statusEmoji(lpgStatus)}`;

if (lpgStatus === "FIRE") {
risk = "HIGH RISK";
advice = `
⛽ LPG (🔴FIRE)
🆘ตรวจพบก๊าซ LPG ในระดับอันตราย เสี่ยงระเบิด
⚠️หลีกเลี่ยงประกายไฟ และออกจากพื้นที่โดยเร็ว`;
}

if (lpgStatus === "DANGER") {
risk = "MEDIUM RISK";
advice = `
⛽ LPG (🟠DANGER)
🆘ตรวจพบก๊าซ LPG สูงกว่าปกติ อาจมีการรั่วไหล
⚠️ตรวจสอบจุดรั่ว และเพิ่มการระบายอากาศ`;
}

}

return `
🚨 Smoke Alert Notification

📊 ค่าที่ตรวจวัดได้
${gasText}

⚠️ ระดับความเสี่ยง : ${risk}

📌 คำแนะนำในการปฏิบัติ
${advice}

Time : ${time}
`.trim();
}
startServer();
