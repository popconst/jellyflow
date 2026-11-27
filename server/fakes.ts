// Stand-ins for the tests: a Jellyfin (a real local HTTP server, as the
// server's Jellyfin client talks HTTP) with one user, a film and a series;
// and TMDB (a fetch that answers from a table) with what Discover asks about
// them. Dates are relative to now, so "coming" stays in the future.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export const TOKEN = 'good-token'
export const AUTH = `MediaBrowser Client="jellyflow", Device="Test", DeviceId="test-1", Version="0.1.0", Token="${TOKEN}"`

const DAY = 86_400_000
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10)
}

export interface FakeJellyfin {
  url: string
  /** Each request's path and query */
  requests: string[]
  close(): Promise<void>
}

/** What the fake Jellyfin says to a logged-in request */
function answerFor(url: URL): unknown {
  if (url.pathname === '/Users/Me') return { Id: 'user-1', Name: 'tester' }
  if (url.pathname !== '/Items') return undefined
  if (url.searchParams.get('includeItemTypes') === 'Movie,Series') {
    return {
      Items: [
        { Id: 'j-dune', Name: 'Dune', Type: 'Movie', ProviderIds: { Tmdb: '438631' }, UserData: { Played: true } },
        { Id: 'j-sev', Name: 'Severance', Type: 'Series', ProviderIds: { Tmdb: '95396' }, UserData: {} },
        { Id: 'j-course', Name: 'A Course', Type: 'Series', UserData: {} },
      ],
    }
  }
  if (url.searchParams.get('sortBy') === 'DatePlayed') {
    const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
    return {
      Items: [
        { Id: 'j-ep', Name: 'Hello, Ms. Cobel', Type: 'Episode', SeriesId: 'j-sev', UserData: { LastPlayedDate: ago(1) } },
        { Id: 'j-dune', Name: 'Dune', Type: 'Movie', UserData: { LastPlayedDate: ago(5) } },
      ],
    }
  }
  return undefined
}

/** Jellyfin with user "tester": the film Dune (watched) and the series Severance (an episode watched lately) */
export async function fakeJellyfin(): Promise<FakeJellyfin> {
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? '')
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!req.headers.authorization?.includes(`Token="${TOKEN}"`)) {
      res.writeHead(401).end()
      return
    }
    const answer = answerFor(url)
    if (answer === undefined) res.writeHead(404).end()
    else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

