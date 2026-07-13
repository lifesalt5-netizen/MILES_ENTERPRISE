const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '..'); const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const out = path.join(root,'BACKUPS',`runtime_backup_${stamp}`); fs.mkdirSync(out,{recursive:true});
for (const dir of ['src','config','data']) { const src=path.join(root,dir); if (fs.existsSync(src)) fs.cpSync(src,path.join(out,dir),{recursive:true}); }
console.log(`Backup created: ${out}`);
