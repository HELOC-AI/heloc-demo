'use client';

import {
  CREDIT_BANDS,
  INCOME_BANDS,
  MOCK_OUTCOMES,
  PURPOSES,
  US_STATES,
  type MockOutcome,
} from '@heloc/contracts';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Field, MoneyInput, SelectInput, Spinner, TextInput } from '@/components/form-controls';
import { leadApi } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { createSubmissionKeys } from '@/lib/submission-key';
import {
  CREDIT_BAND_LABELS,
  INCOME_BAND_LABELS,
  MOCK_OUTCOME_LABELS,
  PURPOSE_LABELS,
  STATE_NAMES,
} from '@/lib/labels';
import {
  EMPTY_DRAFT,
  LEAD_FIELDS,
  validateField,
  validateLead,
  type FieldErrors,
  type LeadDraft,
  type LeadField,
} from '@/lib/lead-form';
import {
  availableEquity,
  equityHint,
  formatMoneyInput,
  parseMoney,
  sanitizeMoneyInput,
} from '@/lib/money';

const STATE_OPTIONS = US_STATES.map((code) => ({ value: code, label: STATE_NAMES[code] }));
const CREDIT_OPTIONS = [...CREDIT_BANDS]
  .reverse()
  .map((band) => ({ value: band, label: CREDIT_BAND_LABELS[band] }));
const INCOME_OPTIONS = INCOME_BANDS.map((band) => ({
  value: band,
  label: INCOME_BAND_LABELS[band],
}));
const PURPOSE_OPTIONS = PURPOSES.map((purpose) => ({
  value: purpose,
  label: PURPOSE_LABELS[purpose],
}));
const OUTCOME_OPTIONS = [
  { value: '', label: 'Use underwriting rules' },
  ...MOCK_OUTCOMES.map((outcome) => ({ value: outcome, label: MOCK_OUTCOME_LABELS[outcome] })),
];

const MONEY_FIELDS: ReadonlySet<LeadField> = new Set(['estimated_home_value', 'mortgage_balance']);

