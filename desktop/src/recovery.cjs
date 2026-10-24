function launchContext(env = process.env, argv = process.argv) {
  return {
    gnomeApplications:
      argv.includes('--from-applications') &&
      (env.XDG_CURRENT_DESKTOP || '').split(':').includes('GNOME'),
  };
}
function recoveryDisplay(screen, cursor, context) {
  return context?.gnomeApplications === true
    ? screen.getPrimaryDisplay()
    : screen.getDisplayNearestPoint(cursor);
}
module.exports = { launchContext, recoveryDisplay };
