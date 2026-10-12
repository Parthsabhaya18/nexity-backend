import { randomUUID } from 'node:crypto';

import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';

import { Media } from '../src/modules/media/media.model';
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

async function readyMedia(
  ownerId: string,
  kind: 'image' | 'video' | 'audio',
  overrides: Partial<{ status: 'pending' | 'ready'; purpose: 'message' | 'post' }> = {},
) {
  const _id = new Types.ObjectId();
  const ext = { image: 'jpg', video: 'mp4', audio: 'm4a' }[kind];
  const media = await Media.create({
    _id,
    owner_id: ownerId,
    purpose: 'message',
    kind,
    key: `media/messages/${ownerId}/${_id.toHexString()}.${ext}`,
    content_type: { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/mp4' }[kind],
    bytes: 1024,
    width: kind === 'audio' ? null : 640,
    height: kind === 'audio' ? null : 480,
    duration_ms: kind === 'image' ? null : 4200,
    status: 'ready',
    upload_expires_at: new Date(Date.now() + 60_000),
    ...overrides,
  });
  return {
    id: media.id as string,
    key: media.key,
    width: media.width,
    duration_ms: media.duration_ms,
  };
}

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

  it('rejects a media id that is not a finished upload of mine', async () => {
    const { riya, arjun, id } = await pair();
    const unknown = await send(riya, id, { media_id: '0123456789abcdef01234567' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('INVALID_MEDIA');

    const someoneElses = await readyMedia(arjun.id, 'image');
    const stolen = await send(riya, id, { media_id: someoneElses.id });
    expect(stolen.body.error.code).toBe('INVALID_MEDIA');

    const pending = await readyMedia(riya.id, 'image', { status: 'pending' });
    expect((await send(riya, id, { media_id: pending.id })).body.error.code).toBe('INVALID_MEDIA');

    const forAPost = await readyMedia(riya.id, 'image', { purpose: 'post' });
    expect((await send(riya, id, { media_id: forAPost.id })).body.error.code).toBe('INVALID_MEDIA');
  });

  it('sends photos, videos and voice notes from finished uploads', async () => {
    const { riya, arjun, id } = await pair();
    const expected = { image: 'image', video: 'video', audio: 'voice' } as const;
    for (const kind of ['image', 'video', 'audio'] as const) {
      const media = await readyMedia(riya.id, kind);
      const res = await send(riya, id, { media_id: media.id });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe(expected[kind]);
      expect(res.body.media).toMatchObject({
        provider: 'upload',
        media_id: media.id,
        width: media.width,
        duration_ms: media.duration_ms,
      });
      expect(res.body.media.url).toContain(media.key);
      expect(res.body.media.key).toBeUndefined();
    }
    const thread = await api(arjun).get(`/conversations/${id}/messages`);
    expect(thread.body.data.map((m: { type: string }) => m.type)).toEqual([
      'voice',
      'video',
      'image',
    ]);
  });

  it('sends several photos and videos as one album, in order', async () => {
    const { riya, arjun, id } = await pair();
    const files = [
      await readyMedia(riya.id, 'image'),
      await readyMedia(riya.id, 'video'),
      await readyMedia(riya.id, 'image'),
    ];
    const res = await send(riya, id, { media_ids: files.map((f) => f.id) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'album', media: null });
    expect(res.body.media_items.map((m: { media_id: string }) => m.media_id)).toEqual(
      files.map((f) => f.id),
    );
    expect(res.body.media_items[1].url).toContain(files[1]!.key);

    const inbox = await api(arjun).get('/conversations');
    expect(inbox.body.data[0].last_message).toMatchObject({ type: 'album' });
  });

  it('refuses voice notes, repeats and stolen files in an album', async () => {
    const { riya, arjun, id } = await pair();
    const photo = await readyMedia(riya.id, 'image');
    const voice = await readyMedia(riya.id, 'audio');
    const theirs = await readyMedia(arjun.id, 'image');
    expect((await send(riya, id, { media_ids: [photo.id, voice.id] })).status).toBe(400);
    expect((await send(riya, id, { media_ids: [photo.id, photo.id] })).status).toBe(400);
    expect((await send(riya, id, { media_ids: [photo.id, theirs.id] })).status).toBe(400);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('refuses a GIF and a file in the same message', async () => {
    const { riya, id } = await pair();
    const media = await readyMedia(riya.id, 'image');
    const res = await send(riya, id, { media_id: media.id, gif: GIF });
    expect(res.status).toBe(400);
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

  it('quotes a whole album or one photo of it with a thumbnail', async () => {
    const { riya, arjun, id } = await pair();
    const files = [await readyMedia(riya.id, 'image'), await readyMedia(riya.id, 'video')];
    const album = await send(riya, id, { media_ids: files.map((f) => f.id) });

    const whole = await send(arjun, id, { body: 'nice', reply_to_id: album.body.id });
    expect(whole.body.reply_to_index).toBeNull();
    expect(whole.body.reply_to.media).toMatchObject({ kind: 'image', count: 2 });
    expect(whole.body.reply_to.media.url).toContain(files[0]!.key);
    expect(whole.body.reply_to.media.stack.map((c: { kind: string }) => c.kind)).toEqual([
      'image',
      'video',
    ]);

    const one = await send(arjun, id, {
      body: 'this one',
      reply_to_id: album.body.id,
      reply_to_index: 1,
    });
    expect(one.body.reply_to_index).toBe(1);
    expect(one.body.reply_to.media).toMatchObject({ kind: 'video', count: 1, next_url: null });
    expect(one.body.reply_to.media.url).toContain(files[1]!.key);

    const outOfRange = await send(arjun, id, {
      body: '?',
      reply_to_id: album.body.id,
      reply_to_index: 5,
    });
    expect(outOfRange.body.reply_to_index).toBeNull();

    await api(riya).delete(`/conversations/${id}/messages/${album.body.id}`);
    const page = await api(arjun).get(`/conversations/${id}/messages`);
    expect(page.body.data[0].reply_to.media).toBeNull();
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