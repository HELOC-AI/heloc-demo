import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './index.ts';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, destination };
}

describe('createLogger', () => {
  it('emits the structured shape from the spec', () => {
    const { lines, destination } = capture();
    const { logger } = createLogger({ service: 'intake-service', destination });
    logger.info(
      { lead_id: 'lead-1', request_id: 'req-1', event: 'figure.requested' },
      'calling figure',
    );

    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'intake-service',
      lead_id: 'lead-1',
      request_id: 'req-1',
      event: 'figure.requested',
      msg: 'calling figure',
    });
    expect(Date.parse(lines[0]?.timestamp as string)).not.toBeNaN();
  });

  it('redacts secrets and borrower PII', () => {
    const { lines, destination } = capture();
    const { logger } = createLogger({ service: 'chase-service', destination });
    logger.info({
      req: { headers: { authorization: 'Bearer secret-key' } },
      email: 'john@example.com',
      borrower: { phone: '+14155551234', name_length: 8 },
    });

    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain('secret-key');
    expect(line).not.toContain('john@example.com');
    expect(line).not.toContain('+14155551234');
    expect(lines[0]).toMatchObject({ borrower: { name_length: 8 } });
  });
});
