/**
 * Supabase Postgres schema for Lead Intake. Tables mirror the Lead aggregate
 * (docs/DEV-PLAN.md §3); the database also enforces the aggregate's invariants:
 * one soft-pull decision and one document review per Lead, one Chase and one
 * Outcome Notice per Lead (ADR-0003, ADR-0004).
 *
 * RLS is enabled with no policies, so Supabase's public Data API cannot read
 * borrower PII; the service connects as the table owner and is unaffected.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const leadStatus = pgEnum('lead_status', [
  'submitted',
  'processing',
  'approved',
  'rejected',
  'need_more_documents',
  'chase_sent',
  'documents_received',
  'failed',
]);

export const chaseStatus = pgEnum('chase_status', ['pending', 'sent', 'failed']);
export const noticeStatus = pgEnum('notice_status', ['pending', 'sent', 'failed']);

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  propertyState: text('property_state').notNull(),
  estimatedHomeValue: money('estimated_home_value').notNull(),
  mortgageBalance: money('mortgage_balance').notNull(),
  creditBand: text('credit_band').notNull(),
  incomeBand: text('income_band').notNull(),
  purpose: text('purpose').notNull(),
  status: leadStatus('status').notNull(),
  version: integer('version').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const figureDecisions = pgTable(
  'figure_decisions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** `soft_pull` (the Prequal Decision) or `document_review` (ADR-0004). */
    kind: text('kind').notNull().default('soft_pull'),
    /** Outcome in Lead Intake's language: approved | rejected | need_more_documents. */
    status: text('status').notNull(),
    /** The decision as the domain sees it (Offer, reason or Missing Documents). */
    decision: jsonb('decision').notNull(),
    /** Figure's verbatim response, for audit. */
    rawResponse: jsonb('raw_response'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('figure_decisions_lead_id_kind_key').on(t.leadId, t.kind)],
).enableRLS();

export const chases = pgTable(
  'chases',
  {
    id: uuid('id').primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    status: chaseStatus('status').notNull(),
    subject: text('subject'),
    body: text('body'),
    emailMessageId: text('email_message_id'),
    /** The Reply Address the borrower answers with documents. */
    replyTo: text('reply_to'),
    lastError: text('last_error'),
    /** The accepted Chase Reply: metadata only, never attachment contents. */
    reply: jsonb('reply'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('chases_lead_id_key').on(t.leadId)],
).enableRLS();

export const outcomeNotices = pgTable(
  'outcome_notices',
  {
    id: uuid('id').primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    status: noticeStatus('status').notNull(),
    subject: text('subject'),
    body: text('body'),
    emailMessageId: text('email_message_id'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('outcome_notices_lead_id_key').on(t.leadId)],
).enableRLS();

export const leadEvents = pgTable(
  'lead_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Insertion order; events saved together share created_at, so order by this. */
    sequence: bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('lead_events_lead_id_sequence_idx').on(t.leadId, t.sequence)],
).enableRLS();
