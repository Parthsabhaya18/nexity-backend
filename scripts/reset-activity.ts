/**
 * Keeps every account, follow (followers/following), and profile picture (avatar).
 * Removes chats, secret crush, secret messages, plans, posts, reels, stories,
 * notifications, and nearby activity, without seeding any posts, reels, or stories.
 *
 * Usage: npx tsx scripts/reset-activity.ts
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { env, isMediaConfigured } from '../src/config/env';
import { Follow } from '../src/modules/follows/follow.model';
import { Media } from '../src/modules/media/media.model';
import { deleteObjects } from '../src/modules/media/media.storage';
import { Conversation } from '../src/modules/messages/conversation.model';
import { Message } from '../src/modules/messages/message.model';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  Encounter,
  NearbyBleSighting,
  NearbyBleToken,
  NearbyLocationPing,
  NearbyNotification,
  NearbyPresence,
} from '../src/modules/nearby/nearby.models';
import {
  BillingAdjustment,
  CouponRedemption,
  Payment,
  PaymentCheckout,
  PaymentWebhookEvent,
  Refund,
} from '../src/modules/payments/payment.models';
import { Comment, PostLike, PostSave } from '../src/modules/posts/post.engage.model';
import { Post } from '../src/modules/posts/post.model';
import { Reel, ReelLike, ReelSave } from '../src/modules/reels/reel.model';
import { Block } from '../src/modules/safety/block.model';
import { Mute } from '../src/modules/safety/mute.model';
import { Report } from '../src/modules/safety/report.model';
import { SearchHistory } from '../src/modules/search/searchHistory.model';
import { Crush, CrushAdmirerCount, CrushMatch } from '../src/modules/secret-crush/crush.models';
import { SecretBlock, SecretMessage, SecretThread } from '../src/modules/secret-messages/secret.models';
import {
  Story,
  StoryLike,
  StoryMessage,
  StoryPollVote,
  StoryQuestionReply,
  StoryView,
} from '../src/modules/stories/story.model';
import { SecretUsage } from '../src/modules/subscriptions/usage.model';
import { SupportTicket } from '../src/modules/support/supportTicket.model';
import { User } from '../src/modules/users/user.model';

const CLEAR = [
  Conversation,
  Message,
  Crush,
  CrushMatch,
  CrushAdmirerCount,
  SecretThread,
  SecretMessage,
  SecretBlock,
  Post,
  PostLike,
  PostSave,
  Comment,
  Reel,
  ReelLike,
  ReelSave,
  Story,
  StoryView,
  StoryPollVote,
  StoryQuestionReply,
  StoryLike,
  StoryMessage,
  Notification,
  SearchHistory,
  Block,
  Mute,
  Report,
  NearbyLocationPing,
  Encounter,
  NearbyNotification,
  NearbyBleToken,
  NearbyBleSighting,
  NearbyPresence,
  SecretUsage,
  PaymentCheckout,
  Payment,
  PaymentWebhookEvent,
  CouponRedemption,
  BillingAdjustment,
  Refund,
  SupportTicket,
];

async function main() {
  await connectDatabase();
  console.log(`Connected to database "${env.MONGODB_DB_NAME}".`);

  const users = await User.find({ status: 'active' }).select('_id username followers_count following_count');
  console.log(`Active accounts kept: ${users.length}. Follows kept: ${await Follow.countDocuments()}.`);

  for (const model of CLEAR) {
    const result = await (model as any).deleteMany({});
    console.log(`Cleared ${model.collection.name}: ${result.deletedCount}`);
  }

  const oldMedia = await Media.find({ purpose: { $ne: 'avatar' } }).select('key').lean();
  if (oldMedia.length) {
    if (isMediaConfigured && env.S3_BUCKET) {
      await deleteObjects(oldMedia.map((row) => row.key)).catch((err) => {
        console.warn('Could not delete old media files from storage:', (err as Error).message);
      });
    }
    const removed = await Media.deleteMany({ purpose: { $ne: 'avatar' } });
    console.log(`Cleared non-avatar media: ${removed.deletedCount}`);
  }

  const now = new Date();
  await User.updateMany(
    {},
    {
      $set: {
        posts_count: 0,
        entitlement: {
          plan: 'free',
          expires_at: null,
          source: null,
          updated_at: now,
          period: null,
          autopay: false,
          razorpay_subscription_id: null,
          price_paise: null,
          paid_paise: null,
          period_started_at: null,
          next_charge_at: null,
          cancel_at_period_end: false,
          billing_status: null,
          method_display: null,
          reminded: null,
          credit_hold: null,
          billing_generation: 0,
        },
      },
    },
  );
  console.log('Plans reset to Free and posts_count set to 0 for all users.');

  // Ensure followers_count and following_count reflect actual Follow records
  for (const user of users) {
    const [followersCount, followingCount] = await Promise.all([
      Follow.countDocuments({ following_id: user._id }),
      Follow.countDocuments({ follower_id: user._id }),
    ]);
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          followers_count: followersCount,
          following_count: followingCount,
        },
      },
    );
  }
  console.log('Follower and following counts verified and updated.');

  console.log(
    'Done. Accounts, followers, following, and profile pictures are preserved. No posts, reels, or stories were added.',
  );
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
