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
  // Linux records children on the thread that spawned them, not necessarily
  // the terminal's main thread. These are still direct children, not a tree scan.
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
      } // A terminal thread can exit while enumerating it.
    }),
  );
  return [...new Set(children.flat())];
}

async function identifyTerminal(pid, sessionId, info) {
  const terminal = await processIdentity(pid);
  if (terminal.executable !== '/usr/bin/ghostty') return null;
  const expectedExecutable = await fs.realpath(info.executable);
  for (const child of await directChildren(pid)) {
    let frontend;
    try {
      frontend = await processIdentity(child);
    } catch {
      continue;
    }
    if (
      frontend.executable === expectedExecutable &&
      JSON.stringify(frontend.argv.slice(1)) === JSON.stringify(info.args)
    ) {
      return { ...terminal, frontend, sessionId, nativeId: info.native_thread_id };
    }
  }
  return null;
}

function resolveWindow(window, windows, records, sessions, identities) {
  if (!window?.visible) return { error: 'This terminal is unavailable.' };
  const record = records.find((r) => r.pid === window.pid);
  if (!record) return { error: 'Can’t connect to this terminal yet.' };
  // Even hidden siblings make a process-to-window association ambiguous.
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
  const session = sessions.find(
    (s) => s.id === record.sessionId && s.native_thread_id === record.nativeId,
  );
  if (!session || session.capture !== 'connected' || session.worker_state !== 'running')
    return { error: 'This agent is disconnected.' };
  return { window, session, record };
}

function windowAt(windows, point, excludedPid) {
  return [...windows]
    .reverse()
    .find(
      (w) =>
        w.visible &&
        w.pid !== excludedPid &&
        point.x >= w.x &&
        point.y >= w.y &&
        point.x < w.x + w.width &&
        point.y < w.y + w.height,
    );
}

module.exports = { processIdentity, identifyTerminal, resolveWindow, windowAt };
