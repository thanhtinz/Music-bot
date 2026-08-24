import { Pool, type PoolConfig } from 'pg';

import { createLogger } from '../../../telemetry/logger';

const logger = createLogger('postgres');

/**
 * The slice of a database driver the repositories use.
 *
 * A port rather than `pg.Pool` itself so a repository can be exercised against
 * anything that answers SQL — and so the driver stays in one file, which is
 * what makes swapping it later a contained change rather than a sweep.
 */
export interface SqlClient {
  query<Row>(text: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface PostgresPoolOptions extends PoolConfig {
  /** Connection string, as `DATABASE_URL` supplies it. */
  connectionString?: string;
}

/**
 * A pooled connection to Postgres.
 *
 * Pooled rather than one connection: the bot writes on every track change
 * across every guild it serves, and opening a connection per write would spend
 * more time connecting than writing.
 */
export class PostgresClient implements SqlClient {
  private readonly pool: Pool;

  constructor(options: PostgresPoolOptions) {
    this.pool = new Pool({
      // A stuck query must not hold a command open until Discord expires the
      // interaction; the same reasoning as the resolver timeouts.
      statement_timeout: 5_000,
      connectionTimeoutMillis: 5_000,
      ...options,
    });

    // A pool that loses a connection emits rather than throws; without a
    // listener Node treats it as an unhandled error and takes the process down.
    this.pool.on('error', (error) => {
      logger.warn({ err: error }, 'idle database connection failed');
    });
  }

  async query<Row>(text: string, params: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    const result = await this.pool.query(text, params as unknown[]);
    return { rows: result.rows as Row[] };
  }

  /** Closes every connection — used on graceful shutdown. */
  async end(): Promise<void> {
    await this.pool.end();
  }
}
