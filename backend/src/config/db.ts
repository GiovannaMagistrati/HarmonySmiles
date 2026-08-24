import pg, { PoolClient, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// DATE columns (OID 1082, e.g. appointments.appointment_date) are a pure calendar date with
// no time-of-day meaning. pg's default parser turns them into a JS Date at LOCAL server
// midnight, which then serializes to a UTC ISO string that silently shifts a day whenever the
// server's own OS timezone isn't UTC (this dev machine is Africa/Cairo, UTC+3) — return the raw
// 'YYYY-MM-DD' text instead so no timezone conversion ever happens on the way out.
pg.types.setTypeParser(1082, (value: string) => value);

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // Managed Postgres hosts (Render, Supabase, Neon, ...) require SSL for external
  // connections; local dev Postgres has no cert configured, so this is opt-in via env var.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('connect', () => {
  console.log('Connected to the database');
});
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(1);
});

export const query = <T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]) => {
  return pool.query<T>(text, params);
};

export const getClient = (): Promise<PoolClient> => {
  return pool.connect();
};

// Ends the pool; only used by one-off scripts (e.g. seed.ts) so they can exit.
export const closePool = (): Promise<void> => {
  return pool.end();
};

// Runs `fn` inside BEGIN/COMMIT, rolling back and releasing the client on any error.
export const withTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

