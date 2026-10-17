const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

function ruleRevision(source) {
  return crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

function syncRankUnlocks(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'dict/unlock_quantity.js'), 'utf8');
  const htmlPath = path.join(root, 'docs/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const $ = cheerio.load(html);
  const script = $('script[src]').filter((_, node) =>
    new URL($(node).attr('src'), 'https://local.invalid/').pathname === '/unlock-quantity.js');
  assert.equal(script.length, 1, 'Expected one rank-rules script');
  const src = script.attr('src');
  const url = new URL(src, 'https://local.invalid/');
  url.searchParams.set('r', ruleRevision(source));
  const oldAttribute = `src="${src.replaceAll('&', '&amp;')}"`;
  const newAttribute = `src="${src.split('?')[0]}${url.search.replaceAll('&', '&amp;')}"`;
  assert.equal(html.split(oldAttribute).length, 2, 'Expected one exact rank-rules reference');
  fs.writeFileSync(path.join(root, 'docs/unlock-quantity.js'), source);
  // Keep the existing HTML formatting and unrelated frontend changes intact.
  fs.writeFileSync(htmlPath, html.replace(oldAttribute, newAttribute));
}

if (require.main === module) syncRankUnlocks();
module.exports = {syncRankUnlocks, ruleRevision};
