const { app } = require('electron');
const fs = require('fs');

app.whenReady().then(() => {
  try {
    fs.appendFileSync('/tmp/nexa-test.log', '[1] app ready\n');
    const Database = require('better-sqlite3');
    fs.appendFileSync('/tmp/nexa-test.log', '[2] Database loaded: ' + typeof Database + '\n');
    const db = new Database(':memory:');
    fs.appendFileSync('/tmp/nexa-test.log', '[3] DB created\n');
    db.pragma('journal_mode = WAL');
    fs.appendFileSync('/tmp/nexa-test.log', '[4] WAL: ' + JSON.stringify(db.pragma('journal_mode')) + '\n');
    db.exec('CREATE TABLE t(id TEXT)');
    const tables = db.prepare("SELECT name FROM sqlite_master").all();
    fs.appendFileSync('/tmp/nexa-test.log', '[5] Tables: ' + JSON.stringify(tables) + '\n');
    db.close();
    fs.appendFileSync('/tmp/nexa-test.log', '[6] ALL OK\n');
  } catch(e) {
    fs.appendFileSync('/tmp/nexa-test.log', '[ERR] ' + e.message + '\n' + e.stack + '\n');
  }
  app.quit();
});

app.on('uncaughtException', (e) => {
  fs.appendFileSync('/tmp/nexa-test.log', '[UNCAUGHT] ' + e.message + '\n');
  app.quit();
});
