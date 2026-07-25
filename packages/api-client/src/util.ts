/**
 * Turn a PostgREST error into something throwable, preserving the SQLSTATE so
 * callers can distinguish the handful of user-actionable cases (23505 unique
 * violation, 42501 RLS denial) from genuine faults.
 */
export function must<T>(
  data: T | null,
  error: { message: string; code?: string } | null,
  what: string,
): T {
  if (error) {
    const err = new Error(`${what}: ${error.message}`) as Error & { code?: string };
    if (error.code !== undefined) err.code = error.code;
    throw err;
  }
  if (data === null) throw new Error(`${what}: no data returned`);
  return data;
}
