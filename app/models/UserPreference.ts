import mongoose, { Schema, type Model } from 'mongoose';

export interface UserPreferenceDoc {
  userId: string;
  autoPlayEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserPreferenceSchema = new Schema<UserPreferenceDoc>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    autoPlayEnabled: { type: Boolean, required: true, default: true },
  },
  {
    collection: 'user_preferences',
    timestamps: true,
    versionKey: false,
  }
);

export const UserPreference: Model<UserPreferenceDoc> =
  (mongoose.models.UserPreference as Model<UserPreferenceDoc>) ||
  mongoose.model<UserPreferenceDoc>('UserPreference', UserPreferenceSchema);

