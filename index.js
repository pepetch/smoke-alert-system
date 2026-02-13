const express = require("express");
const app = express();

app.use(express.json());

// test route
app.get("/", (req, res) => {
    res.send("🔥 Smoke Alert Server Running...");
});

// รับค่าจาก ESP8266
app.post("/smoke", (req, res) => {

    const smokeValue = req.body.value;

    console.log("Smoke:", smokeValue);

    if(smokeValue > 300){
        console.log("🚨 DANGER!");
    }

    res.send("OK");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});