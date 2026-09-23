'use client';

import { useEffect, useState } from 'react';

/** Copies `value` to the clipboard and says so for a couple of seconds. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  /** What is being copied, for screen readers ("application ID"). */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the value stays selectable.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={
          className ??
          'rounded-md px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/20'
        }
        aria-label={copied ? `${capitalize(label)} copied` : `Copy ${label}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
