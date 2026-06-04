const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
let best = '';
let m;
while ((m = re.exec(html))) {
  if (m[1].length > best.length) best = m[1];
}
const tmp = path.join(__dirname, '_inline-script.js');
fs.writeFileSync(tmp, best, 'utf8');
const r = spawnSync('node', ['--check', tmp], { encoding: 'utf8' });
console.log(r.stderr || r.stdout || 'ok');
if (r.status === 0) fs.unlinkSync(tmp);
