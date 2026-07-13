const express = require("express");

const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
    res.send("MILES OS is running.");
});

app.listen(PORT, () => {
    console.log(`MILES API listening on port ${PORT}`);
});