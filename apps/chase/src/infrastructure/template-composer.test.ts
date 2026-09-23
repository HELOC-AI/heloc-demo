import { describe, expect, it } from 'vitest';
import type { Chase, OutcomeNotice } from '../domain/chase.ts';
import { TemplateComposer } from './template-composer.ts';

const chase = (overrides: Partial<Chase> = {}): Chase => ({
  chaseId: 'c1',
  leadId: 'l1',
  borrower: { name: 'John Doe', email: 'john@example.com' },
  requests: [{ label: 'Proof of income', reason: 'Income requires verification' }],
  replyAddress: 'reply+c1@linkerclaw.ai',
  ...overrides,
});

describe('TemplateComposer', () => {
  it('produces the email from the spec', () => {
    const message = new TemplateComposer().compose(chase());
    expect(message.subject).toBe('Additional documents required for your HELOC application');
    expect(message.text).toBe(
      [
        'Hi John,',
        '',
        'We need a few additional documents to continue processing your HELOC application.',
        '',
        'Please provide:',
        '',
        '- Proof of income',
        '  Reason: Income requires verification.',
        '',
        'Simply reply to this email and attach the documents — we will pick them up automatically.',
        '',
        'Thanks.',
      ].join('\n'),
    );
    expect(message.html).toContain(
      '<li><strong>Proof of income</strong><br />Reason: Income requires verification.</li>',
    );
  });

  it('lists every requested document', () => {
    const message = new TemplateComposer().compose(
      chase({
        requests: [
          { label: 'Proof of income', reason: 'Income requires verification' },
          { label: 'Your most recent mortgage statement', reason: 'Balance must be confirmed.' },
        ],
      }),
    );
    expect(message.text).toContain(
      '- Your most recent mortgage statement\n  Reason: Balance must be confirmed.',
    );
    expect(message.html.match(/<li>/g)).toHaveLength(2);
  });

  it('escapes borrower-provided text in HTML', () => {
    const message = new TemplateComposer().compose(
      chase({ borrower: { name: '<script>alert(1)</script> Doe', email: 'x@y.z' } }),
    );
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&#60;script&#62;');
  });
});

describe('TemplateComposer.composeOutcome', () => {
  const notice = (outcome: OutcomeNotice['outcome']): OutcomeNotice => ({
    noticeId: 'n1',
    leadId: 'l1',
    borrower: { name: 'John Doe', email: 'john@example.com' },
    outcome,
    resultUrl: 'https://heloc-demo.vercel.app/result/l1',
  });

  it('summarises the offer and links to the result page', () => {
    const message = new TemplateComposer().composeOutcome(
      notice({
        status: 'approved',
        offer: {
          lender: 'Figure mock',
          amount: 250_000,
          aprMin: 7.5,
          aprMax: 9.5,
          termMonths: 120,
          estimatedMonthlyPayment: 2_968,
          expiresAt: new Date('2026-10-23T00:00:00Z'),
        },
      }),
    );
    expect(message.subject).toBe('Your HELOC offer is ready');
    expect(message.text).toContain('- Credit line: $250,000');
    expect(message.text).toContain('- APR: 7.5% – 9.5%');
    expect(message.text).toContain('- Term: 10 years');
    expect(message.text).toContain('- Offer valid until: October 23, 2026');
    expect(message.text).toContain('View your offer: https://heloc-demo.vercel.app/result/l1');
    expect(message.html).toContain('href="https://heloc-demo.vercel.app/result/l1"');
  });

  it('explains a rejection in plain words', () => {
    const message = new TemplateComposer().composeOutcome(
      notice({ status: 'rejected', reason: 'credit_below_minimum' }),
    );
    expect(message.subject).toBe('An update on your HELOC application');
    expect(message.text).toContain('below our current minimum');
    expect(message.text).not.toContain('credit_below_minimum');
  });
});
