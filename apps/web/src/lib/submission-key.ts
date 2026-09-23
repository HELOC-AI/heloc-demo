/**
 * Idempotency keys for quiz submissions: retrying the same answers (a double click, a
 * network error) reuses the key, so intake returns the first Lead instead of creating a
 * second one; changing any answer starts a new key.
 */
export function createSubmissionKeys(newKey: () => string = () => crypto.randomUUID()) {
  let last: { answers: string; key: string } | undefined;
  return function keyFor(answers: unknown): string {
    const serialized = JSON.stringify(answers);
    if (last?.answers !== serialized) last = { answers: serialized, key: newKey() };
    return last.key;
  };
}
