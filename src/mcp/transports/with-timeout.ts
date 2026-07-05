/**
 * Shared timeout helper for transport connections.
 *
 * Races a promise against a timeout, with proper cleanup to prevent
 * unhandled Promise rejections.
 */

/**
 * Race a promise against a timeout.
 *
 * Returns the promise result if it resolves before `ms` milliseconds,
 * otherwise rejects with `message`.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Create the timeout promise; keep a reference so we can explicitly
  // swallow its rejection when the main promise wins the race.
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
    // Eat the timeout rejection to prevent unhandled rejection warnings
    // when the main promise resolves before the timer fires.
    timeoutPromise.catch(() => {});
  }
}
