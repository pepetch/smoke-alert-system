const express = require("express");
const { Pool } = require("pg");
const ExcelJS = require("exceljs");

const app = express();
app.use(express.json());

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

function renderSubPage(title, headers, rows) {
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
        margin-bottom:15px;
      }

      .btn-back {
        display:inline-block;
        padding:10px 15px;
        background:#007bff;
        color:white;
        border-radius:5px;
        text-decoration:none;
        margin-bottom:15px;
      }

      table {
        border-collapse: collapse;
        width:100%;
      }

      th, td {
        border:1px solid #555;
        padding:10px;
        text-align:center;
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
    <a href="/table" class="btn-back">⬅ Back to Dashboard</a>

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
        alcohol FLOAT,
        lpg FLOAT,
        status VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 🔥 เพิ่มบรรทัดนี้เข้าไป
    await pool.query(`
      ALTER TABLE smoke_logs
      ALTER COLUMN created_at
      SET DEFAULT (NOW() AT TIME ZONE 'Asia/Bangkok');
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

// Root
app.get("/", (req, res) => {
  res.send("🔥 Smoke Alert Server Running...");
});

// Get all logs
app.get("/logs", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
        smoke,
        alcohol,
        lpg,
        status
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
        status
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
        TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS created_at,
        smoke,
        alcohol,
        lpg,
        status
      FROM smoke_logs
      ORDER BY id DESC
      LIMIT 50
    `);

  let rows = result.rows.map(row => {
  
    let color = "#28a745"; // SAFE
  
    if(row.status === "WARNING") color = "#ffc107";
    if(row.status === "DANGER")  color = "#fd7e14";
    if(row.status === "FIRE")    color = "#dc3545";
  
    return `
    <tr>
      <td>${row.id}</td>
      <td>${row.created_at}</td>
      <td>${row.smoke}</td>
      <td>${row.alcohol}</td>
      <td>${row.lpg}</td>
      <td style="color:${color}; font-weight:bold;">
        ${row.status}
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

    <h2>🔥 Smoke Alert Logs</h2>

  <div style="margin-bottom:15px;">
  
    <a href="/export-excel" class="btn-export">
      📊 Export Excel
    </a>
  
    <a href="/smoke-data" class="btn-export">
      🔥 Smoke
    </a>
  
    <a href="/alcohol-data" class="btn-export">
      🍺 Alcohol
    </a>
  
    <a href="/lpg-data" class="btn-export">
      🔥 LPG
    </a>
  
    <form action="/delete-all" method="GET" style="display:inline;">
      <button type="submit" class="btn-delete">
        🗑 Clear Data
      </button>
    </form>
  
  </div>

    <div class="table-container">
      <table>
        <tr>
          <th>ID</th>
          <th>Datetime</th>
          <th>Smoke</th>
          <th>Alcohol</th>
          <th>LPG</th>
          <th>Status</th>
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
    const { smoke, alcohol, lpg, status } = req.body;

    if (
      smoke === undefined ||
      alcohol === undefined ||
      lpg === undefined ||
      !status
    ) {
      return res.status(400).send("Missing data");
    }

    await pool.query(
      "INSERT INTO smoke_logs(smoke, alcohol, lpg, status) VALUES($1,$2,$3,$4)",
      [smoke, alcohol, lpg, status]
    );

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
    status
    FROM smoke_logs
    ORDER BY id DESC
    LIMIT 50
  `);

  let headers = `
    <tr>
      <th>ID</th>
      <th>Datetime</th>
      <th>Smoke</th>
      <th>Status</th>
    </tr>
  `;

  let rows = result.rows.map(row => `
    <tr>
      <td>${row.id}</td>
      <td>${row.created_at}</td>
      <td>${row.smoke}</td>
      <td>${row.status}</td>
    </tr>
  `).join("");

  res.send(renderSubPage("🔥 Smoke Data", headers, rows));
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
    status
    FROM smoke_logs
    ORDER BY id DESC
    LIMIT 50
  `);

  let headers = `
    <tr>
      <th>ID</th>
      <th>Datetime</th>
      <th>Alcohol</th>
      <th>Status</th>
    </tr>
  `;

  let rows = result.rows.map(row => `
    <tr>
      <td>${row.id}</td>
      <td>${row.created_at}</td>
      <td>${row.alcohol}</td>
      <td>${row.status}</td>
    </tr>
  `).join("");

  res.send(renderSubPage("🍺 Alcohol Data", headers, rows));
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
    status
    FROM smoke_logs
    ORDER BY id DESC
    LIMIT 50
  `);

  let headers = `
    <tr>
      <th>ID</th>
      <th>Datetime</th>
      <th>LPG</th>
      <th>Status</th>
    </tr>
  `;

  let rows = result.rows.map(row => `
    <tr>
      <td>${row.id}</td>
      <td>${row.created_at}</td>
      <td>${row.lpg}</td>
      <td>${row.status}</td>
    </tr>
  `).join("");

  res.send(renderSubPage("🔥 LPG Data", headers, rows));
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
        created_at,
        smoke,
        alcohol,
        lpg,
        status
      FROM smoke_logs
      ORDER BY id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Smoke Logs");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Datetime", key: "created_at", width: 25 },
      { header: "Smoke", key: "smoke", width: 15 },
      { header: "Alcohol", key: "alcohol", width: 15 },
      { header: "LPG", key: "lpg", width: 15 },
      { header: "Status", key: "status", width: 15 },
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
startServer();
