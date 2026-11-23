import { initDb, pool } from '../src/init.js';
initDb().then((s) => { console.log('Migración OK' + (s ? ' + seed' : '')); return pool.end(); })
  .catch((e) => { console.error(e); process.exit(1); });
