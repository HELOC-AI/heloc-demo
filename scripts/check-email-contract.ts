/**
 * Fails when heloc-email-service's published Send API contract differs from the copy chase
 * is built and tested against (packages/contracts/src/email-service.send-api.json).
 * Runs in CI and in the scheduled smoke workflow, so drift on either side is caught.
 *
 *   node scripts/check-email-contract.ts
 *
 * On drift: copy the provider's contract/send-api.json over the pinned file, then make
 * packages/contracts' Send API schemas match (their test compares them with the pinned copy).
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const UPSTREAM =
  'https://raw.githubusercontent.com/HELOC-AI/heloc-email-service/main/contract/send-api.json';
const pinnedPath = new URL(
  '../packages/contracts/src/email-service.send-api.json',
  import.meta.url,
);

const response = await fetch(UPSTREAM, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) {
  console.error(`✗ could not fetch ${UPSTREAM}: HTTP ${response.status}`);
  process.exit(1);
}
const upstream: unknown = await response.json();
const pinned: unknown = JSON.parse(readFileSync(pinnedPath, 'utf8'));

if (isDeepStrictEqual(upstream, pinned)) {
  console.log('✓ Send API contract: pinned copy matches heloc-email-service@main');
} else {
  console.error('✗ Send API contract drift: heloc-email-service@main differs from the pinned copy');
  for (const path of differences(pinned, upstream)) console.error(`  - ${path}`);
  console.error(
    `Update ${pinnedPath.pathname.split('/HELOC-AI/').pop()} and the consumer schemas.`,
  );
  process.exit(1);
}

function differences(a: unknown, b: unknown, path = '$'): string[] {
  if (isDeepStrictEqual(a, b)) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((key) =>
    differences(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}.${key}`,
    ),
  );
}
