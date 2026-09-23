/**
 * Authentication Verdict: the receiving mail server's own DMARC result for an Inbound Email.
 *
 * Security model. Cloudflare Email Routing (our MX) evaluates SPF/DKIM/DMARC and prepends an
 * `Authentication-Results: mx.cloudflare.net; ...` header above everything the sender sent.
 * A sender can put any header in its message — including forged `Authentication-Results`
 * claiming `mx.cloudflare.net` — but those always sit *below* Cloudflare's. So we trust only
 * the FIRST (topmost) instance carrying that authserv-id, scanning the header list in document
 * order. (`Headers.get()` would merge every instance into one comma-joined string, so it must
 * not be used here.)
 *
 * Because DMARC's `header.from` is the domain Cloudflare actually evaluated, we also require it
 * to equal the domain of the From address we report; otherwise the verdict is `fail`. A message
 * with more than one From header is ambiguous (which one did DMARC look at?) and is also `fail`.
 *
 * Pure: no I/O, no Workers APIs.
 */

export type DmarcResult = 'pass' | 'fail' | 'none' | 'unknown';

export interface AuthenticationVerdict {
  dmarc: DmarcResult;
  /** The raw verdict (Cloudflare's header value), for audit. */
  detail: string;
}

/** A header field in document order, as produced by a MIME parser. */
export interface HeaderField {
  key: string;
  value: string;
}

export const CLOUDFLARE_AUTHSERV_ID = 'mx.cloudflare.net';
export const DETAIL_MAX_LENGTH = 500;

export function authenticationVerdict(
  headers: readonly HeaderField[],
  fromAddress: string | undefined,
): AuthenticationVerdict {
  const header = headers.find(isCloudflareVerdict);
  if (!header) {
    return { dmarc: 'unknown', detail: `no Authentication-Results from ${CLOUDFLARE_AUTHSERV_ID}` };
  }

  const raw = header.value.replace(/\s+/g, ' ').trim();
  const dmarc = parseResults(raw).find((r) => r.method === 'dmarc');
  const result = toDmarcResult(dmarc?.result);
  if (!dmarc || result === 'unknown') return { dmarc: 'unknown', detail: truncate(raw) };

  const fromCount = headers.filter((h) => h.key.toLowerCase() === 'from').length;
  if (fromCount > 1) return { dmarc: 'fail', detail: truncate(`multiple From headers; ${raw}`) };

  const fromDomain = domainOf(fromAddress);
  const headerFrom = dmarc.props.get('header.from');
  if (!fromDomain || !headerFrom || normalizeDomain(headerFrom) !== fromDomain) {
    return { dmarc: 'fail', detail: truncate(`header.from does not match From; ${raw}`) };
  }
  return { dmarc: result, detail: truncate(raw) };
}

/** How many headers claim to be Cloudflare's verdict; more than one means forged copies. */
export function countCloudflareVerdicts(headers: readonly HeaderField[]): number {
  return headers.filter(isCloudflareVerdict).length;
}

function isCloudflareVerdict(header: HeaderField): boolean {
  return (
    header.key.toLowerCase() === 'authentication-results' &&
    authservId(header.value) === CLOUDFLARE_AUTHSERV_ID
  );
}

function toDmarcResult(result: string | undefined): DmarcResult {
  return result === 'pass' || result === 'fail' || result === 'none' ? result : 'unknown';
}

function truncate(value: string): string {
  return value.length > DETAIL_MAX_LENGTH ? `${value.slice(0, DETAIL_MAX_LENGTH - 1)}…` : value;
}

/** Lowercased domain of an address, without a trailing dot. */
export function domainOf(address: string | undefined): string | undefined {
  const at = address?.lastIndexOf('@') ?? -1;
  if (!address || at < 0) return undefined;
  const domain = normalizeDomain(address.slice(at + 1));
  return domain || undefined;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '');
}

// --- RFC 8601 Authentication-Results parsing -------------------------------------------------

interface ResInfo {
  method: string;
  result: string;
  /** Property values keyed by lowercased `ptype.property` (first occurrence wins). */
  props: Map<string, string>;
}

/** The authserv-id (first token, lowercased) of an Authentication-Results value. */
export function authservId(value: string): string {
  const first = splitOutsideQuotes(stripComments(value), ';')[0] ?? '';
  return (first.trim().split(/\s+/)[0] ?? '').toLowerCase();
}

/** Every `method=result prop=value ...` statement after the authserv-id. */
export function parseResults(value: string): ResInfo[] {
  const [, ...statements] = splitOutsideQuotes(stripComments(value), ';');
  const results: ResInfo[] = [];
  for (const statement of statements) {
    const tokens = tokenize(statement.replace(/\s*=\s*/g, '='));
    const [head, ...rest] = tokens;
    const eq = head?.indexOf('=') ?? -1;
    if (!head || eq <= 0) continue; // e.g. "none" (no results)
    const method = (head.slice(0, eq).split('/')[0] ?? '').toLowerCase();
    const result = unquote(head.slice(eq + 1)).toLowerCase();
    const props = new Map<string, string>();
    for (const token of rest) {
      const i = token.indexOf('=');
      if (i <= 0) continue;
      const key = token.slice(0, i).toLowerCase();
      if (!props.has(key)) props.set(key, unquote(token.slice(i + 1)));
    }
    results.push({ method, result, props });
  }
  return results;
}

/** Removes RFC 5322 comments `( ... )` (nestable, `\` escapes), leaving quoted strings intact. */
function stripComments(value: string): string {
  let out = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '\\') {
      if (depth === 0) out += c + (value[i + 1] ?? '');
      i++;
    } else if (quoted) {
      out += c;
      if (c === '"') quoted = false;
    } else if (c === '(') {
      depth++;
    } else if (c === ')' && depth > 0) {
      depth--;
    } else if (depth === 0) {
      if (c === '"') quoted = true;
      out += c;
    }
  }
  return out;
}

function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '\\' && quoted) {
      current += c + (value[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === separator && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

function tokenize(statement: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < statement.length; i++) {
    const c = statement[i]!;
    if (c === '\\' && quoted) {
      current += c + (statement[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (/\s/.test(c) && !quoted) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replace(/\\(.)/g, '$1')
    : value;
}
