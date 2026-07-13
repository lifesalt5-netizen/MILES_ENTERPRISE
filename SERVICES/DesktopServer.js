const express = require('express');
const path = require('path');
const { MilesRuntime } = require('../CORE/Runtime/MilesRuntime');

const app = express();
const runtime = new MilesRuntime();
runtime.start();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'WEB', 'desktop', 'public')));

app.get('/api/status', (req,res) => res.json(runtime.status()));
app.post('/api/command', (req,res) => res.json(runtime.command(req.body.command)));
app.post('/api/runtime/start', (req,res) => res.json(runtime.start()));
app.post('/api/runtime/stop', (req,res) => res.json(runtime.stop()));

const port = process.env.MILES_DESKTOP_PORT || 3737;
app.listen(port, () => {
  console.log(`MILES Desktop running: http://localhost:${port}`);
});
