import { LlmError } from '../../domain/errors.js';

/**
 * Runs an abortable operation under a deadline.
 *
 * A hung upstream connection is the failure mode that hurts most: without a
 * deadline it holds a request, a socket and a client spinner for as long as the
 * provider feels like it. Bounding it converts an unbounded hang into a fast,
 * classifiable `timeout` that the fallback path knows how to answer.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  const deadline = AbortSignal.timeout(timeoutMs);
  // Either our deadline or the caller giving up (client disconnect) aborts the call.
  const signal = externalSignal ? AbortSignal.any([deadline, externalSignal]) : deadline;

  try {
    return await operation(signal);
  } catch (cause) {
    if (deadline.aborted) {
      throw new LlmError('timeout', `Provider call exceeded ${timeoutMs}ms.`, { cause });
    }
    throw cause;
  }
}
