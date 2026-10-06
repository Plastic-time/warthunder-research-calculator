const test = require('node:test');
const assert = require('node:assert/strict');
const proxyaddr = require('proxy-addr');

test('IPv4-mapped IPv6 trust prefixes must not trust arbitrary IPv4 clients', () => {
  for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
    assert.equal(proxyaddr.compile(subnet)('203.0.113.10'), false);
  }
  const trust = proxyaddr.compile('::ffff:10.0.0.0/104');
  assert.equal(trust('10.1.2.3'), true);
  assert.equal(trust('203.0.113.10'), false);
});
