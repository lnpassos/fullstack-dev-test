/** Structured-logging port. Keeps pino out of the application layer. */
export interface Logger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * Null object: discards everything. The empty bodies are the implementation, not
 * an oversight — a unit test asserting on behaviour should not also be asserting
 * on log output, and should not have to silence it.
 */
/* eslint-disable @typescript-eslint/no-empty-function */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
/* eslint-enable @typescript-eslint/no-empty-function */
