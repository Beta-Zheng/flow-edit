'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const manifest = read('manifest.json'),
  version = read('package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Stable x.y.z versions are required');
manifest.version = version;
const versions = read('versions.json');
versions[version] = manifest.minAppVersion;
for (const [name, data] of [
  ['manifest.json', manifest],
  ['versions.json', versions],
])
  fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + '\n');
