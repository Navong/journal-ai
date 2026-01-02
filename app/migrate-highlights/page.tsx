'use client';

import { HighlightMigration } from '../components/HighlightMigration';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function MigrateHighlightsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-600">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-stone-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => router.push('/')}
            className="text-stone-600 hover:text-stone-800 mb-4 inline-flex items-center gap-2"
          >
            ← Back to Journal
          </button>
          <h1 className="text-3xl font-bold text-stone-800">Text Highlight Migration</h1>
          <p className="text-stone-600 mt-2">
            Add visual highlights to your existing journal reflections. This analyzes your past entries 
            and identifies key phrases to highlight for better readability.
          </p>
        </div>
        <HighlightMigration />
      </div>
    </div>
  );
}
