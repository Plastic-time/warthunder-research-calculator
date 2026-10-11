const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalize, matches } = require('../public/tree-search');

test('Aircraft names accept spacing, hyphens, case and full-width input', () => {
  for (const query of ['F15', 'F-15', 'F 15', 'f\u201115', 'Ｆ－１５']) {
    assert(matches('F-15C Golden Eagle', query), query);
  }
});
test('Vehicle IDs accept underscore and space variants', () => {
  assert(matches('f_15c_msip2', 'F 15C'));
  assert(!matches('F-16C', 'F15'));
});
test('Multilingual names and meaningful punctuation remain distinct', () => {
  assert(matches('歼-16', '歼１６'));
  assert(matches('Су-30СМ2', 'су30'));
  assert(matches('M4A1 (76) W', '(76)'));
  assert(!matches('BR 13.3', '133'));
  assert.equal(normalize(null), '');
  assert(matches('Rafale', ''));
});
