import { z } from 'zod';

/**
 * Environment contract.
 *
 * Parsed once at boot and validated with Zod so that a misconfigured deployment
 * fails immediately and loudly, instead of surfacing as a 500 on the first
 * request that reaches the LLM provider.
 */

/** Env vars arrive as strings; accept the usual truthy spellings. */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

/**
 * An empty env var means "unset", not "set to an empty string".
 *
 * `.env` templates ship keys with an empty value for the reader to fill in, and
 * container platforms inject empty strings for unset variables. Without this,
 * copying `.env.example` and running with the fake provider fails validation on
 * a key that is not even needed.
 */
const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // --- LLM provider selection -------------------------------------------
    // `fake` is a deterministic in-process provider used by tests and by
    // offline development; it never performs network I/O. A second real
    // provider would be another adapter behind the same port -- see the README
    // for why only the verified one ships.
    LLM_PROVIDER: z.enum(['gemini', 'fake']).default('gemini'),
    GEMINI_API_KEY: optionalSecret,
    GEMINI_MODEL: z.string().min(1).default('gemini-flash-lite-latest'),
    /**
     * Reasoning-token allowance. Leave unset for models that do not reason —
     * they reject the field with 400. Set to 0 when pointing GEMINI_MODEL at a
     * reasoning model, where reasoning otherwise consumes the output budget.
     */
    GEMINI_THINKING_BUDGET: z.coerce.number().int().min(0).optional(),

    // --- Resilience --------------------------------------------------------
    /** Deadline for a single provider call. */
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(8_000),
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    /**
     * Deadline for the whole request, across every attempt.
     *
     * This is the number a user feels. Without it the worst case is
     * `(retries + 1) x LLM_TIMEOUT_MS` plus backoff, and someone buying a gift
     * card waits half a minute for messages we could have served instantly.
     */
    LLM_TOTAL_BUDGET_MS: z.coerce.number().int().positive().max(120_000).default(12_000),
    BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(5),
    BREAKER_RESET_MS: z.coerce.number().int().positive().default(30_000),

    // --- Cost controls -----------------------------------------------------
    CACHE_ENABLED: booleanFromEnv(true),
    CACHE_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
    CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),

    RATE_LIMIT_ENABLED: booleanFromEnv(true),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

    /** Comma-separated allowlist. `*` allows any origin (development only). */
    CORS_ORIGINS: z.string().default('*'),

    /**
     * How many reverse proxies sit in front of this process.
     *
     * Express derives the client IP from `X-Forwarded-For`, and the per-IP rate
     * limit is only as trustworthy as that derivation. `0` (the default) ignores
     * the header entirely, which is correct for a directly exposed process;
     * behind Cloud Run or a load balancer set it to the number of hops. Setting
     * it too high lets a client forge its own address and bypass the limit.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  })
  .superRefine((env, ctx) => {
    // Tests run against the fake provider, so a missing key is not an error there.
    if (env.NODE_ENV === 'test') return;

    if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when LLM_PROVIDER="gemini"',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    // Report every problem at once — never echo the values, which may be secrets.
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}

/** Parsed CORS allowlist. `*` short-circuits to "reflect any origin". */
export function corsAllowlist(env: Env): string[] | '*' {
  const raw = env.CORS_ORIGINS.trim();
  if (raw === '*') return '*';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
