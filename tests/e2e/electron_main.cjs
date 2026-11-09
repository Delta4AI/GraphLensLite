// Electron entry for the opt-in end-to-end tests: the real page, rendered
// offscreen. A plain hidden window delivers animation frames unreliably, which
// stalls both the app's load path and Playwright's "stable" check; offscreen
// rendering keeps producing frames (WebGL2 included).
/* global __dirname */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  global.win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  global.win.loadFile(path.join(__dirname, '..', '..', 'src', 'graph_lens_lite.html'));
});
