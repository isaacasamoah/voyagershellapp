const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

assert.equal(process.platform, 'linux', 'Build this package on Linux');
const desktop = path.resolve(__dirname, '..');
const root = path.dirname(desktop);
const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root })
  .toString()
  .trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString(),
  '',
  'Commit the source before packaging',
);
const name = `voyagershell-linux-${process.arch}-${revision}`;
const out = path.join(desktop, 'out');
const bundle = path.join(out, name);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(bundle);
execFileSync(
  'cargo',
  ['build', '--release', '--locked', '--bin', 'voyager', '--bin', 'voyager-windows'],
  { cwd: root, stdio: 'inherit' },
);
const runtime = path.dirname(require('electron'));
fs.cpSync(runtime, bundle, { recursive: true });
fs.renameSync(path.join(bundle, 'electron'), path.join(bundle, 'voyagershell'));
fs.rmSync(path.join(bundle, 'resources/default_app.asar'));
const app = path.join(bundle, 'resources/app');
fs.mkdirSync(app);
for (const directory of ['src', 'assets'])
  fs.cpSync(path.join(desktop, directory), path.join(app, directory), { recursive: true });
fs.mkdirSync(path.join(app, 'test'));
for (const file of [
  'native-proof.cjs',
  'native-pointer.py',
  'output-audio.cjs',
  'recovery-position-proof.cjs',
])
  fs.copyFileSync(path.join(desktop, 'test', file), path.join(app, 'test', file));
const metadata = require('../package.json');
fs.writeFileSync(
  path.join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'voyagershell',
      productName: 'Voyager Shell',
      version: metadata.version,
      main: metadata.main,
      license: metadata.license,
      desktopName: 'voyagershell.desktop',
    },
    null,
    2,
  ),
);
const bin = path.join(bundle, 'resources/bin');
fs.mkdirSync(bin);
for (const binary of ['voyager', 'voyager-windows'])
  fs.copyFileSync(path.join(root, 'target/release', binary), path.join(bin, binary));
fs.copyFileSync(path.join(__dirname, 'install-linux.cjs'), path.join(bundle, 'install.cjs'));
fs.writeFileSync(
  path.join(bundle, 'install.sh'),
  '#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nELECTRON_RUN_AS_NODE=1 exec ./voyagershell ./install.cjs\n',
  { mode: 0o755 },
);
fs.writeFileSync(
  path.join(bundle, 'build.json'),
  JSON.stringify(
    {
      revision,
      platform: process.platform,
      arch: process.arch,
      electron: metadata.devDependencies.electron,
    },
    null,
    2,
  ),
);
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(bundle, 'LICENSE.voyagershell'));
fs.copyFileSync(path.join(root, 'docs/install-linux.md'), path.join(bundle, 'README.md'));
const archive = `${name}.tar.gz`;
execFileSync('tar', ['-czf', archive, name], { cwd: out, stdio: 'inherit' });
const digest = createHash('sha256')
  .update(fs.readFileSync(path.join(out, archive)))
  .digest('hex');
fs.writeFileSync(path.join(out, `${archive}.sha256`), `${digest}  ${archive}\n`);
console.log(path.join(out, archive));
