// Electron entry for the opt-in end-to-end tests: the real page, rendered
// offscreen. A plain hidden window delivers animation frames unreliably, which
// stalls both the app's load path and Playwright's "stable" check; offscreen
// rendering keeps producing frames (WebGL2 included).
/* global __dirname, process */
const { app, BrowserWindow } = require('electron');
const path = require('path');

// Software WebGL for hosts without a usable GPU (CI runners, sandboxes):
// GLL_E2E_SWIFTSHADER=1. Without it WebGL fails there and the graph never builds.
if (process.env.GLL_E2E_SWIFTSHADER) {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

app.whenReady().then(() => {
  global.win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  global.win.loadFile(path.join(__dirname, '..', '..', 'src', 'graph_lens_lite.html'));
});
