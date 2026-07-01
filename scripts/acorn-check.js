const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const s = fs.readFileSync(path.join(__dirname, '_inline-script.js'), 'utf8');
try {
  acorn.parse(s, { ecmaVersion: 2022, sourceType: 'script' });
  console.log('OK');
} catch (e) {
  console.log(e.message);
  if (e.loc) {
    const lines = s.split('\n');
    const L = e.loc.line;
    console.log('line', L, 'col', e.loc.column);
    for (let i = Math.max(0, L - 4); i < Math.min(lines.length, L + 3); i++) {
      console.log(String(i + 1).padStart(6), lines[i].slice(0, 150));
    }
  }
}
