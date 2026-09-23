/**
 * Supabase Postgres schema for Lead Intake. Tables mirror the Lead aggregate
 * (docs/DEV-PLAN.md §3); the database also enforces the aggregate's invariants:
 * one decision per Lead and one Chase per Lead (ADR-0003).
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
  'failed',
]);

export const chaseStatus = pgEnum('chase_status', ['pending', 'sent', 'failed']);

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
    /** Outcome in Lead Intake's language: approved | rejected | need_more_documents. */
    status: text('status').notNull(),
    /** The decision as the domain sees it (Offer, reason or Missing Documents). */
    decision: jsonb('decision').notNull(),
    /** Figure's verbatim response, for audit. */
    rawResponse: jsonb('raw_response'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('figure_decisions_lead_id_key').on(t.leadId)],
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
    lastError: text('last_error'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('chases_lead_id_key').on(t.leadId)],
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
