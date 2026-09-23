import { LeadQuiz } from '@/components/lead-quiz';

const HIGHLIGHTS = [
  {
    title: 'No impact on your credit score',
    body: 'We use a soft credit check to prequalify you.',
  },
  {
    title: 'A decision in seconds',
    body: 'See your line amount, rate range and estimated payment right away.',
  },
  {
    title: 'Borrow what you need',
    body: 'Lines from $25,000, drawn against the equity you have built.',
  },
];

export default function Home() {
  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:gap-16 lg:py-20">
      <div className="lg:sticky lg:top-12 lg:self-start">
        <p className="text-sm font-semibold text-emerald-700">Home equity line of credit</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-slate-900 sm:text-5xl">
          Put your home equity to work
        </h1>
        <p className="mt-4 max-w-lg text-lg text-pretty text-slate-600">
          Answer a few questions to see how much you could borrow, and at what rate. It takes about
          two minutes.
        </p>
        <ul className="mt-8 hidden space-y-5 sm:block">
          {HIGHLIGHTS.map((item) => (
            <li key={item.title} className="flex gap-3.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-4">
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <div>
                <p className="font-medium text-slate-900">{item.title}</p>
                <p className="text-sm text-slate-600">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <LeadQuiz />
    </main>
  );
}
