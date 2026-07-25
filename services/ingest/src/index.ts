import pg from 'pg';
import { runOnce } from './worker.ts';

/**
 * Entry point. Polls the queue, sleeping when it is empty.
 *
 * Polling rather than LISTEN/NOTIFY because the volume is a few shares a minute
 * at most and a poll loop has no reconnect semantics to get wrong. Revisit if
 * enrichment latency ever becomes user-visible.
 */

const IDLE_DELAY_MS = 2_000;
const ERROR_DELAY_MS = 10_000;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. See .env.example.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  max: Number(process.env.INGEST_POOL_SIZE ?? 4),
  // Point at Supabase and TLS is required; point at the local harness and it is
  // not available at all.
  ssl: connectionString.includes('supabase.') ? { rejectUnauthorized: true } : undefined,
});

let running = true;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, finishing current job then exiting`);
    running = false;
  });
}

async function main(): Promise<void> {
  console.log('ingest worker started');
  while (running) {
    try {
      const didWork = await runOnce(pool);
      if (!didWork) await sleep(IDLE_DELAY_MS);
    } catch (err) {
      console.error('worker loop error:', err);
      await sleep(ERROR_DELAY_MS);
    }
  }
  await pool.end();
  console.log('ingest worker stopped');
}

void main();
