import 'dotenv/config';
import pg from 'pg';

// BIGINT/NUMERIC como numeros y DATE como texto (YYYY-MM-DD) para evitar problemas de zona horaria
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(1082, (v) => v);

const url = process.env.DATABASE_URL || 'postgres://obs:obs@127.0.0.1:5432/observatorio';
function sslConfig() {
  const flag = process.env.DATABASE_SSL;
  if (flag === 'false') return false;
  if (flag === 'true' || /sslmode=require/.test(url) || /supabase\.(co|com)|neon\.tech/.test(url)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

export const pool = new pg.Pool({ connectionString: url, ssl: sslConfig(), max: 8 });
export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
