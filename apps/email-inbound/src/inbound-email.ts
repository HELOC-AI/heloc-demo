/**
 * Builds a provider-neutral Inbound Email from the raw MIME message Cloudflare hands the Worker.
 *
 * Attachment contents are only hashed here; they never leave the Worker — the Inbound Email
 * carries filename, content type, size and sha256 only.
 */
import { type InboundEmail, inboundEmailSchema } from '@heloc/contracts';
import PostalMime, { type Attachment } from 'postal-mime';
import { authenticationVerdict, countCloudflareVerdicts } from './authentication.ts';

export interface RawInboundMessage {
  /** The full raw MIME message (`message.raw`). */
  raw: ArrayBuffer | Uint8Array;
  /** Envelope recipient (`message.to`); keeps the `+subaddress`. */
  envelopeTo: string;
  receivedAt: Date;
}

export type BuildResult =
  | {
      ok: true;
      email: InboundEmail;
      /** Inline / Content-ID parts not reported as attachments. */
      skippedInline: number;
      /** Authentication-Results headers claiming mx.cloudflare.net; > 1 means forged copies. */
      cloudflareVerdicts: number;
    }
  | { ok: false; reason: string; issues: string[] };

export async function buildInboundEmail(input: RawInboundMessage): Promise<BuildResult> {
  let parsed;
  try {
    parsed = await PostalMime.parse(input.raw, { attachmentEncoding: 'arraybuffer' });
  } catch (err) {
    return { ok: false, reason: 'unparseable MIME', issues: [errorName(err)] };
  }

  const from = parsed.from?.address?.trim() || undefined;
  const realAttachments = parsed.attachments.filter(isRealAttachment);

  const candidate = {
    message_id: parsed.messageId?.trim() || `sha256:${await sha256Hex(input.raw)}`,
    received_at: input.receivedAt.toISOString(),
    from,
    to: input.envelopeTo,
    subject: parsed.subject ?? '',
    authentication: authenticationVerdict(parsed.headers, from),
    attachments: await Promise.all(realAttachments.map(describeAttachment)),
  };

  const result = inboundEmailSchema.safeParse(candidate);
  if (!result.success) {
    // Paths and codes only: messages may echo the (PII) value that failed.
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`);
    return { ok: false, reason: 'invalid Inbound Email', issues };
  }
  return {
    ok: true,
    email: result.data,
    skippedInline: parsed.attachments.length - realAttachments.length,
    cloudflareVerdicts: countCloudflareVerdicts(parsed.headers),
  };
}

/** Real attachments only: inline parts and parts with a Content-ID are embedded content. */
export function isRealAttachment(attachment: Attachment): boolean {
  return attachment.disposition !== 'inline' && !attachment.contentId;
}

async function describeAttachment(
  attachment: Attachment,
): Promise<InboundEmail['attachments'][number]> {
  const bytes = toBytes(attachment.content);
  return {
    filename: attachment.filename ?? '',
    content_type: attachment.mimeType,
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

function toBytes(content: Attachment['content']): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'Error';
}
