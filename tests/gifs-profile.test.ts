import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../src/config/env';
import { clearGifCache } from '../src/modules/gifs/gifs.service';
import { api, app, person, socketFor, connected, useChatHarness } from './chatHarness';

useChatHarness();

const giphyGif = (id: string) => ({
  id,
  title: `gif ${id}`,
  images: {
    fixed_width: {
      url: `https://media1.giphy.com/media/${id}/200w.gif?cid=tracking&rid=200w.gif`,
      width: '200',
      height: '120',
    },
    fixed_width_downsampled: {
      url: `https://media1.giphy.com/media/${id}/200w_d.gif?cid=tracking`,
      width: '200',
      height: '120',
    },
  },
});

const giphyResponse = (ids: string[], offset = 0, total = 100) =>
  new Response(
    JSON.stringify({
      data: ids.map(giphyGif),
      pagination: { total_count: total, count: ids.length, offset },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('GIF proxy', () => {
  const originalKey = env.GIPHY_API_KEY;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearGifCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    (env as { GIPHY_API_KEY?: string }).GIPHY_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (env as { GIPHY_API_KEY?: string }).GIPHY_API_KEY = originalKey;
  });

  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/gifs/trending')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when no GIPHY key is configured', async () => {
    (env as { GIPHY_API_KEY?: string }).GIPHY_API_KEY = undefined;
    const riya = await person('riya.writes');
    const res = await api(riya).get('/gifs/trending');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GIFS_NOT_CONFIGURED');
  });

  it('normalizes results, strips tracking params and pages with an offset cursor', async () => {
    fetchMock.mockResolvedValueOnce(giphyResponse(['a1', 'b2'], 0, 10));
    const riya = await person('riya.writes');
    const res = await api(riya).get('/gifs/search?q=cats&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual({
      id: 'a1',
      title: 'gif a1',
      url: 'https://media1.giphy.com/media/a1/200w.gif',
      preview_url: 'https://media1.giphy.com/media/a1/200w_d.gif',
      width: 200,
      height: 120,
    });
    expect(res.body.pagination).toEqual({ next_cursor: '2', has_more: true });

    const calledUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(calledUrl.pathname).toBe('/v1/gifs/search');
    expect(calledUrl.searchParams.get('q')).toBe('cats');
    expect(calledUrl.searchParams.get('api_key')).toBe('test-key');
    expect(calledUrl.searchParams.get('rating')).toBe(env.GIPHY_RATING);
    // The key never reaches the client.
    expect(JSON.stringify(res.body)).not.toContain('test-key');
  });

  it('produced URLs are accepted when sending a GIF message', async () => {
    fetchMock.mockResolvedValueOnce(giphyResponse(['z9']));
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    const gif = (await api(riya).get('/gifs/search?q=hi')).body.data[0];
    const convo = (await api(riya).post('/conversations', { participant_ids: [arjun.id] })).body.id;
    const sent = await api(riya).post(`/conversations/${convo}/messages`, {
      client_message_id: crypto.randomUUID(),
      gif,
    });
    expect(sent.status).toBe(201);
  });

  it('caches trending pages', async () => {
    fetchMock.mockImplementation(async () => giphyResponse(['t1']));
    const riya = await person('riya.writes');
    await api(riya).get('/gifs/trending');
    await api(riya).get('/gifs/trending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await api(riya).get('/gifs/trending?cursor=24');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves stickers from GIPHY stickers endpoints with a separate cache', async () => {
    fetchMock.mockImplementation(async () => giphyResponse(['s1']));
    const riya = await person('riya.writes');

    const trendingGifs = await api(riya).get('/gifs/trending');
    const trendingStickers = await api(riya).get('/gifs/trending?type=sticker');
    expect(trendingGifs.status).toBe(200);
    expect(trendingStickers.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1]![0])).pathname).toBe('/v1/stickers/trending');

    await api(riya).get('/gifs/trending?type=sticker');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await api(riya).get('/gifs/search?q=love&type=sticker');
    expect(new URL(String(fetchMock.mock.calls[2]![0])).pathname).toBe('/v1/stickers/search');

    expect((await api(riya).get('/gifs/trending?type=emoji')).status).toBe(400);
  });

  it('marks the last page and skips GIFs without renditions', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [giphyGif('ok'), { id: 'broken', images: {} }],
          pagination: { total_count: 2, count: 2, offset: 0 },
        }),
      ),
    );
    const riya = await person('riya.writes');
    const res = await api(riya).get('/gifs/search?q=x');
    expect(res.body.data.map((g: { id: string }) => g.id)).toEqual(['ok']);
    expect(res.body.pagination).toEqual({ next_cursor: null, has_more: false });
  });

  it('maps upstream failures to 502 and validates the query', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const riya = await person('riya.writes');
    const failed = await api(riya).get('/gifs/search?q=x');
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('GIFS_UNAVAILABLE');

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect((await api(riya).get('/gifs/trending')).status).toBe(502);

    expect((await api(riya).get('/gifs/search')).status).toBe(400);
    expect((await api(riya).get(`/gifs/search?q=${'x'.repeat(51)}`)).status).toBe(400);
    expect((await api(riya).get('/gifs/trending?limit=999')).status).toBe(400);
  });
});

describe('public profile', () => {
  it('requires auth and validates the username', async () => {
    expect((await request(app).get('/api/v1/users/by-username/riya')).status).toBe(401);
    const riya = await person('riya.writes');
    expect((await api(riya).get('/users/by-username/bad%20name!')).status).toBe(404);
  });

  it('marks my own profile and hides private fields', async () => {
    const riya = await person('riya.writes', { bio: 'hello there' });
    const res = await api(riya).get('/users/by-username/riya.writes');
    expect(res.body).toMatchObject({ is_self: true, bio: 'hello there' });
    for (const field of ['email', 'password_hash', 'date_of_birth', 'gender', 'role']) {
      expect(res.body).not.toHaveProperty(field);
    }
  });

  it('reports private accounts and hides disabled ones', async () => {
    const riya = await person('riya.writes');
    await person('secret.one', { is_private: true });
    await person('gone.user', { status: 'disabled' });
    expect((await api(riya).get('/users/by-username/secret.one')).body.is_private).toBe(true);
    expect((await api(riya).get('/users/by-username/gone.user')).status).toBe(404);
  });

  it('shows live presence', async () => {
    const riya = await person('riya.writes');
    const arjun = await person('arjun.k');
    await connected(socketFor(arjun));
    const res = await api(riya).get('/users/by-username/arjun.k');
    expect(res.body.presence.online).toBe(true);
  });
});
