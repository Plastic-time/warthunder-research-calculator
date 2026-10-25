const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');

const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const tags = new Set('svg defs g path rect circle ellipse line polyline polygon use clipPath marker linearGradient radialGradient stop style title desc image'.split(' '));
const attributes = new Set('id class viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points transform fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-opacity stroke-dasharray stroke-dashoffset opacity clip-path marker-mid marker-start marker-end markerWidth markerHeight refX refY orient markerUnits gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod data-name preserveAspectRatio href style'.split(' '));
const properties = new Set('fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-opacity stroke-dasharray stroke-dashoffset opacity clip-path marker-mid marker-start marker-end stop-color stop-opacity'.split(' '));

function validateAssets(entry, read) {
  assert.equal(entry.coverage, 'static-svg-audit', 'Static assets cannot skip content auditing');
  assert(entry.hashes && typeof entry.hashes === 'object', 'Static asset hashes are required');
  assert.deepEqual(Object.keys(entry.hashes).sort(), [...entry.files].sort(), 'Every static asset needs an exact hash');
  for (const file of entry.files) {
    assert(/^(?:public\/assets\/|docs\/assets\/|doc\/assets\/)/.test(file), 'Unexpected static asset path');
    assert(/^[a-f0-9]{64}$/.test(entry.hashes[file]), 'Invalid static asset hash');
    const bytes = read(file);
    assert(bytes.length <= 512 * 1024, `${file}: asset too large`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.hashes[file], `${file}: static asset hash mismatch; review the change before updating its hash`);
    if (file.startsWith('public/')) {
      const mirror = file.replace(/^public\//, 'docs/');
      assert(entry.files.includes(mirror), `${file}: missing static mirror`);
      assert.equal(entry.hashes[file], entry.hashes[mirror], `${file}: static mirror mismatch`);
    } else if (file.startsWith('docs/')) {
      assert(entry.files.includes(file.replace(/^docs\//, 'public/')), `${file}: orphan static mirror`);
    }
  }
  return entry;
}

function scanSvg(bytes, label = 'SVG') {
  // Parse XML namespaces and CSS syntax; never load resources or execute SVG code.
  const { SaxesParser } = require('saxes');
  const css = require('css-tree');
  assert(bytes.length <= 512 * 1024, `${label}: SVG too large`);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const ids = new Set(), refs = [], stack = [];
  let elements = 0, styleText = '', rootSeen = false;
  const localReference = value => {
    assert(/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value), `${label}: only local fragment references are allowed`);
    refs.push(value.slice(1));
  };
  const checkValue = (property, value) => {
    assert(properties.has(property), `${label}: unsupported CSS property ${property}`);
    const ast = css.parse(value, { context: 'value', onParseError: error => { throw error; } });
    css.walk(ast, node => {
      assert(!['Raw', 'Function', 'Atrule'].includes(node.type), `${label}: unsupported CSS value`);
      if (node.type === 'Url') localReference(node.value);
    });
    assert(!css.lexer.matchProperty(property, ast).error, `${label}: invalid CSS value for ${property}`);
  };
  const checkCss = (source, context) => {
    const ast = css.parse(source, { context, onParseError: error => { throw error; } });
    css.walk(ast, node => {
      assert(!['Atrule', 'Raw', 'Function'].includes(node.type), `${label}: unsupported CSS syntax`);
      if (node.type === 'Declaration') checkValue(node.property, css.generate(node.value));
      if (node.type === 'Url') localReference(node.value);
      if (node.type === 'Selector') {
        const children = node.children.toArray();
        assert(children.length === 1 && ['ClassSelector', 'IdSelector', 'TypeSelector'].includes(children[0].type), `${label}: unsupported CSS selector`);
      }
    });
  };
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', error => { throw error; });
  parser.on('doctype', () => { throw new Error(`${label}: DOCTYPE is forbidden`); });
  parser.on('processinginstruction', () => { throw new Error(`${label}: processing instructions are forbidden`); });
  parser.on('xmldecl', declaration => {
    assert(!declaration.encoding || /^utf-8$/i.test(declaration.encoding), `${label}: only UTF-8 is allowed`);
  });
  parser.on('opentag', tag => {
    assert(++elements <= 4096 && stack.length < 64, `${label}: SVG complexity limit`);
    assert(tag.uri === SVG && !tag.prefix && tags.has(tag.local), `${label}: forbidden SVG element ${tag.name}`);
    assert(!stack.length ? !rootSeen && tag.local === 'svg' : !['style', 'title', 'desc'].includes(stack.at(-1)), `${label}: invalid SVG nesting`);
    rootSeen = true;
    stack.push(tag.local);
    for (const attr of Object.values(tag.attributes)) {
      if (attr.uri === XMLNS) {
        assert((attr.name === 'xmlns' && attr.value === SVG) || (attr.name === 'xmlns:xlink' && attr.value === XLINK), `${label}: forbidden namespace declaration`);
        continue;
      }
      assert((!attr.prefix && !attr.uri) || (attr.prefix === 'xlink' && attr.uri === XLINK && attr.local === 'href'), `${label}: forbidden attribute namespace`);
      assert(attributes.has(attr.local), `${label}: forbidden SVG attribute ${attr.name}`);
      if (attr.local === 'id') {
        assert(/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(attr.value) && !ids.has(attr.value), `${label}: invalid or duplicate ID`);
        ids.add(attr.value);
      } else if (attr.local === 'href') {
        if (tag.local === 'image') {
          // The documentation avatar embeds a JPEG. Do not allow SVG/HTML data URLs.
          const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(attr.value);
          assert(match, `${label}: only embedded JPEG images are allowed`);
          const jpeg = Buffer.from(match[1], 'base64');
          assert(jpeg.toString('base64') === match[1] && jpeg.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
            && jpeg.subarray(-2).equals(Buffer.from([255, 217])), `${label}: invalid embedded JPEG`);
        } else {
          assert(['use', 'linearGradient', 'radialGradient'].includes(tag.local), `${label}: unexpected href`);
          localReference(attr.value);
        }
      } else if (attr.local === 'style') checkCss(attr.value, 'declarationList');
      else if (properties.has(attr.local)) checkValue(attr.local, attr.value);
    }
    if (tag.local === 'style') styleText = '';
  });
  const textNode = value => {
    if (stack.at(-1) === 'style') styleText += value;
    else assert(['title', 'desc'].includes(stack.at(-1)) || !value.trim(), `${label}: unexpected SVG text`);
  };
  parser.on('text', textNode);
  parser.on('cdata', textNode);
  parser.on('closetag', () => {
    if (stack.pop() === 'style') checkCss(styleText, 'stylesheet');
  });
  parser.write(text).close();
  assert(rootSeen, `${label}: missing SVG root`);
  for (const id of refs) assert(ids.has(id), `${label}: missing local reference ${id}`);
  return { elements };
}

function auditAssets(entries, read) {
  let checked = 0;
  for (const entry of entries) {
    validateAssets(entry, read);
    for (const file of entry.files.filter(file => /\.svg$/i.test(file))) {
      scanSvg(read(file), file);
      checked++;
    }
  }
  return { svgFilesChecked: checked };
}

module.exports = { validateAssets, scanSvg, auditAssets };
