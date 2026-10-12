import { type ChatSocket, emitToUser } from '../../realtime/io';
import { logger } from '../../utils/logger';
import { objectIdSchema } from './messages.schema';
import { participantIdsFor } from './messages.service';

const TYPING_EVENTS = ['typing.start', 'typing.stop'] as const;

/** Typing indicators are relayed over the socket only; messages are sent through REST. */
export function registerChatHandlers(socket: ChatSocket) {
  const { userId } = socket.data;

  for (const event of TYPING_EVENTS) {
    socket.on(event, async (payload: unknown) => {
      const parsed = objectIdSchema.safeParse(
        (payload as { conversation_id?: unknown } | null)?.conversation_id,
      );
      if (!parsed.success) return;
      try {
        const ids = await participantIdsFor(parsed.data, userId);
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
