const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const source = require('node:path').resolve(__dirname, '../src/main.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
async function check(argv, failPanel) {
  let ready;
  const events = [];
  const nativeRequire = createRequire(source);
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      disableHardwareAcceleration() {},
      setName() {},
      setDesktopName() {},
      setPath() {},
      requestSingleInstanceLock: () => true,
      on() {},
      whenReady: () => ({
        then(fn) {
          ready = fn;
        },
      }),
    },
    ipcMain: { handle() {} },
    screen: {
      on() {},
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    globalShortcut: {
      register() {
        events.push('shortcut-registered');
        return true;
      },
    },
  };
  const context = vm.createContext({
    require: (n) => (n === 'electron' ? electron : nativeRequire(n)),
    __dirname: source.slice(0, source.lastIndexOf('/')),
    process: { ...process, argv },
    console,
    Buffer,
    performance,
    setTimeout,
    clearTimeout,
    setInterval(fn, ms) {
      events.push('interval-' + ms);
      return 1;
    },
    clearInterval() {},
    events,
    failPanel,
  });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context);
  vm.runInContext(
    `
 createWindow=()=>{let bounds={x:0,y:0,width:320,height:372};return {isVisible:()=>true,getBounds:()=>bounds,setBounds:b=>{bounds={...bounds,...b}},showInactive(){},hide(){},moveTop(){},setParentWindow(){},setFocusable(){},setIgnoreMouseEvents(){},on(){},loadFile:async()=>{},webContents:{session:{setPermissionCheckHandler(){},setPermissionRequestHandler(){}}}}};
 rpc=async()=>{};refresh=async()=>{};conversation.poll=async()=>{};sendState=()=>{};
 recoverControls=async()=>{events.push('recovery');await setExpanded(true);};
 setExpanded=async value=>{expanded=value;events.push('expanded-'+value);if(value&&failPanel)throw Error('The desktop did not show the panel');};
 `,
    context,
  );
  let error = null;
  try {
    await ready();
  } catch (e) {
    error = e.message;
  }
  return { argv, failPanel, events, error, expanded: vm.runInContext('expanded', context) };
}
test('cold Applications launch opens both controls without a separate expanded flag', async () => {
  const result = await check(['voyagershell', '--from-applications'], false);
  assert.equal(result.error, null);
  assert.equal(result.expanded, true);
  assert(result.events.includes('recovery'));
});
test('failed initial presentation still installs keyboard and periodic recovery', async () => {
  const result = await check(['voyagershell', '--expanded'], true);
  assert.equal(result.error, null);
  assert(result.events.includes('shortcut-registered'));
  assert(result.events.includes('interval-750'));
  assert(result.events.includes('interval-32'));
});
