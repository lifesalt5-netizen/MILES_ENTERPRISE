const fs = require('fs');
const required = [
  'package.json',
  'config/miles.config.json',
  'src/main/main.js',
  'src/main/preload.js',
  'src/runtime/runtimeHost.js',
  'src/renderer/index.html',
  'src/renderer/app.js',
  'src/renderer/styles/app.css'
];
let failed = false;
for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}`);
    failed = true;
  } else {
    console.log(`OK ${file}`);
  }
}
process.exit(failed ? 1 : 0);
