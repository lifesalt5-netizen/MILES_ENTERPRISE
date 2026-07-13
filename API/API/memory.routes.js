const express = require("express");
const router = express.Router();

const memory = require("../SERVICES/MemoryService");

router.post("/remember", (req, res) => {

    const { category, key, value } = req.body;

    memory.remember(category, key, value);

    res.json({
        success: true
    });

});

router.get("/recall/:key", (req, res) => {

    const result = memory.recall(req.params.key);

    res.json(result);

});

router.delete("/forget/:key", (req, res) => {

    memory.forget(req.params.key);

    res.json({
        success: true
    });

});

module.exports = router;
