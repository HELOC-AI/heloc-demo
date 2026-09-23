import { describe, expect, it } from 'vitest';
import { createSubmissionKeys } from './submission-key.ts';

describe('createSubmissionKeys', () => {
  it('reuses the key for the same answers and starts a new one when they change', () => {
    let n = 0;
    const keyFor = createSubmissionKeys(() => `key-${++n}`);
    expect(keyFor({ email: 'a@example.com' })).toBe('key-1');
    expect(keyFor({ email: 'a@example.com' })).toBe('key-1');
    expect(keyFor({ email: 'b@example.com' })).toBe('key-2');
    expect(keyFor({ email: 'a@example.com' })).toBe('key-3');
  });

  it('makes UUIDs by default', () => {
    expect(createSubmissionKeys()({})).toMatch(/^[0-9a-f-]{36}$/);
  });
});
