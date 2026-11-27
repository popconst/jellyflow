// TMDB for a Node server, no dependencies:
// - Tmdb: its API, with a read access token the browser never sees. Only
//   what's allowed is asked (paths, each with how long its answer is kept),
//   so the page's requests can be passed through; answers are kept in a
//   cache (TmdbCache: a database's table, a Map); a few requests at a time,
//   the same one asked once, TMDB's rate limit waited out.
// - Images: its posters and backdrops, fetched once and kept on disk, then
//   served whole from there.
//
//   const tmdb = new Tmdb({ token, cache, allowed: [[/^\/movie\/\d+$/, 86_400_000]] })
//   const film = await tmdb.get<{ title: string }>('/movie/603')
//   const poster = await new Images('/var/cache/posters').get('w342', 'abc.jpg')

export { keptFor, requestKey, Tmdb, TmdbError, type Allowed, type Query, type TmdbCache, type TmdbOptions } from './client.ts'
export { Images, type Image } from './images.ts'
