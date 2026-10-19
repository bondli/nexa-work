const { app } = require('electron');
const fs = require('fs');
const log = (m) => fs.appendFileSync('/tmp/nexa-test-final.log', m + '\n');

app.whenReady().then(() => {
  try {
    log('1: loading better-sqlite3');
    const Database = require('better-sqlite3');
    log('2: Database = ' + typeof Database);
    
    const dbPath = require('os').homedir() + '/.nexa/nexa.db';
    const path = require('path');
    const mkdirSync = require('fs').mkdirSync;
    mkdirSync(path.dirname(dbPath), { recursive: true });
    
    log('3: creating DB at ' + dbPath);
    const db = new Database(dbPath);
    log('4: DB created');
    
    db.pragma('journal_mode = WAL');
    log('5: WAL = ' + JSON.stringify(db.pragma('journal_mode')));
    
    db.exec('CREATE TABLE IF NOT EXISTS test_foo(id TEXT)');
    db.prepare('INSERT INTO test_foo VALUES (?)').run('hello');
    log('6: table created + row inserted');
    
    const rows = db.prepare('SELECT * FROM test_foo').all();
    log('7: rows = ' + JSON.stringify(rows));
    
    db.close();
    log('8: ALL OK - Electron + better-sqlite3 works!');
  } catch(e) {
    log('ERR: ' + (e && e.message ? e.message : String(e)));
    log(e && e.stack ? e.stack : '');
  }
  app.quit();
});
app.on('uncaughtException', (e) => { log('UNCAUGHT: ' + e.message); app.quit(); });
