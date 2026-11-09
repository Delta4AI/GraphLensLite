const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');

// In development the asset cache only ever serves stale JS/CSS — there is nothing
// worth caching from local files. Disable it so every reload pulls fresh bytes.
// Packaged builds are immutable, so they keep the default cache untouched.
if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-http-cache');
}

const UNSAVED_CHECK_TIMEOUT_MS = 2000;
// Set by a quit (Cmd+Q, app menu) so a close that had to ask can resume it.
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

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

  // Closing would lose unsaved work (history.js unsavedWork): ask first.
  let mayClose = false;
  win.on('close', (event) => {
    if (mayClose) return;
    event.preventDefault();
    // A page that is stuck or gone cannot answer: ask rather than guess either way.
    const noAnswer = new Promise((resolve) => setTimeout(() => resolve(true), UNSAVED_CHECK_TIMEOUT_MS));
    Promise.race([win.webContents.executeJavaScript('!!window.cache?.history?.unsavedWork'), noAnswer])
      .catch(() => true)
      .then((unsaved) => {
        const leave =
          !unsaved ||
          dialog.showMessageBoxSync(win, {
            type: 'question',
            buttons: ['Close without saving', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            title: 'Unsaved changes',
            message: 'This graph has changes that are not saved.',
            detail: 'Save it with File › Save as JSON (S) to keep them.',
          }) === 0;
        if (!leave) {
          quitting = false;
          return;
        }
        mayClose = true;
        win.close();
        if (quitting) app.quit(); // Cmd+Q was held up by the question; finish it
      });
  });

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