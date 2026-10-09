const fs = require('node:fs/promises');

async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw Error('Invalid process identity');
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  const fields = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);
  const argv = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  return { pid, start: fields[19], argv };
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

function resolveWindow(window, windows, records, sessions, identities) {
  if (!window?.visible) return { error: 'No supported terminal under the avatar' };
  const record = records.find((r) => r.pid === window.pid);
  if (!record) return { error: 'This window has no Voyager launch binding' };
  // Even hidden siblings make a process-to-window association ambiguous.
  if (windows.filter((w) => w.pid === record.pid).length !== 1)
    return { error: 'Several windows share this process; docking is ambiguous' };
  const terminal = identities.get(record.pid),
    frontend = identities.get(record.frontend.pid);
  if (
    !terminal ||
    terminal.start !== record.start ||
    !frontend ||
    frontend.start !== record.frontend.start ||
    JSON.stringify(frontend.argv) !== JSON.stringify(record.frontend.argv)
  )
    return { error: 'The original terminal client is no longer verified' };
  const session = sessions.find(
    (s) => s.id === record.sessionId && s.native_thread_id === record.nativeId,
  );
  if (!session || session.capture !== 'connected' || session.worker_state !== 'running')
    return { error: 'The registered worker is no longer connected' };
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

module.exports = { processIdentity, directChildren, resolveWindow, windowAt };