/** The HELOC quiz: collects a Lead, validates it with the contract, and submits it to intake. */
export function LeadQuiz() {
  const router = useRouter();
  const [draft, setDraft] = useState<LeadDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [mockOutcome, setMockOutcome] = useState<MockOutcome | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [keyFor] = useState(() => createSubmissionKeys());

  const update =
    (field: LeadField) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = MONEY_FIELDS.has(field)
        ? sanitizeMoneyInput(event.target.value)
        : event.target.value;
      const next = { ...draft, [field]: value };
      setDraft(next);
      // Once the Borrower has tried to submit, keep errors in step with what they type;
      // before that, only clear an error they are fixing.
      if (attempted || errors[field]) {
        setErrors((current) => ({ ...current, [field]: validateField(next, field) }));
      }
    };

  const blur = (field: LeadField) => () => {
    const value = MONEY_FIELDS.has(field) ? formatMoneyInput(draft[field]) : draft[field];
    const next = { ...draft, [field]: value };
    if (value !== draft[field]) setDraft(next);
    if (value.trim() !== '' || attempted) {
      setErrors((current) => ({ ...current, [field]: validateField(next, field) }));
    }
  };

  const bind = (field: LeadField) => ({
    id: field,
    name: field,
    value: draft[field],
    onChange: update(field),
    onBlur: blur(field),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    setFormError(undefined);

    const validation = validateLead(draft);
    if (!validation.ok) {
      setErrors(validation.errors);
      focusFirstInvalid(validation.errors);
      return;
    }

    setSubmitting(true);
    const result = await leadApi.submitLead(validation.input, {
      mockOutcome: mockOutcome || undefined,
      idempotencyKey: keyFor({ input: validation.input, mockOutcome }),
    });
    switch (result.kind) {
      case 'lead':
        // Stay in the submitting state while the result page loads.
        router.push(`/result/${result.lead.lead_id}`);
        return;
      case 'invalid':
        // Re-enable the fieldset before moving focus: disabled controls cannot take focus.
        flushSync(() => {
          setSubmitting(false);
          setErrors(result.errors);
          setFormError(
            result.messages[0] ??
              (Object.keys(result.errors).length === 0 ? 'Please check your answers.' : undefined),
          );
        });
        focusFirstInvalid(result.errors);
        return;
      case 'in_progress':
        setFormError(
          'There is already an application in progress for this email address. Please check your inbox for our email about it — it explains the next step.',
        );
        break;
      case 'error':
        setFormError(result.message);
        break;
      default:
        setFormError('Something went wrong. Please try again.');
    }
    setSubmitting(false);
  }

  const equity = availableEquity(
    parseMoney(draft.estimated_home_value),
    parseMoney(draft.mortgage_balance),
  );

  return (
    <div>
      <form
        noValidate
        onSubmit={submit}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        aria-describedby={formError ? 'form-error' : undefined}
      >
        <fieldset disabled={submitting} className="space-y-8">
          <Section title="About you" step={1}>
            <Field id="name" label="Full name" error={errors.name} className="sm:col-span-2">
              {(aria) => (
                <TextInput {...bind('name')} {...aria} autoComplete="name" placeholder="Jane Doe" />
              )}
            </Field>
            <Field id="email" label="Email" error={errors.email}>
              {(aria) => (
                <TextInput
                  {...bind('email')}
                  {...aria}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="jane@example.com"
                />
              )}
            </Field>
            <Field id="phone" label="Phone" error={errors.phone}>
              {(aria) => (
                <TextInput
                  {...bind('phone')}
                  {...aria}
                  type="tel"
                  autoComplete="tel"
                  placeholder="(415) 555-1234"
                />
              )}
            </Field>
          </Section>

          <Section title="Your home" step={2}>
            <Field
              id="property_state"
              label="State"
              error={errors.property_state}
              className="sm:col-span-2"
            >
              {(aria) => (
                <SelectInput
                  {...bind('property_state')}
                  {...aria}
                  required
                  autoComplete="address-level1"
                  placeholder="Select a state"
                  options={STATE_OPTIONS}
                />
              )}
            </Field>
            <Field
              id="estimated_home_value"
              label="Estimated home value"
              error={errors.estimated_home_value}
            >
              {(aria) => (
                <MoneyInput {...bind('estimated_home_value')} {...aria} placeholder="800,000" />
              )}
            </Field>
            <Field
              id="mortgage_balance"
              label="Mortgage balance"
              error={errors.mortgage_balance}
              hint={
                errors.mortgage_balance || equity !== undefined
                  ? undefined
                  : 'Enter 0 if your home is paid off.'
              }
            >
              {(aria) => (
                <MoneyInput {...bind('mortgage_balance')} {...aria} placeholder="350,000" />
              )}
            </Field>
            {equity !== undefined && <EquityHint equity={equity} />}
          </Section>

          <Section title="Your finances" step={3}>
            <Field id="credit_band" label="Credit score range" error={errors.credit_band}>
              {(aria) => (
                <SelectInput
                  {...bind('credit_band')}
                  {...aria}
                  required
                  placeholder="Select a range"
                  options={CREDIT_OPTIONS}
                />
              )}
            </Field>
            <Field id="income_band" label="Annual household income" error={errors.income_band}>
              {(aria) => (
                <SelectInput
                  {...bind('income_band')}
                  {...aria}
                  required
                  placeholder="Select a range"
                  options={INCOME_OPTIONS}
                />
              )}
            </Field>
            <Field
              id="purpose"
              label="What will you use the funds for?"
              error={errors.purpose}
              className="sm:col-span-2"
            >
              {(aria) => (
                <SelectInput
                  {...bind('purpose')}
                  {...aria}
                  required
                  placeholder="Select a purpose"
                  options={PURPOSE_OPTIONS}
                />
              )}
            </Field>
          </Section>

          <div className="space-y-4 border-t border-slate-100 pt-6">
            {formError && (
              <p
                id="form-error"
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {formError}
              </p>
            )}
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/30 disabled:cursor-wait disabled:bg-emerald-700/80"
            >
              {submitting && <Spinner className="size-5" />}
              {submitting ? 'Checking your options…' : 'Check my options'}
            </button>
            <p role="status" aria-live="polite" className="text-center text-xs text-slate-500">
              {submitting
                ? 'This usually takes a few seconds. Please keep this page open.'
                : "Checking your options won't affect your credit score."}
            </p>
          </div>
        </fieldset>
      </form>

      <DemoOutcome value={mockOutcome} onChange={setMockOutcome} disabled={submitting} />
    </div>
  );
}

function focusFirstInvalid(errors: FieldErrors) {
  const first = LEAD_FIELDS.find((field) => errors[field]);
  if (first) document.getElementById(first)?.focus();
}

function Section({ title, step, children }: { title: string; step: number; children: ReactNode }) {
  return (
    <section aria-labelledby={`section-${step}`}>
      <h2
        id={`section-${step}`}
        className="mb-4 flex items-center gap-2.5 text-sm font-semibold text-slate-900"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {step}
        </span>
        {title}
      </h2>
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function EquityHint({ equity }: { equity: number }) {
  const { enough, message } = equityHint(equity);
  return (
    <div
      aria-live="polite"
      className={`rounded-lg px-4 py-3 text-sm sm:col-span-2 ${
        enough ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span>Estimated available equity</span>
        <span className="font-semibold tabular-nums">{formatUsd(Math.max(0, equity))}</span>
      </div>
      <p className={`mt-1 text-xs ${enough ? 'text-emerald-800/80' : 'text-amber-800'}`}>
        {message}
      </p>
    </div>
  );
}

function DemoOutcome({
  value,
  onChange,
  disabled,
}: {
  value: MockOutcome | '';
  onChange: (value: MockOutcome | '') => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-slate-300 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <label htmlFor="mock-outcome" className="text-sm font-medium text-slate-700">
            Demo outcome
          </label>
          <p id="mock-outcome-hint" className="text-xs text-slate-500">
            For demos only: forces the prequalification decision.
          </p>
        </div>
        <div className="sm:w-60">
          <SelectInput
            id="mock-outcome"
            aria-describedby="mock-outcome-hint"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value as MockOutcome | '')}
            options={OUTCOME_OPTIONS}
            className="py-2 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
