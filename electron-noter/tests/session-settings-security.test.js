const fs = require('fs');
const path = require('path');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');

describe('electron session/settings boundary', () => {
  it('keeps token, refresh token and user behind dedicated session IPC', () => {
    expect(mainJs).toContain("const sensitiveSessionKeys = new Set(['token', 'refreshToken', 'user'])");
    expect(mainJs).toContain("ipcMain.handle('session:get'");
    expect(mainJs).toContain("ipcMain.handle('session:set'");
    expect(mainJs).toContain("if (isSensitiveSessionKey(key)) return null;");
    expect(mainJs).toContain("if (isSensitiveSessionKey(key)) return false;");
    expect(mainJs).toContain("const hasToken = Object.prototype.hasOwnProperty.call(payload || {}, 'token')");
    expect(mainJs).toContain("const hasRefreshToken = Object.prototype.hasOwnProperty.call(payload || {}, 'refreshToken')");
    expect(mainJs).toContain("const hasUser = Object.prototype.hasOwnProperty.call(payload || {}, 'user')");
  });
});
