const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateAssets, scanSvg, auditAssets } = require('./audit-static-assets.cjs');
const root = path.resolve(__dirname, '..');
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`);

test('all repository SVGs pass XML/CSS checks without modifying artwork', () => {
  const entries = require('../config/dependency-inventory.json').entries.filter(e => e.kind === 'assets');
  assert.equal(auditAssets(entries, f => fs.readFileSync(path.join(root, f))).svgFilesChecked, 75);
});

test('local gradients, styles and xlink references remain supported', () => {
  assert.doesNotThrow(() => scanSvg(svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><path id="p" d="M0 0"/><style>.paint {fill:url(#g);opacity:.5}</style></defs><use xlink:href="#p" class="paint"/>')));
  assert.doesNotThrow(() => scanSvg(svg('<path style="fill:#fff;stroke-width:2" d="M0 0"/>')));
});

for (const [name, content] of Object.entries({
  script: '<script>alert(1)</script>',
  event: '<path onload="alert(1)"/>',
  html: '<foreignObject><div/></foreignObject>',
  animation: '<animate attributeName="href" to="https://example.invalid"/>',
  link: '<a href="https://example.invalid"><path/></a>',
  externalUse: '<use href="https://example.invalid/icon.svg#x"/>',
  entityUrl: '<use href="&#104;ttps://example.invalid/icon.svg#x"/>',
  dataSvg: '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
  externalImage: '<image href="https://example.invalid/a.jpg"/>',
  fakeJpeg: '<image href="data:image/jpeg;base64,PHN2Zy8+"/>',
  externalPaint: '<path fill="url(https://example.invalid/a.svg#x)"/>',
  cssImport: '<style>@import "https://example.invalid/x.css";</style>',
  escapedCss: '<style>.x {f\\69ll:u\\72l(https://example.invalid/x.svg#x)}</style>',
  cssVariable: '<style>.x {fill:var(--remote)}</style>',
  cssBinding: '<style>.x {-moz-binding:url(https://example.invalid/x)}</style>',
  cssMalformed: '<style>.x {fill:}</style>',
  cssExpression: '<path style="fill:expression(alert(1))"/>',
  namespace: '<g xmlns="http://www.w3.org/1999/xhtml"/>',
  xmlBase: '<g xml:base="https://example.invalid/"/>',
  aliasEvent: '<g xmlns:q="urn:q" q:onload="alert(1)"/>',
  duplicateId: '<path id="p"/><path id="p"/>',
  missingRef: '<use href="#missing"/>',
  malformed: '<g></path>',
  duplicateAttribute: '<path fill="red" fill="blue"/>',
  nestedStyle: '<style><path/></style>',
  unknownEntity: '<title>&unknown;</title>'
})) {
  test(`SVG rejects ${name}`, () => assert.throws(() => scanSvg(svg(content))));
}

test('DTD, stylesheet PI, invalid encoding and oversized XML are rejected', () => {
  for (const source of [
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///not-read">]>' + svg('<title>&x;</title>'),
    '<?xml-stylesheet href="https://example.invalid/x.css"?>' + svg(''),
    '<?xml version="1.0" encoding="UTF-16"?>' + svg(''),
    '<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>',
    ''
  ]) assert.throws(() => scanSvg(Buffer.from(source)));
  assert.throws(() => scanSvg(Buffer.from([255, 255])));
  assert.throws(() => scanSvg(Buffer.alloc(512 * 1024 + 1)), /too large/);
  assert.throws(() => scanSvg(svg('<g>'.repeat(65) + '</g>'.repeat(65))), /complexity/);
});

test('hashes, mirrors and coverage cannot silently drift', () => {
  const bytes = svg('<path/>'), hash = createHash('sha256').update(bytes).digest('hex');
  const entry = { coverage: 'static-svg-audit', files: ['public/assets/a.svg', 'docs/assets/a.svg'], hashes: { 'public/assets/a.svg': hash, 'docs/assets/a.svg': hash } };
  assert.doesNotThrow(() => validateAssets(entry, () => bytes));
  assert.throws(() => validateAssets(entry, () => svg('<script/>')), /hash mismatch/);
  assert.throws(() => validateAssets({ ...entry, coverage: 'tracked-only' }, () => bytes), /cannot skip/);
  assert.throws(() => validateAssets({ ...entry, hashes: {} }, () => bytes), /exact hash/);
  assert.throws(() => validateAssets({ ...entry, files: [entry.files[0]], hashes: { [entry.files[0]]: hash } }, () => bytes), /missing static mirror/);
});

test('CI and releases run static asset regression and the unified audit', () => {
  for (const workflow of ['security.yml', 'release.yml']) {
    const text = fs.readFileSync(path.join(root, '.github/workflows', workflow), 'utf8');
    assert.match(text, /npm run test:assets/);
    assert.match(text, /npm run audit:dependencies/);
  }
  assert(!fs.existsSync(path.join(root, 'WarThunderResearchCalculator.exe')), 'No legacy root executable');
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/browser-checks.yml'), 'utf8'), /npm run audit:assets/);
  const packaging = fs.readFileSync(path.join(root, 'tools/package-release.ps1'), 'utf8');
  assert.match(packaging, /node \.\/tools\/build-launcher\.cjs \$launcherOutput \$Version/);
  assert.match(packaging, /Join-Path \$launcherOutput "WarThunderResearchCalculator.exe"/);
});
