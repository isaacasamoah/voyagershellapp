const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('installed launcher selects X11 before Electron starts and preserves the previous build', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voyager-install-'));
  try {
    const source = path.join(root, 'bundle');
    const data = path.join(root, 'user data');
    const releases = path.join(data, 'voyagershell-app');
    const previous = path.join(releases, 'previous');
    fs.mkdirSync(path.join(source, 'resources/app/assets'), { recursive: true });
    fs.mkdirSync(previous, { recursive: true });
    fs.symlinkSync(previous, path.join(releases, 'current'));
    fs.writeFileSync(path.join(previous, 'retained'), 'previous build');
    fs.writeFileSync(path.join(source, 'resources/app/assets/idle.png'), 'fixture');
    fs.writeFileSync(
      path.join(source, 'build.json'),
      JSON.stringify({ revision: '123456abcdef', arch: process.arch }),
    );
    fs.copyFileSync(
      path.join(__dirname, '../scripts/install-linux.cjs'),
      path.join(source, 'install.cjs'),
    );
    execFileSync(process.execPath, [path.join(source, 'install.cjs')], {
      env: { ...process.env, XDG_DATA_HOME: data },
    });
    const entry = fs.readFileSync(path.join(data, 'applications/voyagershell.desktop'), 'utf8');
    assert.equal(
      entry.split('\n').find((line) => line.startsWith('Exec=')),
      `Exec="${path.join(releases, 'current/voyagershell')}" --ozone-platform=x11`,
    );
    assert.equal(fs.readFileSync(path.join(previous, 'retained'), 'utf8'), 'previous build');
    assert.equal(
      fs.readlinkSync(path.join(releases, 'current')),
      path.join(releases, '123456abcdef'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
