const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const bodyStart = html.indexOf('<body>');
const bodyEnd = html.lastIndexOf('</body>');
const fragment = html.slice(bodyStart, bodyEnd + 7);
const stack = [];
const re = /<\/?([a-zA-Z][\w:-]*)[^>]*\/?>/g;
let m;
const voidEls = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
while ((m = re.exec(fragment))) {
  const full = m[0];
  if (full.startsWith('<!--') || full.endsWith('/>')) continue;
  const tag = m[1].toLowerCase();
  if (voidEls.has(tag)) continue;
  if (full.startsWith('</')) {
    const last = stack.pop();
    if (last !== tag) {
      console.log('MISMATCH close', tag, 'expected', last, 'near', fragment.slice(Math.max(0, m.index - 80), m.index + 40));
    }
  } else {
    stack.push(tag);
  }
}
console.log('Unclosed tags:', stack.slice(-15));
console.log('Stack depth at end:', stack.length);
