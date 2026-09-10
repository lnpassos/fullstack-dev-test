/** Minimal cache port. Swapping the in-memory adapter for Redis or Firestore
 *  in production is a composition-root change, not an application change. */
export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  readonly size: number;
  clear(): void;
}
