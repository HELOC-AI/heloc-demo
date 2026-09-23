import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './log.ts';

const now = () => new Date('2026-09-23T04:56:42.000Z');

function setup(betterStack?: { ingestingHost?: string; sourceToken?: string }) {
  const pending: Promise<unknown>[] = [];
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  const out = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const log = createLogger({
    requestId: 'req-1',
    betterStack,
    waitUntil: (p) => pending.push(p),
    fetch: fetch as unknown as typeof globalThis.fetch,
    console: out,
    now,
  });
  return { log, fetch, out, pending };
}

describe('createLogger', () => {
  it('writes the shared log shape to the console', () => {
    const { log, out } = setup();
    log.info('inbound.received', 'inbound email received', { from_domain: 'gmail.com' });
    expect(JSON.parse(out.log.mock.calls[0]?.[0] as string)).toEqual({
      dt: '2026-09-23T04:56:42.000Z',
      level: 'info',
      service: 'email-inbound',
      event: 'inbound.received',
      request_id: 'req-1',
      message: 'inbound email received',
      from_domain: 'gmail.com',
    });
  });

  it('does not let fields override the envelope keys', () => {
    const { log, out } = setup();
    log.error('inbound.forward_failed', 'boom', { level: 'info', service: 'x', event: 'y' });
    expect(JSON.parse(out.error.mock.calls[0]?.[0] as string)).toMatchObject({
      level: 'error',
      service: 'email-inbound',
      event: 'inbound.forward_failed',
    });
  });

  it('ships each entry to Better Stack through waitUntil', async () => {
    const { log, fetch, pending } = setup({ ingestingHost: 'in.example', sourceToken: 'tok' });
    log.warn('inbound.something', 'hmm');
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(fetch).toHaveBeenCalledWith('https://in.example', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: expect.stringContaining('"event":"inbound.something"'),
    });
  });

  it('swallows Better Stack failures', async () => {
    const { log, fetch, pending } = setup({ ingestingHost: 'in.example', sourceToken: 'tok' });
    fetch.mockRejectedValueOnce(new Error('down'));
    log.info('e', 'm');
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
  });

  it('skips Better Stack when not configured', () => {
    const { log, fetch, pending } = setup({ ingestingHost: 'in.example' });
    log.info('e', 'm');
    expect(fetch).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
  });
});
