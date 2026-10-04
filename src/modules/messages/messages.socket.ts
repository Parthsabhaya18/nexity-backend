import { type ChatSocket, emitToUser } from '../../realtime/io';
import { logger } from '../../utils/logger';
import { objectIdSchema } from './messages.schema';
import { participantIdsFor } from './messages.service';

const TYPING_EVENTS = ['typing.start', 'typing.stop'] as const;
const MEMBERSHIP_TTL_MS = 60_000;

/** Typing indicators are relayed over the socket only; messages are sent through REST. */
export function registerChatHandlers(socket: ChatSocket) {
  const { userId } = socket.data;
  // Typing fires often, so membership lookups are cached per socket for a minute.
  const membership = new Map<string, { ids: string[] | null; at: number }>();

  const participants = async (conversationId: string) => {
    const cached = membership.get(conversationId);
    if (cached && Date.now() - cached.at < MEMBERSHIP_TTL_MS) return cached.ids;
    const ids = await participantIdsFor(conversationId, userId);
    membership.set(conversationId, { ids, at: Date.now() });
    return ids;
  };

  for (const event of TYPING_EVENTS) {
    socket.on(event, async (payload: unknown) => {
      const parsed = objectIdSchema.safeParse(
        (payload as { conversation_id?: unknown } | null)?.conversation_id,
      );
      if (!parsed.success) return;
      try {
        const ids = await participants(parsed.data);
        if (!ids) return;
        for (const id of ids) {
          if (id !== userId) emitToUser(id, event, { conversation_id: parsed.data, user_id: userId });
        }
      } catch (err) {
        logger.warn({ err, event }, 'Typing relay failed');
      }
    });
  }
}
