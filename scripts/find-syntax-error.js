const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
let best = '';
let m;
while ((m = re.exec(html))) {
  if (m[1].length > best.length) best = m[1];
}
const lines = best.split('\n');
let lo = 0;
let hi = lines.length;
while (lo < hi - 1) {
  const mid = Math.floor((lo + hi) / 2);
  const chunk = lines.slice(0, mid).join('\n');
  try {
    new Function(chunk);
    lo = mid;
  } catch (e) {
    if (String(e.message).includes('Unexpected end')) hi = mid;
    else hi = mid;
  }
}
const errLine = hi;
console.log('approx error near script line:', errLine);
for (let i = Math.max(1, errLine - 5); i <= Math.min(lines.length, errLine + 5); i++) {
  console.log(String(i).padStart(6), lines[i - 1].slice(0, 120));
}
// find html line
const scriptStart = html.indexOf(best.slice(0, 80));
const prefix = html.slice(0, scriptStart).split('\n').length;
console.log('approx html line:', prefix + errLine);
