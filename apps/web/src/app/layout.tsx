import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Check your HELOC options | HELOC AI',
    template: '%s | HELOC AI',
  },
  description:
    'See how much of your home equity you could access with a HELOC. Get a prequalified offer in seconds, with no impact on your credit score.',
};

export const viewport: Viewport = {
  themeColor: '#f8fafc',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-md font-semibold tracking-tight text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/20"
            >
              <Logo />
              <span>
                HELOC<span className="text-emerald-700"> AI</span>
              </span>
            </Link>
            <p className="hidden items-center gap-2 text-sm text-slate-500 sm:flex">
              <LockIcon />
              Soft credit check · No impact on your score
            </p>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-slate-200/80">
          <div className="mx-auto max-w-6xl px-5 py-8 text-xs leading-relaxed text-slate-500 sm:px-8">
            <p>
              This is a demonstration. Offers are illustrative, come from a simulated lender, and
              are not a commitment to lend. Prequalification uses a soft credit inquiry, which does
              not affect your credit score.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="size-8">
      <rect width="32" height="32" rx="8" className="fill-emerald-700" />
      <path
        d="M9 15.5 16 9.5l7 6V23a1 1 0 0 1-1 1h-4v-5h-4v5h-4a1 1 0 0 1-1-1v-7.5Z"
        className="fill-white"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-4 text-emerald-700">
      <path
        fillRule="evenodd"
        d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
