export default () => ({
  port:     parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv:  process.env.NODE_ENV ?? 'development',
  appName:  process.env.APP_NAME ?? 'IAM Core',

  database: {
    url: process.env.DATABASE_URL,
  },

  jwt: {
    privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH ?? './keys/private.pem',
    publicKeyPath:  process.env.JWT_PUBLIC_KEY_PATH  ?? './keys/public.pem',
    accessExpiry:   parseInt(process.env.JWT_ACCESS_EXPIRY  ?? '900',   10),
    refreshExpiry:  parseInt(process.env.JWT_REFRESH_EXPIRY ?? '28800', 10),
    tempExpiry:     parseInt(process.env.JWT_TEMP_EXPIRY    ?? '300',   10),
    issuer:         process.env.JWT_ISSUER   ?? 'iam-core',
    audience:       process.env.JWT_AUDIENCE ?? 'forms-service',
  },

  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:3001').split(','),
  },

  totp: {
    encryptionKey: process.env.TOTP_ENCRYPTION_KEY ?? '',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10),
    max:      parseInt(process.env.RATE_LIMIT_MAX        ?? '100',   10),
  },

  log: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});
