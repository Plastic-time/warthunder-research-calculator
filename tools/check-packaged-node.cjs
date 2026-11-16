const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

function validateNode(version, binary, reviewed) {
  assert.equal(version, `v${reviewed.version}`, 'Packaging requires the reviewed Node runtime');
  assert.equal(createHash('sha256').update(binary).digest('hex'), reviewed.sha256,
    'Node binary differs from the reviewed official download');
}

if (require.main === module) {
  validateNode(process.version, fs.readFileSync(process.execPath),
    require('../config/release-privacy-runtime-paths.json').node);
  console.log('Packaged Node version and SHA256 verified.');
}
module.exports = { validateNode };
