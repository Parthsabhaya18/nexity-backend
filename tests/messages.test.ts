import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { Conversation } from '../src/modules/messages/conversation.model';
import { Message } from '../src/modules/messages/message.model';
import {
  api,
  app,
  connected,
  nextEvent,
  openChat,
  person,
  send,
  socketFor,
  useChatHarness,
} from './chatHarness';

useChatHarness();

describe('conversations', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/v1/conversations');
    expect(res.status).toBe(401);
  });

  it('opens one direct conversation per pair, from either side', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');

    const first = await api(riya).post('/conversations', { participant_ids: [arjun.id] });
    expect(first.status).toBe(201);
    expect(first.body.peer).toMatchObject({ id: arjun.id, username: 'arjun.k' });

    const again = await api(arjun).post('/conversations', { participant_ids: [riya.id] });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await Conversation.countDocuments()).toBe(1);
  });

  it('rejects messaging yourself', async () => {
    const riya = await person('riya.writes');
    const res = await api(riya).post('/conversations', { participant_ids: [riya.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARTICIPANT');
  });

  it('hides empty conversations from the inbox and other people cannot read them', async () => {
    const [riya, arjun, eve] = await Promise.all([
      person('riya.writes'),
      person('arjun.k'),
      person('eve.x'),
    ]);
    const id = await openChat(riya, arjun);

    expect((await api(riya).get('/conversations')).body.data).toHaveLength(0);
    expect((await api(eve).get(`/conversations/${id}`)).status).toBe(404);
    expect((await api(eve).get(`/conversations/${id}/messages`)).status).toBe(404);
  });
});

describe('messages', () => {
  it('sends, deduplicates retries, tracks unread and read receipts', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const clientId = randomUUID();

    const sent = await api(riya).post(`/conversations/${id}/messages`, {
      body: '  Hi Arjun 👋  ',
      client_message_id: clientId,
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ body: 'Hi Arjun 👋', sender_id: riya.id, type: 'text' });

    const retry = await api(riya).post(`/conversations/${id}/messages`, {
      body: 'Hi Arjun 👋',
      client_message_id: clientId,
    });
    expect(retry.body.id).toBe(sent.body.id);
    expect(await Message.countDocuments()).toBe(1);

    await api(riya).post(`/conversations/${id}/messages`, {
      body: 'Are you free later?',
      client_message_id: randomUUID(),
    });

    const inbox = await api(arjun).get('/conversations');
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({
      unread_count: 2,
      last_message: { body: 'Are you free later?', sender_id: riya.id },
      peer: { id: riya.id },
    });
    expect((await api(riya).get('/conversations')).body.data[0].unread_count).toBe(0);

    const read = await api(arjun).post(`/conversations/${id}/read`);
    expect(read.body.unread_count).toBe(0);
    const riyaView = await api(riya).get(`/conversations/${id}`);
    expect(riyaView.body.peer_last_read_message_id).toBe(read.body.last_read_message_id);

    const page = await api(arjun).get(`/conversations/${id}/messages?limit=1`);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.data[0].body).toBe('Are you free later?');
    expect(page.body.pagination.has_more).toBe(true);
    const older = await api(arjun).get(
      `/conversations/${id}/messages?cursor=${page.body.pagination.next_cursor}`,
    );
    expect(older.body.data.map((m: { body: string }) => m.body)).toEqual(['Hi Arjun 👋']);
  });

  it('validates the message body', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const empty = await api(riya).post(`/conversations/${id}/messages`, {
      body: '   ',
      client_message_id: randomUUID(),
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sends GIPHY gifs and rejects other hosts', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const gif = {
      id: 'abc123',
      url: 'https://media2.giphy.com/media/abc123/200w.gif',
      preview_url: 'https://media2.giphy.com/media/abc123/200w_d.gif',
      width: 200,
      height: 150,
    };

    const sent = await api(riya).post(`/conversations/${id}/messages`, {
      gif,
      client_message_id: randomUUID(),
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({
      type: 'gif',
      body: '',
      media: { provider: 'giphy', provider_id: 'abc123', url: gif.url, width: 200, height: 150 },
    });
    const inbox = await api(arjun).get('/conversations');
    expect(inbox.body.data[0].last_message).toMatchObject({ type: 'gif' });

    const evil = await api(riya).post(`/conversations/${id}/messages`, {
      gif: { ...gif, url: 'https://evil.example.com/x.gif' },
      client_message_id: randomUUID(),
    });
    expect(evil.status).toBe(400);
  });

  it('includes a preview of the replied-to message', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const original = await api(riya).post(`/conversations/${id}/messages`, {
      body: 'Dinner at 8?',
      client_message_id: randomUUID(),
    });
    const reply = await api(arjun).post(`/conversations/${id}/messages`, {
      body: 'Yes!',
      reply_to_id: original.body.id,
      client_message_id: randomUUID(),
    });
    expect(reply.body.reply_to).toMatchObject({
      id: original.body.id,
      sender_id: riya.id,
      body: 'Dinner at 8?',
    });
    const page = await api(riya).get(`/conversations/${id}/messages`);
    expect(page.body.data[0].reply_to.body).toBe('Dinner at 8?');
  });

  it('unsends own messages only and fixes unread and the inbox preview', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const sent = await api(riya).post(`/conversations/${id}/messages`, {
      body: 'oops',
      client_message_id: randomUUID(),
    });

    const notMine = await api(arjun).delete(`/conversations/${id}/messages/${sent.body.id}`);
    expect(notMine.status).toBe(403);

    const res = await api(riya).delete(`/conversations/${id}/messages/${sent.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ is_deleted: true, body: '' });

    const inbox = await api(arjun).get('/conversations');
    expect(inbox.body.data[0]).toMatchObject({ unread_count: 0, last_message: null });
  });

  it('falls back to the previous message in the preview, and repairs old unsent previews', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const first = await send(arjun, id, 'hey');
    const second = await send(riya, id, 'oops');
    const third = await send(riya, id, 'oops again');

    await api(riya).delete(`/conversations/${id}/messages/${second.body.id}`);
    let inbox = await api(arjun).get('/conversations');
    expect(inbox.body.data[0].last_message).toMatchObject({ id: third.body.id });

    await api(riya).delete(`/conversations/${id}/messages/${third.body.id}`);
    inbox = await api(arjun).get('/conversations');
    expect(inbox.body.data[0].last_message).toMatchObject({
      id: first.body.id,
      body: 'hey',
      is_deleted: false,
    });

    // Data written before this behaviour: the preview still points at an unsent message.
    await Conversation.updateOne(
      { _id: id },
      { $set: { 'last_message.id': third.body.id, 'last_message.is_deleted': true, 'last_message.body': '' } },
    );
    inbox = await api(riya).get('/conversations');
    expect(inbox.body.data[0].last_message).toMatchObject({ id: first.body.id, body: 'hey' });
    const stored = await Conversation.findById(id).lean();
    expect(stored?.last_message?.is_deleted).toBe(false);
  });

  it('mutes and deletes a chat for one member only', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    await api(riya).post(`/conversations/${id}/messages`, {
      body: 'first',
      client_message_id: randomUUID(),
    });

    const muted = await api(arjun).post(`/conversations/${id}/mute`, { muted: true });
    expect(muted.body.is_muted).toBe(true);
    expect((await api(riya).get(`/conversations/${id}`)).body.is_muted).toBe(false);

    expect((await api(arjun).delete(`/conversations/${id}`)).status).toBe(204);
    expect((await api(arjun).get('/conversations')).body.data).toHaveLength(0);
    expect((await api(riya).get('/conversations')).body.data).toHaveLength(1);

    await api(riya).post(`/conversations/${id}/messages`, {
      body: 'second',
      client_message_id: randomUUID(),
    });
    const back = await api(arjun).get('/conversations');
    expect(back.body.data[0]).toMatchObject({ unread_count: 1, last_message: { body: 'second' } });
    const history = await api(arjun).get(`/conversations/${id}/messages`);
    expect(history.body.data.map((m: { body: string }) => m.body)).toEqual(['second']);
  });
});

describe('profiles and gifs', () => {
  it('returns a public profile by username', async () => {
    const riya = await person('riya.writes');
    await person('arjun.k');
    const res = await api(riya).get('/users/by-username/Arjun.K');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: 'arjun.k',
      is_self: false,
      posts_count: 0,
      presence: { online: false },
    });
    expect(res.body.email).toBeUndefined();
    expect((await api(riya).get('/users/by-username/nobody')).status).toBe(404);
  });
});

describe('chat socket', () => {
  it('rejects connections without a valid token', async () => {
    const socket = socketFor(null);
    await expect(connected(socket)).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  it('delivers new messages, inbox updates, typing and read receipts in real time', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);

    const riyaSocket = socketFor(riya);
    const arjunSocket = socketFor(arjun);
    await Promise.all([connected(riyaSocket), connected(arjunSocket)]);

    const incoming = nextEvent<{ body: string }>(arjunSocket, 'message.new');
    const inboxRow = nextEvent<{ unread_count: number }>(arjunSocket, 'conversation.updated');
    await api(riya).post(`/conversations/${id}/messages`, {
      body: 'Live!',
      client_message_id: randomUUID(),
    });
    expect((await incoming).body).toBe('Live!');
    expect((await inboxRow).unread_count).toBe(1);

    const typing = nextEvent<{ conversation_id: string; user_id: string }>(
      riyaSocket,
      'typing.start',
    );
    arjunSocket.emit('typing.start', { conversation_id: id });
    expect(await typing).toEqual({ conversation_id: id, user_id: arjun.id });

    const receipt = nextEvent<{ user_id: string }>(riyaSocket, 'message.read');
    await api(arjun).post(`/conversations/${id}/read`);
    expect((await receipt).user_id).toBe(arjun.id);
  });

  it('reports presence for subscribed users', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const riyaSocket = socketFor(riya);
    await connected(riyaSocket);

    const status = await riyaSocket.emitWithAck('presence.subscribe', { user_ids: [arjun.id] });
    expect(status.data[0]).toMatchObject({ user_id: arjun.id, is_online: false });

    const online = nextEvent<{ is_online: boolean }>(riyaSocket, 'presence.update');
    await connected(socketFor(arjun));
    expect((await online).is_online).toBe(true);
  });
});
