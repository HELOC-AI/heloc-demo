import { deliveryKey, documentRequest, type Chase, type ChaseMessage } from '../domain/chase.ts';

/** Port: how a Chase becomes a Chase Message (template today, LLM later). */
export interface Composer {
  compose(chase: Chase): ChaseMessage;
}

export interface Delivery {
  messageId: string;
}

/** Port: Email Delivery. */
export interface EmailGateway {
  send(
    to: string,
    message: ChaseMessage,
    options: { idempotencyKey: string; requestId?: string | undefined },
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
}

export function createSendChase({ composer, email }: { composer: Composer; email: EmailGateway }) {
  return async function sendChase(command: SendChaseCommand): Promise<SentChase> {
    const chase: Chase = {
      chaseId: command.chaseId,
      leadId: command.leadId,
      borrower: command.borrower,
      requests: command.missingDocuments.map(documentRequest),
    };
    const message = composer.compose(chase);
    const { messageId } = await email.send(chase.borrower.email, message, {
      idempotencyKey: deliveryKey(chase),
      requestId: command.requestId,
    });
    return { chaseId: chase.chaseId, message, messageId };
  };
}
export type SendChase = ReturnType<typeof createSendChase>;
