/** Subject the result page suggests when the Borrower emails their documents themselves. */
export const REPLY_SUBJECT = 'Documents for my HELOC application';

/**
 * A mailto: link to a Chase reply address (`reply+<chase_id>@…`). The `+` must be
 * percent-encoded or some mail apps read it as a space.
 */
export function replyMailto(address: string, subject: string = REPLY_SUBJECT): string {
  return `mailto:${encodeURIComponent(address).replaceAll('%40', '@')}?subject=${encodeURIComponent(subject)}`;
}
