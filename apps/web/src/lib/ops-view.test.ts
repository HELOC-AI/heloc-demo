import type { Overview } from '@heloc/ops';
import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatAvailability,
  formatCount,
  formatDuration,
  formatLatency,
  formatUtcShort,
  hourlyChart,
  humanize,
  parseUtc,
  shortLeadId,
  summarize,
} from './ops-view.ts';

describe('parseUtc', () => {
  it('reads ClickHouse timestamps as UTC', () => {
    expect(parseUtc('2026-09-23 10:15:00.123456')?.toISOString()).toBe('2026-09-23T10:15:00.123Z');
    expect(parseUtc('2026-09-23 10:15:00')?.toISOString()).toBe('2026-09-23T10:15:00.000Z');
  });

  it('passes ISO strings through', () => {
    expect(parseUtc('2026-09-23T10:15:00.000Z')?.toISOString()).toBe('2026-09-23T10:15:00.000Z');
  });

  it('gives up on nothing or garbage', () => {
    expect(parseUtc(null)).toBeUndefined();
    expect(parseUtc('')).toBeUndefined();
    expect(parseUtc('yesterday-ish')).toBeUndefined();
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const ago = (ms: number) => formatAgo(new Date(now.getTime() - ms), now);

  it.each([
    [-5_000, 'just now'],
    [2_000, 'just now'],
    [45_000, '45s ago'],
    [12 * 60_000, '12 min ago'],
    [3 * 3_600_000, '3 h ago'],
    [47 * 3_600_000, '47 h ago'],
    [3 * 86_400_000, '3 d ago'],
  ])('%i ms → %s', (ms, expected) => {
    expect(ago(ms)).toBe(expected);
  });
});

describe('formatUtcShort', () => {
  const now = new Date('2026-09-23T12:00:00Z');

  it('shows the time for today and the date before that', () => {
    expect(formatUtcShort(new Date('2026-09-23T09:05:00Z'), now)).toBe('09:05 UTC');
    expect(formatUtcShort(new Date('2026-09-22T23:59:00Z'), now)).toBe('Sep 22, 23:59 UTC');
  });
});

describe('numbers', () => {
  it('never rounds availability up to 100%', () => {
    expect(formatAvailability(1)).toBe('100%');
    expect(formatAvailability(0.99999)).toBe('99.99%');
    expect(formatAvailability(0.9876)).toBe('98.76%');
    expect(formatAvailability(0)).toBe('0.00%');
  });

  it('formats latency', () => {
    expect(formatLatency(84.4)).toBe('84 ms');
    expect(formatLatency(1234)).toBe('1.2 s');
  });

  it.each([
    [0, '0s'],
    [42, '42s'],
    [240, '4m'],
    [252, '4m 12s'],
    [3600, '1h'],
    [3900, '1h 5m'],
  ])('%i s of downtime → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('groups counts', () => {
    expect(formatCount(12345)).toBe('12,345');
  });
});

describe('labels', () => {
  it('shortens Lead ids', () => {
    expect(shortLeadId('1f0c2b7e-8a4d-4c1e-9b2f-3d4e5f6a7b8c')).toBe('1f0c2b7e');
  });

  it('humanizes codes', () => {
    expect(humanize('need_more_documents')).toBe('Need more documents');
    expect(humanize('figure-mock')).toBe('Figure mock');
  });
});

const lead = {
  lead_id: '1f0c2b7e-8a4d-4c1e-9b2f-3d4e5f6a7b8c',
  status: 'failed' as const,
  failed_step: 'prequalify' as const,
  updated_at: '2026-09-23T11:00:00.000Z',
};

function overview(parts: Partial<Overview> = {}): Overview {
  return {
    generatedAt: '2026-09-23T12:00:00.000Z',
    health: {
      ok: true,
      data: [
        { service: 'intake', url: 'https://intake', ok: true, latencyMs: 80 },
        { service: 'chase', url: 'https://chase', ok: true, latencyMs: 90 },
      ],
    },
    statusPage: { ok: true, data: { url: 'https://status', state: 'operational', resources: [] } },
    alerts: { ok: true, data: [] },
    stats: {
      ok: true,
      data: {
        errors: 0,
        http5xx: 0,
        leadsSubmitted: 0,
        leadsFailed: 0,
        topErrors: [],
        errorsByHour: [],
      },
    },
    attention: { ok: true, data: [] },
    ...parts,
  };
}

describe('summarize', () => {
  it('says all is well when nothing is wrong', () => {
    expect(summarize(overview())).toEqual({
      issues: 0,
      headline: 'All systems operational',
      details: [],
      unavailable: [],
    });
  });

  it('counts unhealthy services, firing alerts and Leads needing attention', () => {
    const summary = summarize(
      overview({
        health: {
          ok: true,
          data: [{ service: 'chase', url: 'https://chase', ok: false, latencyMs: 5000 }],
        },
        alerts: {
          ok: true,
          data: [
            {
              id: 'errors',
              alert: 'heloc: errors logged',
              description: '',
              runbook: '',
              lastWindow: 3,
              firing: true,
              last24h: 3,
              lastSeen: null,
            },
            {
              id: 'http5xx',
              alert: 'heloc: HTTP 5xx responses',
              description: '',
              runbook: '',
              lastWindow: 0,
              firing: false,
              last24h: 1,
              lastSeen: null,
            },
          ],
        },
        attention: { ok: true, data: [lead, { ...lead, lead_id: 'other' }] },
      }),
    );
    expect(summary.issues).toBe(4);
    expect(summary.headline).toBe('4 issues');
    expect(summary.details).toEqual(['1 service down', '1 alert firing', '2 Leads need attention']);
  });

  it('uses the singular for one issue', () => {
    const summary = summarize(overview({ attention: { ok: true, data: [lead] } }));
    expect(summary.headline).toBe('1 issue');
    expect(summary.details).toEqual(['1 Lead needs attention']);
  });

  it('lists the sections it could not see', () => {
    const summary = summarize(
      overview({
        alerts: { ok: false, error: 'Better Stack query connection not configured' },
        attention: { ok: false, error: 'OPS_API_KEY not configured' },
      }),
    );
    expect(summary.issues).toBe(0);
    expect(summary.headline).toBe('No issues found');
    expect(summary.unavailable).toEqual(['alerts', 'Leads needing attention']);
  });
});

describe('hourlyChart', () => {
  const now = new Date('2026-09-23T12:34:00Z');

  it('fills every hour ending with the current one', () => {
    const chart = hourlyChart([], { now, hours: 3 });
    expect(chart.buckets.map((b) => b.time)).toEqual([
      '2026-09-23T10:00:00.000Z',
      '2026-09-23T11:00:00.000Z',
      '2026-09-23T12:00:00.000Z',
    ]);
    expect(chart.max).toBe(0);
    expect(chart.series).toEqual([]);
  });

  it('stacks series per hour in a stable order', () => {
    const chart = hourlyChart(
      [
        { time: '2026-09-23 11:00:00', series: 'zeta', value: 1 },
        { time: '2026-09-23 11:00:00', series: 'chase', value: 2 },
        { time: '2026-09-23 12:00:00', series: 'intake', value: 5 },
        { time: '2026-09-23 12:00:00', series: 'chase', value: 1 },
      ],
      { now, hours: 3, order: ['intake', 'figure-mock', 'chase'] },
    );
    expect(chart.series).toEqual(['intake', 'chase', 'zeta']);
    expect(chart.buckets.map((b) => b.values)).toEqual([
      [0, 0, 0],
      [0, 2, 1],
      [5, 1, 0],
    ]);
    expect(chart.buckets.map((b) => b.total)).toEqual([0, 3, 6]);
    expect(chart.max).toBe(6);
  });

  it('ignores points outside the window', () => {
    const chart = hourlyChart(
      [
        { time: '2026-09-22 09:00:00', series: 'intake', value: 9 },
        { time: 'garbage', series: 'intake', value: 9 },
      ],
      { now, hours: 3 },
    );
    expect(chart.max).toBe(0);
  });
});
