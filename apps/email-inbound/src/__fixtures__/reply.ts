/**
 * A realistic borrower reply as Cloudflare Email Routing hands it to the Worker: Cloudflare's
 * trace headers prepended on top, then the sender's own headers — including a forged
 * `Authentication-Results` claiming mx.cloudflare.net — then a multipart body with a real PDF
 * attachment and an inline (Content-ID) image.
 */

export const BORROWER = 'Jane.Doe@Gmail.com';
export const RECIPIENT = 'reply+6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f@linkerclaw.ai';
export const MESSAGE_ID = '<CAHx9f2kQ-test-message-id@mail.gmail.com>';

export const PDF_BASE64 = 'JVBERi0xLjQKJSBmYWtlIHBheXN0dWIgZm9yIHRlc3RzCiUlRU9GCg==';
export const PDF_SIZE = 40;
export const PDF_SHA256 = 'a26d5a9d7836616d46979dc1c6e1141ebd1b91330203aa1fcda20458d00689dd';

export const cloudflareAuthResults = (dmarc: string, headerFrom = 'gmail.com') =>
  `mx.cloudflare.net; dkim=pass header.d=gmail.com header.s=20230601 header.b=AbCdEf12;\r\n` +
  `\tdmarc=${dmarc} header.from=${headerFrom} policy.dmarc=none;\r\n` +
  `\tspf=pass (mx.cloudflare.net: domain of jane.doe@gmail.com designates 209.85.128.41 as permitted sender) smtp.mailfrom=jane.doe@gmail.com`;

interface ReplyOptions {
  /** Cloudflare's own verdict (topmost header); `null` leaves the header out entirely. */
  cloudflareDmarc?: string | null;
  cloudflareHeaderFrom?: string;
  messageId?: string | null;
  from?: string;
}

export function rawReply(options: ReplyOptions = {}): string {
  const {
    cloudflareDmarc = 'pass',
    cloudflareHeaderFrom = 'gmail.com',
    messageId = MESSAGE_ID,
    from = `"Jane Doe" <${BORROWER}>`,
  } = options;
  const lines = [
    ...(cloudflareDmarc === null
      ? []
      : [
          `Authentication-Results: ${cloudflareAuthResults(cloudflareDmarc, cloudflareHeaderFrom)}`,
        ]),
    'Received-SPF: pass (mx.cloudflare.net: domain of jane.doe@gmail.com designates 209.85.128.41 as permitted sender) receiver=mx.cloudflare.net; client-ip=209.85.128.41;',
    `Received: from mail-wm1-f41.google.com (209.85.128.41) by cloudflare-email.net (cloudflare) id 9M7MLUvJNdlk for <${RECIPIENT}>; Wed, 23 Sep 2026 04:56:41 +0000`,
    'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=20230601; h=to:subject:message-id:date:from:mime-version; bh=abc=; b=AbCdEf12',
    // Forged by the sender: claims a Cloudflare pass for a domain it doesn't control.
    'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com',
    'Authentication-Results: mx.google.com; dmarc=pass header.from=gmail.com',
    'MIME-Version: 1.0',
    'Date: Wed, 23 Sep 2026 12:56:30 +0800',
    ...(messageId ? [`Message-ID: ${messageId}`] : []),
    `From: ${from}`,
    `To: ${RECIPIENT}`,
    'Subject: Re: Additional documents required for your HELOC application',
    'Content-Type: multipart/mixed; boundary="mixed-001"',
    '',
    '--mixed-001',
    'Content-Type: multipart/related; boundary="related-001"',
    '',
    '--related-001',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    '<p>Here is my paystub.</p><img src="cid:logo@local">',
    '--related-001',
    'Content-Type: image/gif; name="logo.gif"',
    'Content-Disposition: inline; filename="logo.gif"',
    'Content-ID: <logo@local>',
    'Content-Transfer-Encoding: base64',
    '',
    'R0lGODlhLWxvZ28=',
    '--related-001--',
    '',
    '--mixed-001',
    'Content-Type: application/pdf; name="paystub-2026-08.pdf"',
    'Content-Disposition: attachment; filename="paystub-2026-08.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    PDF_BASE64,
    '--mixed-001--',
    '',
  ];
  return lines.join('\r\n');
}

export const encode = (raw: string) => new TextEncoder().encode(raw);
