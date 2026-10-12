import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

/** Hides the muted person's content from the muter's feeds. The muted person is not told. */
const muteSchema = new mongoose.Schema(
  {
    muter_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    muted_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'mutes',
    timestamps: { createdAt: 'created_at', updatedAt: false } as const,
  },
);

muteSchema.index({ muter_id: 1, muted_id: 1 }, { unique: true });

export type MuteDoc = HydratedDocument<InferSchemaType<typeof muteSchema>>;
export const Mute = mongoose.model('Mute', muteSchema);