/** What TMDB knows about Dune and Severance, their people, and the lists; a few series worth starting */
export function tmdbAnswers(): Record<string, unknown> {
  const page = (results: unknown[]) => ({ page: 1, total_pages: 1, total_results: results.length, results })
  return {
    '/movie/438631/credits': {
      cast: [
        { id: 10, name: 'Timothée Chalamet', order: 0 },
        { id: 11, name: 'Zendaya', order: 1 },
        { id: 12, name: 'An Extra', order: 30 },
      ],
      crew: [{ id: 1, name: 'Denis Villeneuve', job: 'Director' }],
    },
    '/tv/95396/aggregate_credits': { cast: [{ id: 20, name: 'Adam Scott', order: 0 }] },
    '/person/1/combined_credits': {
      cast: [],
      crew: [
        { id: 900, media_type: 'movie', title: 'Dune: Part Three', release_date: daysFromNow(200), job: 'Director' },
        { id: 901, media_type: 'movie', title: 'Prisoners', release_date: '2013-09-20', job: 'Director' },
      ],
    },
    '/person/10/combined_credits': {
      cast: [
        { id: 902, media_type: 'movie', title: 'Marty Supreme', release_date: daysFromNow(-30), character: 'Marty', order: 0, vote_average: 7.8, vote_count: 300 },
        { id: 903, media_type: 'tv', name: 'Late Night', first_air_date: daysFromNow(-10), character: 'Self', genre_ids: [10767] },
        { id: 438631, media_type: 'movie', title: 'Dune', release_date: daysFromNow(-20), character: 'Paul', order: 0 },
      ],
      crew: [],
    },
    '/person/11/combined_credits': {
      cast: [{ id: 900, media_type: 'movie', title: 'Dune: Part Three', release_date: daysFromNow(200), character: 'Chani', order: 1 }],
      crew: [],
    },
    '/person/20/combined_credits': { cast: [], crew: [] },
    '/tv/95396/recommendations': page([{ id: 700, name: 'Silo', first_air_date: '2023-05-04', vote_average: 8.1, vote_count: 900 }]),
    '/movie/438631/recommendations': page([
      { id: 800, title: 'Blade Runner 2049', release_date: '2017-10-04', vote_average: 7.6, vote_count: 14000 },
      { id: 438631, title: 'Dune', release_date: '2021-09-15' },
    ]),
    '/tv/95396': {
      id: 95396,
      name: 'Severance',
      first_air_date: '2022-02-18',
      status: 'Returning Series',
      number_of_seasons: 3,
      next_episode_to_air: { air_date: daysFromNow(40), season_number: 3, episode_number: 1 },
      last_episode_to_air: { air_date: '2025-03-20', season_number: 2, episode_number: 10 },
    },
    // series on this year, last year, or in 2013; how many seasons, and when last on, only in their details
    '/discover/tv': (url: URL) => {
      const year = Number(url.searchParams.get('air_date.gte')?.slice(0, 4))
      const thisYear = new Date().getFullYear()
      const on: Record<number, { id: number }[]> = {
        [thisYear]: [{ id: 1396 }, { id: 42009 }, { id: 95396 }],
        [thisYear - 1]: [{ id: 42009 }, { id: 1399 }, { id: 92685 }],
        2013: [{ id: 1396 }],
      }
      return page(on[year] ?? [])
    },
    '/tv/1396': { id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', last_air_date: '2013-09-29', number_of_seasons: 5, status: 'Ended', vote_average: 8.9, vote_count: 19000 },
    '/tv/42009': {
      id: 42009,
      name: 'Black Mirror',
      first_air_date: '2011-12-04',
      last_air_date: daysFromNow(0),
      last_episode_to_air: { air_date: daysFromNow(0), season_number: 7, episode_number: 6 },
      number_of_seasons: 7,
      status: 'Returning Series',
      vote_average: 8.3,
      vote_count: 6700,
    },
    '/tv/1399': { id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17', last_air_date: `${new Date().getFullYear() - 1}-05-19`, number_of_seasons: 8, status: 'Ended', vote_average: 8.5, vote_count: 28000 },
    '/tv/92685': { id: 92685, name: 'Heartstopper', first_air_date: '2022-04-22', last_air_date: `${new Date().getFullYear() - 1}-10-03`, number_of_seasons: 3, status: 'Canceled', vote_average: 8.6, vote_count: 3000 },
    // the year's best, or (asked by release date) what's coming
    '/discover/movie': (url: URL) =>
      url.searchParams.has('primary_release_date.gte')
        ? page([
            { id: 803, title: 'Later', release_date: daysFromNow(60) },
            { id: 804, title: 'Already Out', release_date: daysFromNow(-60) },
            { id: 805, title: 'Sooner', release_date: daysFromNow(10) },
          ])
        : page([
            { id: 801, title: 'Sinners', release_date: '2025-04-16', vote_average: 7.5, vote_count: 5600 },
            { id: 808, title: 'One Battle After Another', release_date: '2025-09-23', vote_average: 7.9, vote_count: 2500 },
            { id: 809, title: 'Weapons', release_date: '2025-08-04', vote_average: 7.5, vote_count: 3000 },
          ]),
    '/search/multi': (url: URL) =>
      url.searchParams.get('query') === 'dune'
        ? page([
            { id: 438631, media_type: 'movie', title: 'Dune', release_date: '2021-09-15', vote_average: 7.8, vote_count: 14000 },
            { id: 1, media_type: 'person', name: 'Denis Villeneuve' },
            { id: 90228, media_type: 'tv', name: 'Dune: Prophecy', first_air_date: '2024-11-17', vote_average: 7.3, vote_count: 400 },
          ])
        : page([]),
    '/movie/now_playing': page([{ id: 802, title: 'In Cinemas', release_date: daysFromNow(-5) }]),
    '/trending/all/week': page([
      { id: 806, media_type: 'movie', title: 'Trending Film', release_date: '2026-01-01' },
      { id: 30, media_type: 'person', name: 'Somebody' },
      { id: 807, media_type: 'tv', name: 'Trending Series', first_air_date: '2026-02-01' },
    ]),
    '/movie/603': { id: 603, title: 'The Matrix', release_date: '1999-03-31', vote_average: 8.2, vote_count: 26000, poster_path: '/matrix.jpg' },
    '/movie/800': { id: 800, title: 'Blade Runner 2049', release_date: '2017-10-04', vote_average: 7.6, vote_count: 14000 },
  }
}

export interface FakeTmdb {
  fetcher: typeof fetch
  /** Each request's path and query, as TMDB would see it */
  calls: string[]
}

/** TMDB answering from `answers` (by path; an answer may depend on the query); TMDB's images answer with three bytes */
export function fakeTmdb(answers: Record<string, unknown> = tmdbAnswers()): FakeTmdb {
  const calls: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === 'image.tmdb.org') {
      calls.push(url.pathname)
      return url.pathname.endsWith('/gone.jpg')
        ? new Response('', { status: 404 })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } })
    }
    const path = url.pathname.replace(/^\/3/, '')
    calls.push(path + url.search)
    const answer = answers[path]
    const body: unknown = typeof answer === 'function' ? (answer as (url: URL) => unknown)(url) : answer
    return body === undefined ? new Response('{"status_message":"Not found"}', { status: 404 }) : Response.json(body)
  }) as typeof fetch
  return { fetcher, calls }
}
