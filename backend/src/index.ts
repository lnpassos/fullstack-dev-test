import { bootstrap } from './bootstrap.js';
import { loadEnv } from './config/env.js';

/**
 * Process entrypoint. Deliberately thin: everything interesting is in
 * `bootstrap`, which the tests use directly.
 */

function main(): void {
  // Fail before binding a port rather than on the first request that needs the
  // missing setting — a container that cannot work should never report healthy.
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const { app, logger } = bootstrap(env);

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server listening');
  });

  // Stop accepting connections, let in-flight requests finish, then exit. The
  // timer is the backstop for a request that never completes: a deploy must not
  // hang on one stuck connection.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');

    const forceExit = setTimeout(() => {
      logger.error({ signal }, 'Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close((error) => {
      if (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });

  // A promise rejection nobody handled has left the process in a state we did
  // not design for. Log it and let the orchestrator restart us cleanly rather
  // than serving from an unknown state.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
}

main();
