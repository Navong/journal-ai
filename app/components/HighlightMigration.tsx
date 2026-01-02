'use client';

import { useState, useEffect, useCallback } from 'react';

interface MigrationStats {
  total: number;
  withHighlights: number;
  needsMigration: number;
}

interface MigrationResult {
  success: boolean;
  message: string;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  remaining: number;
  errorDetails?: string[];
}

export function HighlightMigration() {
  const [stats, setStats] = useState<MigrationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    processed: number;
    updated: number;
    skipped: number;
    errors: number;
    remaining: number;
  } | null>(null);
  const [batchSize, setBatchSize] = useState(5);
  const [autoRun, setAutoRun] = useState(false);

  // Fetch migration stats
  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/history/migrate-highlights');
      if (!response.ok) {
        throw new Error('Failed to fetch migration stats');
      }
      const data = await response.json();
      setStats(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Run migration batch
  const runMigration = useCallback(async () => {
    if (migrating) return;

    try {
      setMigrating(true);
      setError(null);

      const response = await fetch('/api/history/migrate-highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize, delayMs: 1500 }),
      });

      const data: MigrationResult = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Migration failed');
      }

      setProgress({
        processed: (progress?.processed || 0) + data.processed,
        updated: (progress?.updated || 0) + data.updated,
        skipped: (progress?.skipped || 0) + data.skipped,
        errors: (progress?.errors || 0) + data.errors,
        remaining: data.remaining,
      });

      // Update stats
      await fetchStats();

      // Continue auto-run if enabled and there are more entries
      if (autoRun && data.remaining > 0) {
        // Small delay before next batch
        setTimeout(() => runMigration(), 2000);
      } else {
        setMigrating(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Migration failed');
      setMigrating(false);
      setAutoRun(false);
    }
  }, [migrating, batchSize, progress, autoRun, fetchStats]);

  // Start auto-run
  const startAutoMigration = () => {
    setAutoRun(true);
    setProgress(null);
    runMigration();
  };

  // Stop auto-run
  const stopAutoMigration = () => {
    setAutoRun(false);
  };

  // Reset progress
  const resetProgress = () => {
    setProgress(null);
    fetchStats();
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-stone-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-stone-200 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-6 space-y-6">
      {/* Stats Section */}
      <div>
        <h2 className="text-xl font-semibold text-stone-800 mb-4">Migration Status</h2>
        {stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-stone-50 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-stone-800">{stats.total}</p>
              <p className="text-sm text-stone-600">Total Entries</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-amber-600">{stats.needsMigration}</p>
              <p className="text-sm text-stone-600">Need Migration</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-emerald-600">{stats.withHighlights}</p>
              <p className="text-sm text-stone-600">With Highlights</p>
            </div>
          </div>
        )}
      </div>

      {/* Progress Section */}
      {progress && (
        <div className="border-t border-stone-200 pt-4">
          <h3 className="text-lg font-medium text-stone-700 mb-3">Migration Progress</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xl font-semibold text-blue-600">{progress.processed}</p>
              <p className="text-stone-600">Processed</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-xl font-semibold text-emerald-600">{progress.updated}</p>
              <p className="text-stone-600">Updated</p>
            </div>
            <div className="bg-stone-100 rounded-lg p-3">
              <p className="text-xl font-semibold text-stone-500">{progress.skipped}</p>
              <p className="text-stone-600">No Highlights</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-xl font-semibold text-red-600">{progress.errors}</p>
              <p className="text-stone-600">Errors</p>
            </div>
          </div>
          {progress.remaining > 0 && (
            <p className="text-sm text-stone-500 mt-2">
              {progress.remaining} entries remaining
            </p>
          )}
        </div>
      )}

      {/* Error Section */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Controls Section */}
      <div className="border-t border-stone-200 pt-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="flex items-center gap-2">
            <label htmlFor="batchSize" className="text-sm text-stone-600">
              Batch size:
            </label>
            <select
              id="batchSize"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              disabled={migrating}
              className="border border-stone-300 rounded-md px-2 py-1 text-sm"
            >
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </div>

          <div className="flex gap-2">
            {!migrating ? (
              <>
                <button
                  onClick={runMigration}
                  disabled={stats?.needsMigration === 0}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Run Single Batch
                </button>
                <button
                  onClick={startAutoMigration}
                  disabled={stats?.needsMigration === 0}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Migrate All
                </button>
              </>
            ) : (
              <button
                onClick={stopAutoMigration}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                {autoRun ? 'Stop Migration' : 'Processing...'}
              </button>
            )}
            {progress && !migrating && (
              <button
                onClick={resetProgress}
                className="px-4 py-2 border border-stone-300 text-stone-600 rounded-lg hover:bg-stone-50 transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {migrating && (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-amber-500 border-t-transparent"></div>
              <span className="text-sm text-stone-600">
                {autoRun ? 'Migrating entries... (this may take a while)' : 'Processing batch...'}
              </span>
            </div>
            <p className="text-xs text-stone-500 mt-1">
              Rate limited to avoid API overload. Each entry takes ~2 seconds.
            </p>
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="border-t border-stone-200 pt-4 text-sm text-stone-500">
        <h4 className="font-medium text-stone-700 mb-2">How it works:</h4>
        <ul className="list-disc list-inside space-y-1">
          <li>Scans your existing journal reflections for highlight-worthy phrases</li>
          <li>Identifies <span className="text-red-600 font-medium">stress indicators</span> (physical symptoms, external pressures)</li>
          <li>Identifies <span className="text-amber-600 font-medium">identity wins</span> (achievements, moments of agency)</li>
          <li>Preserves your original reflection text - only adds visual highlights</li>
          <li>Entries with no meaningful highlights are marked as processed</li>
        </ul>
      </div>
    </div>
  );
}
