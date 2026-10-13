const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tokenName = /^--(?:black|white|(?:gray|green|gold|blue|purple|red)-\d+)(?:-a\d+)?$|^--fs-[0-9a-z]+$/;
const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|hsla?\([^()]*\)/;

// Yields [property, value] for every declaration; selectors, strings and url() payloads are skipped.
function* declarations(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length));
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && ch === '{') start = i + 1;
    else if (depth === 0 && (ch === ';' || ch === '}')) {
      const chunk = css.slice(start, i), colon = chunk.indexOf(':');
      const property = chunk.slice(0, colon).trim();
      if (colon > 0 && /^[-\w]+$/.test(property)) {
        yield [property, chunk.slice(colon + 1).replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)|"[^"]*"|'[^']*'/g, '')];
      }
      start = i + 1;
    }
  }
}

const summary = {};
for (const folder of ['public', 'docs']) {
  const files = fs.readdirSync(path.join(root, folder)).filter(file => file.endsWith('.css'));
  const defined = new Set();
  const used = new Set();
  for (const file of files) {
    for (const [property, value] of declarations(fs.readFileSync(path.join(root, folder, file), 'utf8'))) {
      for (const match of value.matchAll(/var\(\s*(--[-\w]+)/g)) if (tokenName.test(match[1])) used.add(match[1]);
      if (tokenName.test(property)) {
        assert.equal(file, 'styles.css', `${folder}/${file}: token ${property} must be defined in styles.css`);
        assert(!defined.has(property), `${folder}/${file}: token ${property} is defined twice`);
        defined.add(property);
        continue;
      }
      assert(!literal.test(value), `${folder}/${file}: "${property}:${value.trim()}" uses a raw colour; use a palette token from styles.css`);
      if (property === 'font-size') assert(!/\d(?:px|pt|rem)\b/.test(value), `${folder}/${file}: "font-size:${value.trim()}" must use a --fs-* token`);
    }
  }
  for (const token of used) assert(defined.has(token), `${folder}: var(${token}) is not defined in styles.css`);
  summary[folder] = { files: files.length, tokens: defined.size, unused: [...defined].filter(token => !used.has(token)) };
}
assert.deepEqual(summary.public.unused, [], 'public: unused palette tokens');
assert.deepEqual(summary.docs.unused, [], 'docs: unused palette tokens');
console.log(JSON.stringify({ tokens: summary.public.tokens, publicFiles: summary.public.files, docsFiles: summary.docs.files, rawColours: 0, rawFontSizes: 0 }));
