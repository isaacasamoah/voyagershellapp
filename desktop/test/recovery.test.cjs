const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchContext, recoveryDisplay } = require('../src/recovery.cjs');

test('GNOME Applications recovery uses the grid display rather than stale XWayland pointer coordinates', () => {
  const screen = { getPrimaryDisplay: () => 'grid', getDisplayNearestPoint: () => 'old-pointer' };
  const context = launchContext(
    {
      XDG_CURRENT_DESKTOP: 'GNOME',
      GIO_LAUNCHED_DESKTOP_FILE: '/candidate.desktop',
    },
    ['voyager', '--from-applications'],
  );
  assert.equal(recoveryDisplay(screen, { x: 10, y: 20 }, context), 'grid');
  assert.equal(recoveryDisplay(screen, { x: 10, y: 20 }), 'old-pointer');
  assert.equal(recoveryDisplay(screen, {}, { gnomeApplications: 'true' }), 'old-pointer');
  assert.equal(launchContext({ XDG_CURRENT_DESKTOP: 'GNOME' }).gnomeApplications, false);
  assert.equal(
    launchContext({ XDG_CURRENT_DESKTOP: 'KDE', GIO_LAUNCHED_DESKTOP_FILE: '/candidate.desktop' })
      .gnomeApplications,
    false,
  );
});

test('a terminal inheriting desktop variables is not an Applications recovery request', () => {
  assert.equal(
    launchContext(
      { XDG_CURRENT_DESKTOP: 'GNOME', GIO_LAUNCHED_DESKTOP_FILE: '/terminal.desktop' },
      ['voyager'],
    ).gnomeApplications,
    false,
  );
});
