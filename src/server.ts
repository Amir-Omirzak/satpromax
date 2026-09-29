import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { createTokenService } from './http/auth.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);

const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

const app = createApp({ db, tokens: createTokenService(config.JWT_SECRET, config.JWT_EXPIRES_IN) });
const server = app.listen(config.PORT, () => {
  console.log(`SAT PRO MAX API listening on http://localhost:${config.PORT}`);
});

// Finish in-flight requests before exiting (docker stop, Ctrl+C).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => db.end().then(() => process.exit(0)));
  });
}
