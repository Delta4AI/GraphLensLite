const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

// In development the asset cache only ever serves stale JS/CSS — there is nothing
// worth caching from local files. Disable it so every reload pulls fresh bytes.
// Packaged builds are immutable, so they keep the default cache untouched.
if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-http-cache');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,               // menu stays hidden until user presses Alt (Win/Linux)
    icon: path.join(__dirname, '..', '..', 'static', 'delta-4-icon.png'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, '..', 'graph_lens_lite.html'));

  // Clear any entries left over from a previous run before the switch took effect.
  if (!app.isPackaged) {
    win.webContents.session.clearCache();
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand http(s)/mailto URLs to the OS shell; never forward arbitrary
    // schemes (file:, javascript:, custom protocol handlers) from in-page
    // window.open calls. Per Electron's openExternal hardening guidance.
    if (/^(https?|mailto):/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

/* ──────────────────────────────
   HELP  >  About  menu template
   ────────────────────────────── */
const menuTemplate = [
  {
    label: 'About',
    submenu: [
      {
        label: 'Graph Lens Lite GitHub',
        click: () => {
          shell.openExternal('https://github.com/Delta4AI/GraphLensLite');
        }
      },
      {
        label: "Delta 4 AI",
        click: () => {
          shell.openExternal('https://www.delta4.ai/');
        }
      }
    ]
  }
];

const appMenu = Menu.buildFromTemplate(menuTemplate);
Menu.setApplicationMenu(appMenu);
/* ────────────────────────────── */

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});