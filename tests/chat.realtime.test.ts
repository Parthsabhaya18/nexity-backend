import { describe, expect, it } from 'vitest';

import { User } from '../src/modules/users/user.model';
import {
  api,
  connected,
  nextEvent,
  noEvent,
  openChat,
  person,
  send,
  sleep,
  socketFor,
  useChatHarness,
} from './chatHarness';

useChatHarness();

const GRACE_MS = Number(process.env.PRESENCE_OFFLINE_GRACE_MS ?? 300);

describe('socket auth', () => {
  it('rejects missing and malformed tokens', async () => {
    const riya = await person('riya.writes');
    for (const token of ['', 'garbage', `${riya.token}x`]) {
      const socket = socketFor(null, token);
      await expect(connected(socket)).rejects.toMatchObject({
        data: { code: expect.any(String) },
      });
    }
  });

  it('rejects tokens of disabled accounts', async () => {
    const riya = await person('riya.writes');
    await User.updateOne({ _id: riya.id }, { status: 'disabled' });
    await expect(connected(socketFor(riya))).rejects.toBeTruthy();
  });
});

describe('delivery', () => {
  it('reaches every device of both people, in order', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const phone = socketFor(riya);
    const tablet = socketFor(riya);
    const arjunPhone = socketFor(arjun);
    await Promise.all([connected(phone), connected(tablet), connected(arjunPhone)]);

    const received: string[] = [];
    arjunPhone.on('message.new', (m: { body: string }) => received.push(m.body));
    const onTablet = nextEvent<{ body: string; sender_id: string }>(tablet, 'message.new');

    for (const body of ['a', 'b', 'c', 'd', 'e']) await send(riya, id, body);
    expect((await onTablet).sender_id).toBe(riya.id);
    await sleep(150);
    expect(received).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('clears the unread badge on my other devices when I read on one', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    await send(riya, id, 'hi');
    const arjunTablet = socketFor(arjun);
    await connected(arjunTablet);

    const update = nextEvent<{ unread_count: number }>(arjunTablet, 'conversation.updated');
    await api(arjun).post(`/conversations/${id}/read`);
    expect((await update).unread_count).toBe(0);
  });

  it('does not leak events to people outside the conversation', async () => {
    const [riya, arjun, eve] = await Promise.all([
      person('riya.writes'),
      person('arjun.k'),
      person('eve.x'),
    ]);
    const id = await openChat(riya, arjun);
    const eveSocket = socketFor(eve);
    await connected(eveSocket);
    const silent = noEvent(eveSocket, 'message.new');
    await send(riya, id, 'private');
    expect(await silent).toBe(true);
  });
});

describe('unsend, mute and delete events', () => {
  it('broadcasts message.deleted and an updated preview', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const before = await send(arjun, id, 'see you');
    const sent = await send(riya, id, 'oops');
    const arjunSocket = socketFor(arjun);
    const riyaTablet = socketFor(riya);
    await Promise.all([connected(arjunSocket), connected(riyaTablet)]);

    const deleted = nextEvent<{ message_id: string }>(arjunSocket, 'message.deleted');
    const deletedOnTablet = nextEvent<{ message_id: string }>(riyaTablet, 'message.deleted');
    const row = nextEvent<{ last_message: { id: string; body: string }; unread_count: number }>(
      arjunSocket,
      'conversation.updated',
    );
    await api(riya).delete(`/conversations/${id}/messages/${sent.body.id}`);
    expect((await deleted).message_id).toBe(sent.body.id);
    expect((await deletedOnTablet).message_id).toBe(sent.body.id);
    expect(await row).toMatchObject({
      last_message: { id: before.body.id, body: 'see you', is_deleted: false },
      unread_count: 0,
    });
  });

  it('sends mute changes to my devices only', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const mine = socketFor(riya);
    const theirs = socketFor(arjun);
    await Promise.all([connected(mine), connected(theirs)]);

    const update = nextEvent<{ is_muted: boolean }>(mine, 'conversation.updated');
    const silent = noEvent(theirs, 'conversation.updated');
    await api(riya).post(`/conversations/${id}/mute`, { muted: true });
    expect((await update).is_muted).toBe(true);
    expect(await silent).toBe(true);
  });

  it('tells my other devices a chat was deleted, not the other person', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const mine = socketFor(riya);
    const theirs = socketFor(arjun);
    await Promise.all([connected(mine), connected(theirs)]);

    const removed = nextEvent<{ conversation_id: string }>(mine, 'conversation.deleted');
    const silent = noEvent(theirs, 'conversation.deleted');
    await api(riya).delete(`/conversations/${id}`);
    expect((await removed).conversation_id).toBe(id);
    expect(await silent).toBe(true);
  });
});

