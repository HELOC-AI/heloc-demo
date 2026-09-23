import { chaseResponseSchema, type ChaseRequest as ChaseRequestDto } from '@heloc/contracts';
import type { ServiceClient } from '@heloc/server-kit';
import type { ChaseGateway, ChaseRequest, Clock, RequestContext } from '../../application/ports.ts';
import type { ChaseDelivery } from '../../domain/model.ts';

export class ChaseHttpGateway implements ChaseGateway {
  readonly #client: ServiceClient;
  readonly #clock: Clock;

  constructor(client: ServiceClient, clock: Clock) {
    this.#client = client;
    this.#clock = clock;
  }

  async send(request: ChaseRequest, context: RequestContext): Promise<ChaseDelivery> {
    const body: ChaseRequestDto = {
      chase_id: request.chaseId,
      lead_id: request.leadId,
      email: request.borrowerEmail,
      name: request.borrowerName,
      missing_documents: request.missingDocuments as ChaseRequestDto['missing_documents'],
    };
    const response = await this.#client.post('/v1/chases', body, {
      responseSchema: chaseResponseSchema,
      requestId: context.requestId,
    });
    return {
      subject: response.subject,
      body: response.body,
      emailMessageId: response.email_message_id,
      sentAt: this.#clock.now(),
    };
  }
}
