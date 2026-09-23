import { describe, expect, it } from 'vitest';
import type { Chase, OutcomeNotice } from '../domain/chase.ts';
import { replyMailto, TemplateComposer } from './template-composer.ts';

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
        'Just reply to this email and attach the documents — we will pick them up automatically.',
        '(Or send them to reply+c1@linkerclaw.ai.)',
        '',
        'Thanks.',
      ].join('\n'),
    );
    expect(message.html).toContain(
      '<li><strong>Proof of income</strong><br />Reason: Income requires verification.</li>',
    );
  });

  it('offers a one-click reply button addressed to the Chase Reply Address', () => {
    const { html } = new TemplateComposer().compose(chase());
    const href = replyMailto(chase());
    expect(href).toBe(
      'mailto:reply+c1@linkerclaw.ai?subject=Re%3A%20Additional%20documents%20required%20for%20your%20HELOC%20application&body=Hi%2C%0A%0APlease%20find%20my%20documents%20attached.%0A%0AThanks',
    );
    expect(html).toContain('>Reply with documents</a>');
    expect(html).toContain(`href="${href.replace(/&/g, '&#38;')}"`);
  });

  it('builds a mailto that decodes to the Reply Address and a Re: subject', () => {
    const url = new URL(replyMailto(chase()));
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('reply+c1@linkerclaw.ai');
    expect(url.searchParams.get('subject')).toBe(
      'Re: Additional documents required for your HELOC application',
    );
  });

  it('declares UTF-8 so dashes and names render correctly in every client', () => {
    expect(new TemplateComposer().compose(chase()).html).toContain('<meta charset="utf-8" />');
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
  const offer = {
    lender: 'Figure mock',
    amount: 250_000,
    aprMin: 7.5,
    aprMax: 9.5,
    termMonths: 120,
    estimatedMonthlyPayment: 2_968,
    expiresAt: new Date('2026-10-23T00:00:00Z'),
  };
  const notice = (
    outcome: OutcomeNotice['outcome'],
    basis: OutcomeNotice['basis'] = 'document_review',
  ): OutcomeNotice => ({
    noticeId: 'n1',
    leadId: 'l1',
    borrower: { name: 'John Doe', email: 'john@example.com' },
    outcome,
    basis,
    resultUrl: 'https://heloc-demo.vercel.app/result/l1',
  });
  const compose = (n: OutcomeNotice) => new TemplateComposer().composeOutcome(n);

  it('summarises the offer and links to the result page', () => {
    const message = compose(notice({ status: 'approved', offer }));
    expect(message.subject).toBe('Your HELOC offer is ready');
    expect(message.text).toContain('We have reviewed them');
    expect(message.text).toContain('- Credit line: $250,000');
    expect(message.text).toContain('- APR: 7.5% – 9.5%');
    expect(message.text).toContain('- Term: 10 years');
    expect(message.text).toContain('- Offer valid until: October 23, 2026');
    expect(message.text).toContain('View your offer: https://heloc-demo.vercel.app/result/l1');
    expect(message.html).toContain('href="https://heloc-demo.vercel.app/result/l1"');
    expect(message.html).toContain('>View your offer</a>');
  });

  it('a soft-pull offer says prequalified, not reviewed, and carries the caveat', () => {
    const message = compose(notice({ status: 'approved', offer }, 'prequalification'));
    expect(message.subject).toBe('Your HELOC offer is ready');
    expect(message.text).toContain("you're prequalified");
    expect(message.text).not.toContain('documents');
    expect(message.text).toContain('not a commitment to lend');
    expect(message.text).toContain('View your offer: https://heloc-demo.vercel.app/result/l1');
    expect(message.html).toContain('href="https://heloc-demo.vercel.app/result/l1"');
  });

  it('explains a rejection in plain words', () => {
    const message = compose(notice({ status: 'rejected', reason: 'credit_below_minimum' }));
    expect(message.subject).toBe('An update on your HELOC application');
    expect(message.text).toContain('After reviewing them');
    expect(message.text).toContain('below our current minimum');
    expect(message.text).not.toContain('credit_below_minimum');
  });

  it('a soft-pull rejection does not mention documents and links to the details', () => {
    const message = compose(
      notice({ status: 'rejected', reason: 'insufficient_home_equity' }, 'prequalification'),
    );
    expect(message.text).toContain('Thanks for checking your HELOC options');
    expect(message.text).not.toContain('documents');
    expect(message.text).toContain('Details: https://heloc-demo.vercel.app/result/l1');
  });

  it('escapes borrower-controlled text in the HTML', () => {
    const message = compose({
      ...notice({ status: 'approved', offer }, 'prequalification'),
      borrower: { name: '<b>Eve</b>', email: 'eve@example.com' },
    });
    expect(message.html).not.toContain('<b>Eve</b>');
  });
});
