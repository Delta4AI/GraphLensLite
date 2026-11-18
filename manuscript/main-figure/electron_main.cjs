// Electron entry for the manuscript figure: the real app, rendered offscreen
// (a hidden window delivers animation frames unreliably). The capture script
// raises devicePixelRatio over CDP, since offscreen windows ignore
// deviceScaleFactor and cannot grow past the physical screen.
/* global __dirname, process */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fresh profile per run: no saved zoom level, theme or panel state leaks into the figure.
// One fixed path, wiped at start (Playwright's close() skips Electron's quit handlers).
const profile = path.join(os.tmpdir(), 'gll-figure-profile');
fs.rmSync(profile, { recursive: true, force: true });
app.setPath('userData', profile);

const WIDTH = Number(process.env.GLL_FIG_W || 1600);
const HEIGHT = Number(process.env.GLL_FIG_H || 1000);

app.whenReady().then(() => {
  global.win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  global.win.loadFile(process.env.GLL_FIG_PAGE || path.join(__dirname, '..', '..', 'src', 'graph_lens_lite.html'));
});
