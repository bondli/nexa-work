const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const log = (m) => fs.appendFileSync('/tmp/electron-min.log', m + '\n');

app.whenReady().then(() => {
  log('ready!');
  const w = new BrowserWindow({ width: 400, height: 300, show: false });
  w.loadURL('data:text/html,<h1>ok</h1>');
  setTimeout(() => { app.quit(); }, 1500);
});
app.on('uncaughtException', (e) => { log('UNCAUGHT: ' + e.message); app.quit(); });
