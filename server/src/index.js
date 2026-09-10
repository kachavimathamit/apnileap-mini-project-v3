import { config } from './config.js';
import { migrate } from './db/connection.js';
import { createApp } from './app.js';
import { runEventSweep } from './services/notifications.js';

migrate();

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Mini-Project Portfolio Portal API listening on http://localhost:${config.port}`);
  console.log(`  environment : ${config.env}`);
  console.log(`  database    : ${config.databaseFile}`);
  console.log(`  web origin  : ${config.webOrigin}`);
  console.log(`  mail        : ${config.mail.transport}`);
});

/**
 * Time-based events (overdue actions, approaching reviews, stale projects) are
 * swept hourly. Administrators can also trigger the sweep from POST /api/admin/sweep.
 */
const sweepInterval = setInterval(() => {
  try {
    runEventSweep({ staleDays: config.staleProjectDays });
  } catch (error) {
    console.error('[sweep] failed', error.message);
  }
}, 60 * 60 * 1000);
sweepInterval.unref();

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down.`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
