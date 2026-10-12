import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

export const SUPPORT_SUBJECTS = [
  'Account',
  'Privacy & safety',
  'Posts, reels & stories',
  'Messages',
  'Report a bug',
  'Other',
] as const;

export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 1000;

const supportTicketSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, enum: SUPPORT_SUBJECTS, required: true },
    message: { type: String, required: true, maxlength: SUPPORT_MESSAGE_MAX },
    screenshots: {
      type: [
        {
          _id: false,
          media_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true },
          key: { type: String, required: true },
        },
      ],
      default: [],
    },
    status: { type: String, enum: ['pending', 'resolved'], default: 'pending' },
    /** Device info so support can reproduce bugs. */
    platform: { type: String, default: null },
    app_version: { type: String, default: null },
  },
  {
    collection: 'support_tickets',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

supportTicketSchema.index({ user_id: 1, _id: -1 });
supportTicketSchema.index({ status: 1, _id: -1 });

export type SupportTicketDoc = HydratedDocument<InferSchemaType<typeof supportTicketSchema>>;
export const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
