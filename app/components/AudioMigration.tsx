'use client';

import React, { useState, useEffect } from 'react';
import { migrateAudioToDatabase, getMigrationStats, MigrationProgress } from '../utils/audioMigration';

export const AudioMigration: React.FC = () => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    total: number;
    matched: number;
    saved: number;
    errors: number;
    errorDetails: string[];
  } | null>(null);
  const [stats, setStats] = useState<{
    cachedAudioCount: number;
    journalEntriesCount: number;
    entriesWithAudio: number;
    entriesNeedingMigration: number;
  } | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoadingStats(true);
      const migrationStats = await getMigrationStats();
      setStats(migrationStats);
    } catch (error) {
      console.error('Failed to load migration stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  const handleMigrate = async () => {
    if (isMigrating) return;

    setIsMigrating(true);
    setProgress(null);
    setResult(null);

    try {
      const migrationResult = await migrateAudioToDatabase((progress) => {
        setProgress(progress);
      });

      setResult(migrationResult);
      
      // Reload stats after migration
      await loadStats();
    } catch (error: any) {
      console.error('Migration error:', error);
      setResult({
        success: false,
        total: 0,
        matched: 0,
        saved: 0,
        errors: 1,
        errorDetails: [error?.message || 'Migration failed'],
      });
    } finally {
      setIsMigrating(false);
    }
  };

  if (loadingStats) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-sm border border-stone-200">
        <p className="text-stone-600">Loading migration statistics...</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-sm border border-stone-200 max-w-2xl">
      <h2 className="text-2xl font-semibold text-stone-800 mb-4">Audio Migration</h2>
      <p className="text-stone-600 mb-6">
        Migrate existing audio files from local IndexedDB cache to the database for cross-device access.
      </p>

      {stats && (
        <div className="mb-6 p-4 bg-stone-50 rounded-lg">
          <h3 className="font-semibold text-stone-700 mb-3">Statistics</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-stone-600">Cached audio files:</span>
              <span className="font-medium">{stats.cachedAudioCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600">Journal entries:</span>
              <span className="font-medium">{stats.journalEntriesCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600">Entries with audio:</span>
              <span className="font-medium text-emerald-600">{stats.entriesWithAudio}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600">Needing migration:</span>
              <span className="font-medium text-amber-600">{stats.entriesNeedingMigration}</span>
            </div>
          </div>
        </div>
      )}

      {progress && (
        <div className="mb-6 p-4 bg-blue-50 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-blue-700">
              {progress.currentEntry || 'Processing...'}
            </span>
            <span className="text-sm text-blue-600">
              {progress.processed} / {progress.total}
            </span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progress.processed / progress.total) * 100}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-blue-600 space-y-1">
            <div>Matched: {progress.matched}</div>
            <div>Saved: {progress.saved}</div>
            {progress.errors > 0 && <div className="text-red-600">Errors: {progress.errors}</div>}
          </div>
        </div>
      )}

      {result && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            result.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
          }`}
        >
          <h3 className={`font-semibold mb-2 ${result.success ? 'text-emerald-700' : 'text-red-700'}`}>
            {result.success ? 'Migration Complete!' : 'Migration Failed'}
          </h3>
          <div className="text-sm space-y-1">
            <div>Total audio files: {result.total}</div>
            <div>Matched entries: {result.matched}</div>
            <div className="text-emerald-600">Successfully saved: {result.saved}</div>
            {result.errors > 0 && (
              <div className="text-red-600">Errors: {result.errors}</div>
            )}
          </div>
          {result.errorDetails.length > 0 && (
            <div className="mt-3 text-xs text-red-600">
              <div className="font-medium mb-1">Error details:</div>
              <ul className="list-disc list-inside space-y-1">
                {result.errorDetails.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleMigrate}
        disabled={isMigrating || !!(stats && stats.entriesNeedingMigration === 0)}
        className={`
          w-full px-4 py-3 rounded-lg font-medium transition-all
          ${
            isMigrating || (stats && stats.entriesNeedingMigration === 0)
              ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
              : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'
          }
        `}
      >
        {isMigrating
          ? 'Migrating...'
          : stats && stats.entriesNeedingMigration === 0
          ? 'No Audio to Migrate'
          : 'Start Migration'}
      </button>

      {stats && stats.entriesNeedingMigration > 0 && !isMigrating && (
        <p className="mt-4 text-xs text-stone-500 text-center">
          This will optimize and migrate {stats.entriesNeedingMigration} audio file(s) to the database.
        </p>
      )}
    </div>
  );
};

