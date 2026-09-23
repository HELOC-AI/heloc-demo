import type { Metadata } from 'next';
import { LeadResultView } from '@/components/result/lead-result-view';

export const metadata: Metadata = {
  title: 'Your HELOC options',
  robots: { index: false },
};

export default async function ResultPage({ params }: PageProps<'/result/[leadId]'>) {
  const { leadId } = await params;
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <LeadResultView key={leadId} leadId={leadId} />
    </main>
  );
}
