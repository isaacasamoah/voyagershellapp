const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function snapshot(directory) {
  const git = (...args) => {
    try {
      return execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(`Git graph: ${error.stderr?.toString().trim() || error.message}`);
    }
  };
  const root = git('rev-parse', '--show-toplevel').replace(/\n$/, '');
  const main = git('rev-parse', '--verify', 'refs/heads/main^{commit}').trim();
  const worktrees = git('worktree', 'list', '--porcelain', '-z')
    .split('\0\0')
    .filter(Boolean)
    .map((record) =>
      Object.fromEntries(
        record
          .split('\0')
          .filter(Boolean)
          .map((line) => {
            const space = line.indexOf(' ');
            return space < 0 ? [line, true] : [line.slice(0, space), line.slice(space + 1)];
          }),
      ),
    );
  const records = git(
    'for-each-ref',
    '--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)',
    'refs/heads/',
  )
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, head, updated, subject] = line.split('\0');
      return { ref, head, updated, subject, name: ref.slice('refs/heads/'.length) };
    });
  for (const tree of worktrees.filter((entry) => entry.detached)) {
    records.push({ name: 'Detached HEAD', head: tree.HEAD, detached: tree.worktree });
  }
  const branches = records.map((record) => {
    const [behind, ahead] = git('rev-list', '--left-right', '--count', `${main}...${record.head}`)
      .trim()
      .split(/\s+/)
      .map(Number);
    const associated = worktrees.filter((tree) =>
      record.detached ? tree.worktree === record.detached : tree.branch === record.ref,
    );
    return {
      ...record,
      behind,
      ahead,
      worktrees: associated.map((tree) => ({
        path: tree.worktree,
        missing: !fs.existsSync(tree.worktree),
        locked: Boolean(tree.locked),
        prunable: Boolean(tree.prunable),
      })),
    };
  });
  return { root, main, generated: new Date().toISOString(), branches };
}

function render(data) {
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return fs
    .readFileSync(path.join(__dirname, 'git-graph.html'), 'utf8')
    .replace('GRAPH_DATA', () => json);
}

if (require.main === module) {
  try {
    const directory = path.resolve(process.argv[2] || '.');
    const data = snapshot(directory);
    const destination = path.resolve(process.argv[3] || path.join(data.root, 'git-graph.html'));
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, render(data), { mode: 0o600 });
      fs.renameSync(temporary, destination);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    console.log(`Wrote ${destination} (${data.branches.length} branch/head records).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { snapshot, render };