describe('typing', () => {
  it('relays start and stop to the other member only', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const riyaSocket = socketFor(riya);
    const arjunSocket = socketFor(arjun);
    await Promise.all([connected(riyaSocket), connected(arjunSocket)]);

    const echo = noEvent(riyaSocket, 'typing.start');
    const start = nextEvent(arjunSocket, 'typing.start');
    riyaSocket.emit('typing.start', { conversation_id: id });
    expect(await start).toEqual({ conversation_id: id, user_id: riya.id });
    expect(await echo).toBe(true);

    const stop = nextEvent(arjunSocket, 'typing.stop');
    riyaSocket.emit('typing.stop', { conversation_id: id });
    expect(await stop).toEqual({ conversation_id: id, user_id: riya.id });
  });

  it('ignores outsiders and malformed payloads', async () => {
    const [riya, arjun, eve] = await Promise.all([
      person('riya.writes'),
      person('arjun.k'),
      person('eve.x'),
    ]);
    const id = await openChat(riya, arjun);
    const arjunSocket = socketFor(arjun);
    const eveSocket = socketFor(eve);
    await Promise.all([connected(arjunSocket), connected(eveSocket)]);

    const silent = noEvent(arjunSocket, 'typing.start', 500);
    eveSocket.emit('typing.start', { conversation_id: id });
    eveSocket.emit('typing.start', null);
    eveSocket.emit('typing.start', { conversation_id: 'nope' });
    eveSocket.emit('typing.start', 'string');
    expect(await silent).toBe(true);
    expect(eveSocket.connected).toBe(true);
  });
});

describe('presence', () => {
  it('filters invalid ids and reports current status in the ack', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const arjunSocket = socketFor(arjun);
    const riyaSocket = socketFor(riya);
    await Promise.all([connected(arjunSocket), connected(riyaSocket)]);

    const res = await riyaSocket.emitWithAck('presence.subscribe', {
      user_ids: [arjun.id, 'bad', 42, arjun.id],
    });
    expect(res.data).toEqual([
      expect.objectContaining({ user_id: arjun.id, is_online: true }),
    ]);
    const empty = await riyaSocket.emitWithAck('presence.subscribe', { user_ids: 'nope' });
    expect(empty.data).toEqual([]);
  });

  it('goes offline only after the grace period and stores last_active_at', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const watcher = socketFor(riya);
    await connected(watcher);
    const arjunSocket = socketFor(arjun);
    await connected(arjunSocket);
    await watcher.emitWithAck('presence.subscribe', { user_ids: [arjun.id] });

    const offline = nextEvent<{ is_online: boolean; last_active_at: string }>(
      watcher,
      'presence.update',
      GRACE_MS + 2000,
    );
    const startedAt = Date.now();
    arjunSocket.disconnect();
    const event = await offline;
    expect(event.is_online).toBe(false);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(GRACE_MS - 50);
    expect(event.last_active_at).toEqual(expect.any(String));

    await sleep(50);
    const stored = await User.findById(arjun.id).lean();
    expect(stored?.last_active_at).toBeInstanceOf(Date);
  });

  it('a quick reconnect inside the grace period is invisible to watchers', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const watcher = socketFor(riya);
    await connected(watcher);
    const first = socketFor(arjun);
    await connected(first);
    await watcher.emitWithAck('presence.subscribe', { user_ids: [arjun.id] });

    const silent = noEvent(watcher, 'presence.update', GRACE_MS + 400);
    first.disconnect();
    await sleep(Math.floor(GRACE_MS / 3));
    await connected(socketFor(arjun));
    expect(await silent).toBe(true);

    const status = await watcher.emitWithAck('presence.subscribe', { user_ids: [arjun.id] });
    expect(status.data[0].is_online).toBe(true);
  });

  it('stays online while any device is connected', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const watcher = socketFor(riya);
    const phone = socketFor(arjun);
    const laptop = socketFor(arjun);
    await Promise.all([connected(watcher), connected(phone), connected(laptop)]);
    await watcher.emitWithAck('presence.subscribe', { user_ids: [arjun.id] });

    const silent = noEvent(watcher, 'presence.update', GRACE_MS + 400);
    phone.disconnect();
    expect(await silent).toBe(true);
  });
});
