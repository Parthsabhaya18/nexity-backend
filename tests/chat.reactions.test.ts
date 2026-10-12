import { describe, expect, it } from 'vitest';

import { Conversation } from '../src/modules/messages/conversation.model';
import { EDIT_WINDOW_MS, Message } from '../src/modules/messages/message.model';
import {
  api,
  connected,
  nextEvent,
  openChat,
  person,
  send,
  socketFor,
  useChatHarness,
} from './chatHarness';

useChatHarness();

async function pair() {
  const riya = await person('riya.writes');
  const arjun = await person('arjun.k');
  const id = await openChat(riya, arjun);
  return { riya, arjun, id };
}

const reactionUrl = (id: string, messageId: string) =>
  `/conversations/${id}/messages/${messageId}/reaction`;

describe('reactions', () => {
  it('adds, replaces and removes my reaction; one reaction per person', async () => {
    const { riya, arjun, id } = await pair();
    const msg = await send(riya, id, 'Hello, how are you?');

    const first = await api(arjun).put(reactionUrl(id, msg.body.id), { emoji: '😂' });
    expect(first.status).toBe(200);
    expect(first.body.reactions).toEqual([{ emoji: '😂', user_ids: [arjun.id], count: 1 }]);

    const replaced = await api(arjun).put(reactionUrl(id, msg.body.id), { emoji: '❤️' });
    expect(replaced.body.reactions).toEqual([{ emoji: '❤️', user_ids: [arjun.id], count: 1 }]);

    const removed = await api(arjun).delete(reactionUrl(id, msg.body.id));
    expect(removed.body.reactions).toEqual([]);
    // Removing twice is harmless.
    expect((await api(arjun).delete(reactionUrl(id, msg.body.id))).status).toBe(200);
  });

  it('groups reactions from several people and returns them with the messages', async () => {
    const { riya, arjun, id } = await pair();
    const msg = await send(riya, id, 'party?');
    await api(arjun).put(reactionUrl(id, msg.body.id), { emoji: '😂' });
    await api(riya).put(reactionUrl(id, msg.body.id), { emoji: '😂' });

    const page = await api(arjun).get(`/conversations/${id}/messages`);
    expect(page.body.data[0].reactions).toEqual([
      { emoji: '😂', user_ids: [arjun.id, riya.id], count: 2 },
    ]);

    await api(riya).put(reactionUrl(id, msg.body.id), { emoji: '👍' });
    const again = await api(arjun).get(`/conversations/${id}/messages`);
    expect(again.body.data[0].reactions).toEqual([
      { emoji: '😂', user_ids: [arjun.id], count: 1 },
      { emoji: '👍', user_ids: [riya.id], count: 1 },
    ]);
  });

  it('accepts any emoji (flags, skin tones, ZWJ sequences) and rejects text', async () => {
    const { riya, arjun, id } = await pair();
    const msg = await send(riya, id, 'hi');
    for (const emoji of ['🔥', '🇮🇳', '👍🏽', '👨‍👩‍👧', '❤️‍🔥']) {
      const res = await api(arjun).put(reactionUrl(id, msg.body.id), { emoji });
      expect(res.status, emoji).toBe(200);
    }
    for (const emoji of ['', 'lol', 'a'.repeat(40), 123, undefined]) {
      const res = await api(arjun).put(reactionUrl(id, msg.body.id), { emoji });
      expect(res.status, String(emoji)).toBe(400);
    }
  });

  it('rejects outsiders, unknown and unsent messages', async () => {
    const { riya, id } = await pair();
    const eve = await person('eve.snoops');
    const msg = await send(riya, id, 'secret');
    expect((await api(eve).put(reactionUrl(id, msg.body.id), { emoji: '😂' })).status).toBe(404);
    expect(
      (await api(riya).put(reactionUrl(id, '0'.repeat(24)), { emoji: '😂' })).status,
    ).toBe(404);

    await api(riya).delete(`/conversations/${id}/messages/${msg.body.id}`);
    expect((await api(riya).put(reactionUrl(id, msg.body.id), { emoji: '😂' })).status).toBe(404);
  });

  it('hides reactions of unsent messages', async () => {
    const { riya, arjun, id } = await pair();
    const msg = await send(riya, id, 'oops');
    await api(arjun).put(reactionUrl(id, msg.body.id), { emoji: '😂' });
    await api(riya).delete(`/conversations/${id}/messages/${msg.body.id}`);
    const page = await api(arjun).get(`/conversations/${id}/messages`);
    expect(page.body.data[0].reactions).toEqual([]);
  });

  it('broadcasts message.reaction to both people', async () => {
    const { riya, arjun, id } = await pair();
    const msg = await send(riya, id, 'hey');
    const riyaSocket = socketFor(riya);
    const arjunSocket = socketFor(arjun);
    await Promise.all([connected(riyaSocket), connected(arjunSocket)]);

    const forRiya = nextEvent<{ message_id: string; reactions: unknown[] }>(
      riyaSocket,
      'message.reaction',
    );
    const forArjun = nextEvent(arjunSocket, 'message.reaction');
    await api(arjun).put(reactionUrl(id, msg.body.id), { emoji: '😮' });
    expect(await forRiya).toEqual({
      conversation_id: id,
      message_id: msg.body.id,
      reactions: [{ emoji: '😮', user_ids: [arjun.id], count: 1 }],
    });
    await forArjun;
  });

  it('does not touch unread counts or the inbox preview', async () => {
    const { riya, arjun, id } = await pair();
    const msg = await send(riya, id, 'hey');
    await api(arjun).put(reactionUrl(id, msg.body.id), { emoji: '😮' });
    const inbox = await api(arjun).get('/conversations');
    expect(inbox.body.data[0]).toMatchObject({ unread_count: 1, last_message: { body: 'hey' } });
  });
});

