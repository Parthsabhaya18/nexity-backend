import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { Conversation } from '../src/modules/messages/conversation.model';
import { api, app, openChat, person, send, useChatHarness } from './chatHarness';

useChatHarness();

describe('opening a direct conversation', () => {
  it('rejects people who cannot be messaged', async () => {
    const riya = await person('riya.writes');
    const unverified = await person('ghost.user', { is_verified: false });
    const disabled = await person('gone.user', { status: 'disabled' });

    for (const target of [unverified, disabled]) {
      const res = await api(riya).post('/conversations', { participant_ids: [target.id] });
      expect(res.status).toBe(404);
    }
    const missing = await api(riya).post('/conversations', {
      participant_ids: ['0123456789abcdef01234567'],
    });
    expect(missing.status).toBe(404);
    expect(await Conversation.countDocuments()).toBe(0);
  });

  it('validates the participant list', async () => {
    const riya = await person('riya.writes');
    const [a, b] = await Promise.all([person('a.one'), person('b.two')]);
    const cases = [
      {},
      { participant_ids: [] },
      { participant_ids: ['not-an-id'] },
      { participant_ids: [a.id, b.id] },
      { type: 'group', participant_ids: [a.id] },
    ];
    for (const body of cases) {
      const res = await api(riya).post('/conversations', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('creates only one conversation when both people open it at the same time', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const results = await Promise.all([
      api(riya).post('/conversations', { participant_ids: [arjun.id] }),
      api(arjun).post('/conversations', { participant_ids: [riya.id] }),
      api(riya).post('/conversations', { participant_ids: [arjun.id] }),
    ]);
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    expect(await Conversation.countDocuments()).toBe(1);
  });

  it('shows each person the other one as the peer', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    const riyaView = await api(riya).get(`/conversations/${id}`);
    const arjunView = await api(arjun).get(`/conversations/${id}`);
    expect(riyaView.body.peer.id).toBe(arjun.id);
    expect(arjunView.body.peer.id).toBe(riya.id);
    expect(riyaView.body.participants).toHaveLength(2);
    expect(riyaView.body.peer).not.toHaveProperty('email');
  });

  it('rejects malformed conversation ids', async () => {
    const riya = await person('riya.writes');
    expect((await api(riya).get('/conversations/abc')).status).toBe(400);
    expect((await api(riya).get('/conversations/0123456789abcdef01234567')).status).toBe(404);
  });
});

describe('inbox', () => {
  it('requires auth on every route', async () => {
    const id = '0123456789abcdef01234567';
    const calls = [
      request(app).get('/api/v1/conversations'),
      request(app).post('/api/v1/conversations'),
      request(app).get(`/api/v1/conversations/${id}`),
      request(app).delete(`/api/v1/conversations/${id}`),
      request(app).post(`/api/v1/conversations/${id}/mute`),
      request(app).get(`/api/v1/conversations/${id}/messages`),
      request(app).post(`/api/v1/conversations/${id}/messages`),
      request(app).delete(`/api/v1/conversations/${id}/messages/${id}`),
      request(app).post(`/api/v1/conversations/${id}/read`),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });

  it('orders by latest message and pages with a cursor', async () => {
    const me = await person('me.user');
    const friends = await Promise.all(
      ['f.one', 'f.two', 'f.three', 'f.four', 'f.five'].map((u) => person(u)),
    );
    const ids: string[] = [];
    for (const friend of friends) {
      const id = await openChat(me, friend);
      await send(friend, id, `hello from ${friend.username}`);
      ids.push(id);
    }
    // Bump the oldest conversation to the top.
    await send(me, ids[0]!, 'reply to the first');

    const first = await api(me).get('/conversations?limit=2');
    expect(first.body.data.map((c: { id: string }) => c.id)).toEqual([ids[0], ids[4]]);
    expect(first.body.pagination.has_more).toBe(true);

    const seen = [...first.body.data];
    let cursor = first.body.pagination.next_cursor as string | null;
    while (cursor) {
      const page = await api(me).get(`/conversations?limit=2&cursor=${cursor}`);
      seen.push(...page.body.data);
      cursor = page.body.pagination.next_cursor;
    }
    expect(seen.map((c) => c.id)).toEqual([ids[0], ids[4], ids[3], ids[2], ids[1]]);
  });

  it('rejects a broken cursor', async () => {
    const me = await person('me.user');
    const res = await api(me).get('/conversations?cursor=garbage');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('keeps per-member unread counts independent', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    await send(riya, id, 'one');
    await send(riya, id, 'two');
    await send(arjun, id, 'three');

    const riyaRow = (await api(riya).get('/conversations')).body.data[0];
    const arjunRow = (await api(arjun).get('/conversations')).body.data[0];
    // Replying marks everything before as read for the sender.
    expect(arjunRow.unread_count).toBe(0);
    expect(riyaRow.unread_count).toBe(1);
  });
});

describe('mute', () => {
  it('toggles only for the caller and validates the body', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);

    expect((await api(riya).post(`/conversations/${id}/mute`, {})).status).toBe(400);
    expect((await api(riya).post(`/conversations/${id}/mute`, { muted: 'yes' })).status).toBe(400);

    expect((await api(riya).post(`/conversations/${id}/mute`, { muted: true })).body.is_muted).toBe(
      true,
    );
    expect((await api(arjun).get(`/conversations/${id}`)).body.is_muted).toBe(false);
    expect((await api(riya).post(`/conversations/${id}/mute`, { muted: false })).body.is_muted).toBe(
      false,
    );
  });

  it('is not allowed for non-members', async () => {
    const [riya, arjun, eve] = await Promise.all([
      person('riya.writes'),
      person('arjun.k'),
      person('eve.x'),
    ]);
    const id = await openChat(riya, arjun);
    expect((await api(eve).post(`/conversations/${id}/mute`, { muted: true })).status).toBe(404);
  });
});

describe('delete chat for me', () => {
  it('hides history only for me and comes back on the next message', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const id = await openChat(riya, arjun);
    await send(riya, id, 'old 1');
    await send(arjun, id, 'old 2');

    expect((await api(riya).delete(`/conversations/${id}`)).status).toBe(204);
    expect((await api(riya).get('/conversations')).body.data).toHaveLength(0);
    expect((await api(riya).get(`/conversations/${id}/messages`)).body.data).toHaveLength(0);
    // The thread itself still opens, with an empty preview.
    const view = await api(riya).get(`/conversations/${id}`);
    expect(view.status).toBe(200);
    expect(view.body.last_message).toBeNull();
    expect(view.body.unread_count).toBe(0);

    // The other person still has everything.
    expect((await api(arjun).get(`/conversations/${id}/messages`)).body.data).toHaveLength(2);

    // Re-opening from "New message" reuses the same conversation.
    const reopened = await api(riya).post('/conversations', { participant_ids: [arjun.id] });
    expect(reopened.body.id).toBe(id);

    await send(riya, id, 'fresh start');
    const back = await api(riya).get('/conversations');
    expect(back.body.data[0]).toMatchObject({ id, last_message: { body: 'fresh start' } });
    const history = await api(riya).get(`/conversations/${id}/messages`);
    expect(history.body.data.map((m: { body: string }) => m.body)).toEqual(['fresh start']);
  });

  it('works on a conversation without messages and for non-members returns 404', async () => {
    const [riya, arjun, eve] = await Promise.all([
      person('riya.writes'),
      person('arjun.k'),
      person('eve.x'),
    ]);
    const id = await openChat(riya, arjun);
    expect((await api(riya).delete(`/conversations/${id}`)).status).toBe(204);
    expect((await api(eve).delete(`/conversations/${id}`)).status).toBe(404);
  });
});
