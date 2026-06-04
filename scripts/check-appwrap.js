const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('id="appWrap"');
const end = html.indexOf('<!-- /#appWrap -->');
const chunk = html.slice(start, end + 20);
let depth = 0;
const re = /<div\b|<\/div>/gi;
let m;
while ((m = re.exec(chunk))) {
  if (m[0].toLowerCase() === '</div>') depth--;
  else depth++;
}
console.log('appWrap div depth at end (should be 0):', depth);
