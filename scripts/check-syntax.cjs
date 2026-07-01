const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
let best = '';
let m;
while ((m = re.exec(html))) {
  if (m[1].length > best.length) best = m[1];
}
console.log('script length:', best.length);
try {
  new Function(best);
  console.log('syntax OK');
} catch (e) {
  console.log('syntax ERROR:', e.message);
  process.exit(1);
}
