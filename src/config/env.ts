import { z } from 'zod';

/**
 * Runtime configuration schema.
 *
 * Every value the bot needs comes from the environment — nothing is read from
 * a committed file — so secrets stay out of the repository (spec §25).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  /** Optional guild for instant slash-command registration during development. */
  DISCORD_DEV_GUILD_ID: z.string().optional(),

  DEFAULT_PREFIX: z.string().min(1).max(5).default('!'),
  DEFAULT_VOLUME: z.coerce.number().int().min(0).max(200).default(70),
  MAX_QUEUE_SIZE: z.coerce.number().int().min(1).max(10_000).default(100),

  /** Canvas theme applied when a guild has not chosen one. */
  CANVAS_THEME: z.string().default('midnight'),
  /** Card style: the illustrated templates or the themeable dark panels. */
  CARD_VARIANT: z.enum(['classic', 'sakura']).default('sakura'),

  // ── Lavalink ──────────────────────────────────────────────────────────────
  LAVALINK_HOST: z.string().default('127.0.0.1'),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65_535).default(2333),
  LAVALINK_PASSWORD: z.string().default('youshallnotpass'),
  LAVALINK_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LAVALINK_NAME: z.string().default('main'),

  // ── Permissions ───────────────────────────────────────────────────────────
  /** Comma-separated Discord user ids with global control (spec §14.1). */
  BOT_OWNER_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  /**
   * Treat everyone as a DJ.
   *
   * Small servers usually want this; requiring a role there means one person
   * ends up doing all the skipping.
   */
  EVERYONE_IS_DJ: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Role id that grants DJ rights when EVERYONE_IS_DJ is false. */
  DJ_ROLE_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parses and caches `process.env`.
 *
 * Throws a readable aggregate error listing every invalid variable so a
 * misconfigured deploy fails at boot instead of at the first command.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test-only hook so a suite can re-parse a fresh environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
