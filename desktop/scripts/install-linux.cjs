const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const source = __dirname;
const build = JSON.parse(fs.readFileSync(path.join(source, 'build.json')));
assert.equal(process.platform, 'linux');
assert.equal(process.arch, build.arch, 'Package architecture does not match this computer');
assert.match(build.revision, /^[a-f0-9]{12}$/);
const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
assert(path.isAbsolute(data), 'XDG_DATA_HOME must be absolute');
const releases = path.join(data, 'voyagershell-app');
const destination = path.join(releases, build.revision);
fs.mkdirSync(releases, { recursive: true });
assert(
  !fs.existsSync(destination),
  'This build is already installed; launch Voyager Shell from Applications',
);
fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
const current = path.join(releases, 'current');
const next = path.join(releases, `.current-${process.pid}`);
fs.symlinkSync(destination, next);
fs.renameSync(next, current);
const applications = path.join(data, 'applications');
const icons = path.join(data, 'icons/hicolor/512x512/apps');
fs.mkdirSync(applications, { recursive: true });
fs.mkdirSync(icons, { recursive: true });
fs.copyFileSync(
  path.join(destination, 'resources/app/assets/idle.png'),
  path.join(icons, 'voyagershell.png'),
);
const executable = path
  .join(current, 'voyagershell')
  .replace(/([\\"`$])/g, '\\$1')
  .replace(/%/g, '%%');
fs.writeFileSync(
  path.join(applications, 'voyagershell.desktop'),
  `[Desktop Entry]\nType=Application\nName=Voyager Shell\nComment=Let's go together. An agent orchestrator that lets you team up.\nExec="${executable}" --ozone-platform=x11\nIcon=voyagershell\nTerminal=false\nCategories=Development;\nStartupWMClass=voyagershell\n`,
);
console.log(
  `Installed Voyager Shell: ${path.join(current, 'voyagershell')}\nOpen it from Applications. No login startup or system service was installed.`,
);
