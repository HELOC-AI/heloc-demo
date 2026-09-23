import {
  deliveryKey,
  documentRequest,
  noticeDeliveryKey,
  replyAddressFor,
  type Chase,
  type ChaseMessage,
  type OutcomeNotice,
} from '../domain/chase.ts';

/** Port: how a Chase / Outcome Notice becomes a message (template today, LLM later). */
export interface Composer {
  compose(chase: Chase): ChaseMessage;
  composeOutcome(notice: OutcomeNotice): ChaseMessage;
}

export interface Delivery {
  messageId: string;
}

/** Port: Email Delivery. */
export interface EmailGateway {
  send(
    to: string,
    message: ChaseMessage,
    options: {
      idempotencyKey: string;
      replyTo?: string | undefined;
      requestId?: string | undefined;
    },
  ): Promise<Delivery>;
}

export interface SendChaseCommand {
  chaseId: string;
  leadId: string;
  borrower: { name: string; email: string };
  missingDocuments: { type: string; reason: string }[];
  requestId?: string | undefined;
}

export interface SentChase {
  chaseId: string;
  message: ChaseMessage;
  messageId: string;
  replyAddress: string;
}

export interface SendChaseDeps {
  composer: Composer;
  email: EmailGateway;
  /** Base Reply Address, e.g. `reply@linkerclaw.ai`. */
  replyAddress: string;
}

export function createSendChase({ composer, email, replyAddress }: SendChaseDeps) {
  return async function sendChase(command: SendChaseCommand): Promise<SentChase> {
    const chase: Chase = {
      chaseId: command.chaseId,
      leadId: command.leadId,
      borrower: command.borrower,
      requests: command.missingDocuments.map(documentRequest),
      replyAddress: replyAddressFor(replyAddress, command.chaseId),
    };
    const message = composer.compose(chase);
    const { messageId } = await email.send(chase.borrower.email, message, {
      idempotencyKey: deliveryKey(chase),
      replyTo: chase.replyAddress,
      requestId: command.requestId,
    });
    return { chaseId: chase.chaseId, message, messageId, replyAddress: chase.replyAddress };
  };
}
export type SendChase = ReturnType<typeof createSendChase>;

export interface SendOutcomeNoticeCommand extends OutcomeNotice {
  requestId?: string | undefined;
}

export interface SentNotice {
  noticeId: string;
  message: ChaseMessage;
  messageId: string;
}

export function createSendOutcomeNotice({ composer, email }: Omit<SendChaseDeps, 'replyAddress'>) {
  return async function sendOutcomeNotice({
    requestId,
    ...notice
  }: SendOutcomeNoticeCommand): Promise<SentNotice> {
    const message = composer.composeOutcome(notice);
    const { messageId } = await email.send(notice.borrower.email, message, {
      idempotencyKey: noticeDeliveryKey(notice),
      requestId,
    });
    return { noticeId: notice.noticeId, message, messageId };
  };
}
export type SendOutcomeNotice = ReturnType<typeof createSendOutcomeNotice>;
