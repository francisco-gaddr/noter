/**
 * Application-menu builder. Pure function — takes a context object and returns
 * a Menu template that can be passed to Menu.buildFromTemplate(). Kept here
 * (not in main.js) so it's unit-testable without an Electron runtime.
 *
 * `ctx` must provide:
 *   - app: { getName(), getVersion() }
 *   - shell: { openExternal(url) }
 *   - on: { quit, checkUpdate, openAbout, toggleDevTools }
 *   - isDev: boolean
 *   - isMac: boolean
 */

const { acceleratorFor } = require('./shortcuts');

const buildAppMenuTemplate = (ctx) => {
  const { app, shell, on, isDev, isMac } = ctx;
  const name = app.getName ? app.getName() : 'Noter';

  // Standard macOS application menu — Apple HIG expects File/Edit/View/Window/Help.
  // On Windows/Linux we use a flatter structure rooted at File.
  const macAppMenu = isMac ? [{
    label: name,
    submenu: [
      { label: `About ${name}`, click: () => on.openAbout && on.openAbout() },
      { type: 'separator' },
      { label: 'Check for Updates…', click: () => on.checkUpdate && on.checkUpdate() },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { label: `Quit ${name}`, accelerator: 'Cmd+Q', click: () => on.quit && on.quit() },
    ],
  }] : [];

  const fileMenu = {
    label: 'File',
    submenu: [
      { label: 'New Note', accelerator: acceleratorFor('noter.newNote'), click: () => on.newNote && on.newNote() },
      { label: 'Find in Page…', accelerator: acceleratorFor('noter.find'), click: () => on.find && on.find() },
      { type: 'separator' },
      isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Alt+F4', click: () => on.quit && on.quit() },
    ],
  };

  const editMenu = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  // View menu: include DevTools toggle ONLY in dev. In production we don't
  // expose it from the menu at all — the keyboard shortcut is also blocked
  // by webContents-level guards in main.js.
  const viewMenu = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      ...(isDev ? [{ role: 'toggleDevTools', click: () => on.toggleDevTools && on.toggleDevTools() }] : []),
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const windowMenu = {
    label: 'Window',
    role: 'windowMenu',
  };

  const helpMenu = {
    label: 'Help',
    role: 'help',
    submenu: [
      { label: 'Learn More', click: () => shell.openExternal && shell.openExternal('https://daylited.com/') },
      { type: 'separator' },
      { label: 'Check for Updates…', click: () => on.checkUpdate && on.checkUpdate() },
      ...(isMac ? [] : [
        { type: 'separator' },
        { label: `About ${name}`, click: () => on.openAbout && on.openAbout() },
      ]),
    ],
  };

  return [
    ...macAppMenu,
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ];
};

module.exports = { buildAppMenuTemplate };
