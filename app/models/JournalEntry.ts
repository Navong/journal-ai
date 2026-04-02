import mongoose, { Schema, type Model } from 'mongoose';

export interface JournalEntryDoc {
  _id: string; // UUID string from client
  userId: string;
  entryText: string;
  reflectionText: string;
  reflectionAudioUrl?: string | null;
  summary?: string | null;
  topic?: string | null;
  mood?: string | null;
  entities?: unknown;
  highlights?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const JournalEntrySchema = new Schema<JournalEntryDoc>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    entryText: { type: String, required: true },
    reflectionText: { type: String, required: true },
    reflectionAudioUrl: { type: String, default: null },
    summary: { type: String, default: null },
    topic: { type: String, default: null },
    mood: { type: String, default: null },
    entities: { type: Schema.Types.Mixed, default: null },
    highlights: { type: Schema.Types.Mixed, default: null },
    // createdAt/updatedAt are handled by timestamps
  },
  {
    collection: 'journal_entries',
    timestamps: true,
    versionKey: false,
  }
);

JournalEntrySchema.index({ userId: 1, createdAt: -1 });

export const JournalEntry: Model<JournalEntryDoc> =
  (mongoose.models.JournalEntry as Model<JournalEntryDoc>) ||
  mongoose.model<JournalEntryDoc>('JournalEntry', JournalEntrySchema);

