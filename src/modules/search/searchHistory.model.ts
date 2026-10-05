import mongoose from 'mongoose';

/** One person a user opened from search. Newest `updated_at` first. */
const searchHistorySchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    target_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'search_history',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

searchHistorySchema.index({ user_id: 1, target_id: 1 }, { unique: true });
searchHistorySchema.index({ user_id: 1, updated_at: -1 });

export const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema);
