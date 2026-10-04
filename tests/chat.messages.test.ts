import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Message } from '../src/modules/messages/message.model';
import { api, openChat, person, send, useChatHarness } from './chatHarness';

useChatHarness();

const GIF = {
  id: 'abc123',
  url: 'https://media2.giphy.com/media/abc123/200w.gif',
  preview_url: 'https://media2.giphy.com/media/abc123/200w_d.gif',
  width: 200,
  height: 150,
};

async function pair() {
  const riya = await person('riya.writes');
  const arjun = await person('arjun.k');
  const id = await openChat(riya, arjun);
  return { riya, arjun, id };
}

describe('sending', () => {
  it('accepts exactly 2000 characters and rejects 2001', async () => {
    const { riya, id } = await pair();
    expect((await send(riya, id, 'a'.repeat(2000))).status).toBe(201);
    const tooLong = await send(riya, id, 'a'.repeat(2001));
    expect(tooLong.status).toBe(400);
  });

  it('requires a UUID client_message_id', async () => {
    const { riya, id } = await pair();
    for (const client_message_id of [undefined, '', 'abc', 123]) {
      const res = await api(riya).post(`/conversations/${id}/messages`, {
        body: 'hi',
        client_message_id,
      });
      expect(res.status).toBe(400);
    }
  });

  it('refuses a client_message_id reused in another conversation', async () => {
    const riya = await person('riya.writes');
    const [a, b] = await Promise.all([person('a.one'), person('b.two')]);
    const first = await openChat(riya, a);
    const second = await openChat(riya, b);
    const clientId = randomUUID();
    expect((await send(riya, first, { body: 'x', client_message_id: clientId })).status).toBe(201);
    const reused = await send(riya, second, { body: 'y', client_message_id: clientId });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('DUPLICATE_CLIENT_MESSAGE_ID');
  });

  it('stores one message when the same retry arrives in parallel', async () => {
    const { riya, arjun, id } = await pair();
    const clientId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => send(riya, id, { body: 'once', client_message_id: clientId })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await Message.countDocuments()).toBe(1);
    expect((await api(arjun).get('/conversations')).body.data[0].unread_count).toBe(1);
  });

  it('rejects photo uploads until media ships', async () => {
    const { riya, id } = await pair();
    const res = await send(riya, id, { media_id: '0123456789abcdef01234567' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_NOT_SUPPORTED');
  });

  it('does not let outsiders post', async () => {
    const { id } = await pair();
    const eve = await person('eve.x');
    expect((await send(eve, id, 'let me in')).status).toBe(404);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('validates GIF payloads', async () => {
    const { riya, id } = await pair();
    const bad = [
      { ...GIF, url: 'http://media2.giphy.com/media/abc/200w.gif' },
      { ...GIF, url: 'https://giphy.com.evil.io/x.gif' },
      { ...GIF, url: 'javascript:alert(1)' },
      { ...GIF, width: 0 },
      { ...GIF, id: '' },
      { url: GIF.url },
    ];
    for (const gif of bad) {
      expect((await send(riya, id, { gif })).status, JSON.stringify(gif)).toBe(400);
    }
    expect((await send(riya, id, { gif: { ...GIF, preview_url: null } })).status).toBe(201);
    expect((await send(riya, id, { gif: { ...GIF, kind: 'meme' } })).status).toBe(400);
  });

  it('sends stickers as their own type and shows them in the inbox', async () => {
    const { riya, arjun, id } = await pair();
    const sticker = await send(riya, id, { gif: { ...GIF, kind: 'sticker' } });
    expect(sticker.status).toBe(201);
    expect(sticker.body).toMatchObject({
      type: 'sticker',
      body: '',
      media: { provider: 'giphy', url: GIF.url },
    });

    const inbox = await api(arjun).get('/conversations');
    expect(inbox.body.data[0].last_message).toMatchObject({ type: 'sticker' });

    const reply = await send(arjun, id, { body: 'cute', reply_to_id: sticker.body.id });
    expect(reply.body.reply_to).toMatchObject({ type: 'sticker' });

    const plain = await send(riya, id, { gif: GIF });
    expect(plain.body.type).toBe('gif');
  });
});

describe('replies', () => {
  it('rejects quoting a message from another conversation or an unsent one', async () => {
    const riya = await person('riya.writes');
    const [a, b] = await Promise.all([person('a.one'), person('b.two')]);
    const first = await openChat(riya, a);
    const second = await openChat(riya, b);
    const elsewhere = await send(riya, second, 'secret');

    const cross = await send(riya, first, { body: 'hi', reply_to_id: elsewhere.body.id });
    expect(cross.status).toBe(400);
    expect(cross.body.error.code).toBe('REPLY_TARGET_NOT_FOUND');

    const mine = await send(riya, first, 'oops');
    await api(riya).delete(`/conversations/${first}/messages/${mine.body.id}`);
    const toUnsent = await send(a, first, { body: 'what?', reply_to_id: mine.body.id });
    expect(toUnsent.body.error.code).toBe('REPLY_TARGET_NOT_FOUND');
  });

  it('hides the quote text once the original is unsent', async () => {
    const { riya, arjun, id } = await pair();
    const original = await send(riya, id, 'private thought');
    await send(arjun, id, { body: 'ha', reply_to_id: original.body.id });
    await api(riya).delete(`/conversations/${id}/messages/${original.body.id}`);

    const page = await api(arjun).get(`/conversations/${id}/messages`);
    expect(page.body.data[0].reply_to).toMatchObject({ is_deleted: true, body: '' });
  });

  it('quotes GIFs by type', async () => {
    const { riya, arjun, id } = await pair();
    const gif = await send(riya, id, { gif: GIF });
    const reply = await send(arjun, id, { body: 'lol', reply_to_id: gif.body.id });
    expect(reply.body.reply_to).toMatchObject({ type: 'gif', body: '' });
  });
});

describe('history', () => {
  it('catches up after a reconnect with `after`, oldest first, in pages', async () => {
    const { riya, arjun, id } = await pair();
    const first = await send(riya, id, 'm0');
    for (let i = 1; i <= 4; i++) await send(arjun, id, `m${i}`);

    const page1 = await api(riya).get(`/conversations/${id}/messages?after=${first.body.id}&limit=3`);
    expect(page1.body.data.map((m: { body: string }) => m.body)).toEqual(['m1', 'm2', 'm3']);
    expect(page1.body.pagination.has_more).toBe(true);
    const page2 = await api(riya).get(
      `/conversations/${id}/messages?after=${page1.body.pagination.next_cursor}&limit=3`,
    );
    expect(page2.body.data.map((m: { body: string }) => m.body)).toEqual(['m4']);
    expect(page2.body.pagination.has_more).toBe(false);
  });

  it('rejects bad cursors and limits', async () => {
    const { riya, id } = await pair();
    expect((await api(riya).get(`/conversations/${id}/messages?cursor=xyz`)).status).toBe(400);
    expect((await api(riya).get(`/conversations/${id}/messages?limit=500`)).status).toBe(400);
    expect((await api(riya).get(`/conversations/${id}/messages?limit=0`)).status).toBe(400);
  });
});

describe('read receipts', () => {
  it('never moves backwards and ignores foreign message ids', async () => {
    const { riya, arjun, id } = await pair();
    const m1 = await send(riya, id, 'one');
    await send(riya, id, 'two');

    const all = await api(arjun).post(`/conversations/${id}/read`);
    expect(all.body.unread_count).toBe(0);
    const back = await api(arjun).post(`/conversations/${id}/read`, { message_id: m1.body.id });
    expect(back.body.last_read_message_id).toBe(all.body.last_read_message_id);

    const other = await person('eve.x');
    const elsewhere = await openChat(riya, other);
    const foreign = await send(riya, elsewhere, 'nope');
    const res = await api(arjun).post(`/conversations/${id}/read`, { message_id: foreign.body.id });
    expect(res.status).toBe(404);
  });

  it('handles an empty conversation', async () => {
    const { arjun, id } = await pair();
    const res = await api(arjun).post(`/conversations/${id}/read`);
    expect(res.body).toMatchObject({ last_read_message_id: null, unread_count: 0 });
  });

  it('marking up to a middle message leaves the rest unread', async () => {
    const { riya, arjun, id } = await pair();
    const m1 = await send(riya, id, 'one');
    await send(riya, id, 'two');
    await send(riya, id, 'three');
    const res = await api(arjun).post(`/conversations/${id}/read`, { message_id: m1.body.id });
    expect(res.body.unread_count).toBe(2);
  });
});

describe('unsend', () => {
  it('handles missing, repeated and non-last messages', async () => {
    const { riya, arjun, id } = await pair();
    const first = await send(riya, id, 'first');
    await send(riya, id, 'second');

    expect(
      (await api(riya).delete(`/conversations/${id}/messages/0123456789abcdef01234567`)).status,
    ).toBe(404);

    const once = await api(riya).delete(`/conversations/${id}/messages/${first.body.id}`);
    const twice = await api(riya).delete(`/conversations/${id}/messages/${first.body.id}`);
    expect(once.status).toBe(200);
    expect(twice.status).toBe(200);
    expect(twice.body.is_deleted).toBe(true);

    const row = (await api(arjun).get('/conversations')).body.data[0];
    expect(row.last_message).toMatchObject({ body: 'second', is_deleted: false });
    expect(row.unread_count).toBe(1);
  });

  it('keeps unread at zero when the message was already read', async () => {
    const { riya, arjun, id } = await pair();
    const sent = await send(riya, id, 'seen it');
    await api(arjun).post(`/conversations/${id}/read`);
    await api(riya).delete(`/conversations/${id}/messages/${sent.body.id}`);
    expect((await api(arjun).get('/conversations')).body.data[0].unread_count).toBe(0);
  });

  it('removes GIF media from the payload', async () => {
    const { riya, arjun, id } = await pair();
    const gif = await send(riya, id, { gif: GIF });
    await api(riya).delete(`/conversations/${id}/messages/${gif.body.id}`);
    const page = await api(arjun).get(`/conversations/${id}/messages`);
    expect(page.body.data[0]).toMatchObject({ is_deleted: true, media: null });
  });

  it('is blocked for outsiders', async () => {
    const { riya, id } = await pair();
    const sent = await send(riya, id, 'mine');
    const eve = await person('eve.x');
    expect((await api(eve).delete(`/conversations/${id}/messages/${sent.body.id}`)).status).toBe(
      404,
    );
  });
});