describe('editing', () => {
  const editUrl = (id: string, messageId: string) => `/conversations/${id}/messages/${messageId}`;

  it('edits my text message, marks it edited and updates quotes and the preview', async () => {
    const { riya, arjun, id } = await pair();
    const original = await send(riya, id, 'Dinner at 8?');
    const reply = await send(arjun, id, { body: 'sure', reply_to_id: original.body.id });
    expect(reply.body.reply_to).toMatchObject({ body: 'Dinner at 8?', is_edited: false });

    const edited = await api(riya).patch(editUrl(id, original.body.id), { body: 'Dinner at 9?' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ body: 'Dinner at 9?' });
    expect(edited.body.edited_at).toEqual(expect.any(String));

    const page = await api(arjun).get(`/conversations/${id}/messages`);
    const quote = page.body.data.find((m: { id: string }) => m.id === reply.body.id).reply_to;
    expect(quote).toMatchObject({ body: 'Dinner at 9?', is_edited: true });

    // The edited message is not the latest here, so the preview keeps showing the reply.
    const inbox = await api(riya).get('/conversations');
    expect(inbox.body.data[0].last_message.body).toBe('sure');
  });

  it('updates the inbox preview when the last message is edited, and broadcasts it', async () => {
    const { riya, arjun, id } = await pair();
    const msg = await send(riya, id, 'helo');
    const arjunSocket = socketFor(arjun);
    await connected(arjunSocket);
    const updated = nextEvent<{ id: string; body: string }>(arjunSocket, 'message.updated');
    const row = nextEvent<{ last_message: { body: string } }>(arjunSocket, 'conversation.updated');

    await api(riya).patch(editUrl(id, msg.body.id), { body: 'hello' });
    expect(await updated).toMatchObject({ id: msg.body.id, body: 'hello' });
    expect((await row).last_message.body).toBe('hello');
  });

  it('only allows my own, visible, recent text messages', async () => {
    const { riya, arjun, id } = await pair();
    const mine = await send(riya, id, 'mine');
    expect((await api(arjun).patch(editUrl(id, mine.body.id), { body: 'hacked' })).status).toBe(403);
    expect((await api(riya).patch(editUrl(id, mine.body.id), { body: '   ' })).status).toBe(400);
    expect(
      (await api(riya).patch(editUrl(id, mine.body.id), { body: 'a'.repeat(2001) })).status,
    ).toBe(400);

    const gif = await send(riya, id, {
      gif: {
        id: 'g',
        url: 'https://media1.giphy.com/media/g/200w.gif',
        width: 200,
        height: 200,
      },
    });
    const gifEdit = await api(riya).patch(editUrl(id, gif.body.id), { body: 'text' });
    expect(gifEdit.body.error.code).toBe('MESSAGE_NOT_EDITABLE');

    const old = await send(riya, id, 'old');
    await Message.collection.updateOne(
      { _id: (await Message.findById(old.body.id))!._id },
      { $set: { created_at: new Date(Date.now() - EDIT_WINDOW_MS - 1000) } },
    );
    const late = await api(riya).patch(editUrl(id, old.body.id), { body: 'new' });
    expect(late.body.error.code).toBe('EDIT_WINDOW_EXPIRED');

    await api(riya).delete(`/conversations/${id}/messages/${mine.body.id}`);
    expect((await api(riya).patch(editUrl(id, mine.body.id), { body: 'x' })).status).toBe(404);
  });

  it('is a no-op when nothing changed', async () => {
    const { riya, id } = await pair();
    const msg = await send(riya, id, 'same');
    const res = await api(riya).patch(editUrl(id, msg.body.id), { body: '  same ' });
    expect(res.status).toBe(200);
    expect(res.body.edited_at).toBeNull();
    const convo = await Conversation.findById(id).lean();
    expect(convo?.last_message?.body).toBe('same');
  });
});
