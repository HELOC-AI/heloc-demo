import { describe, expect, it } from 'vitest';
import type { Chase } from '../domain/chase.ts';
import { TemplateComposer } from './template-composer.ts';

const chase = (overrides: Partial<Chase> = {}): Chase => ({
  chaseId: 'c1',
  leadId: 'l1',
  borrower: { name: 'John Doe', email: 'john@example.com' },
  requests: [{ label: 'Proof of income', reason: 'Income requires verification' }],
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
