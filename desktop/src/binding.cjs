const fs = require('node:fs/promises');

async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw Error('Invalid process identity');
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  const fields = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);
  const argv = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  const executable = await fs.readlink(`/proc/${pid}/exe`);
  return { pid, start: fields[19], argv, executable };
}

async function directChildren(pid) {
  const tasks = await fs.readdir(`/proc/${pid}/task`);
  const children = await Promise.all(
    tasks.map(async (tid) => {
      try {
        return (await fs.readFile(`/proc/${pid}/task/${tid}/children`, 'utf8'))
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(Number);
      } catch {
        return [];
      }
    }),
  );
  return [...new Set(children.flat())];
}

function resumeThread(argv, server) {
  const args = argv.slice(1);
  if (args.length !== 4 && args.length !== 5) return null;
  if (args[0] !== '--remote' || args[1] !== `unix://${server}` || args[2] !== 'resume') return null;
  if (args.length === 5 && args[4] !== '--no-alt-screen') return null;
  return /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args[3]) ? args[3] : null;
}

async function terminalSnapshot(pid) {
  const terminal = await processIdentity(pid);
  const children = await Promise.all(
    (await directChildren(pid)).map((child) => processIdentity(child).catch(() => null)),
  );
  return { terminal, children: children.filter(Boolean) };
}
async function identifyTerminal(pid, endpoint, snapshot) {
  const { terminal, children } = snapshot || (await terminalSnapshot(pid));
  if (terminal.executable !== '/usr/bin/ghostty') return null;
  const matches = [];
  for (const frontend of children) {
    const nativeId =
      endpoint.kind === 'shell'
        ? JSON.stringify(frontend.argv.slice(1)) === JSON.stringify(endpoint.args)
          ? endpoint.nativeId
          : null
        : resumeThread(frontend.argv, endpoint.server);
    if (frontend.executable === endpoint.executable && nativeId) {
      matches.push({
        ...terminal,
        frontend,
        nativeId,
        server: endpoint.server,
        external: endpoint.external,
      });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function resolveWindow(window, windows, records, identities, requireVisible = true) {
  if (!window || (requireVisible && !window.visible))
    return { error: 'This terminal is unavailable.' };
  const matches = records.filter((r) => r.pid === window.pid);
  if (matches.length !== 1) return { error: 'Can’t identify this terminal’s agent.' };
  const record = matches[0];
  if (windows.filter((w) => w.pid === record.pid).length !== 1)
    return { error: 'Use a separate terminal window for this agent.' };
  const terminal = identities.get(record.pid),
    frontend = identities.get(record.frontend.pid);
  if (
    !terminal ||
    terminal.start !== record.start ||
    terminal.executable !== record.executable ||
    !frontend ||
    frontend.start !== record.frontend.start ||
    frontend.executable !== record.frontend.executable ||
    JSON.stringify(frontend.argv) !== JSON.stringify(record.frontend.argv)
  )
    return { error: 'This terminal has changed. Try docking again.' };
  return { window, record };
}

function registeredSession(record, sessions) {
  return sessions.find((s) => s.server === record.server && s.native_thread_id === record.nativeId);
}

function windowAt(windows, point, excludedIds = []) {
  return [...windows]
    .reverse()
    .find(
      (w) =>
        w.visible &&
        !excludedIds.includes(w.id) &&
        point.x >= w.x &&
        point.y >= w.y &&
        point.x < w.x + w.width &&
        point.y < w.y + w.height,
    );
}

module.exports = {
  processIdentity,
  terminalSnapshot,
  identifyTerminal,
  resumeThread,
  resolveWindow,
  registeredSession,
  windowAt,
};
