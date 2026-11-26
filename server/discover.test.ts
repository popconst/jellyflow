import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Store } from './db.ts'
import { ALL, discover, newWorkOf, peopleOf } from './discover.ts'
import { daysFromNow, fakeTmdb, tmdbAnswers } from './fakes.ts'
import type { Library, Owned } from './library.ts'
import { Tmdb } from './tmdb.ts'

const dune: Owned = { kind: 'movie', tmdbId: 438631, id: 'j-dune', title: 'Dune', played: true }
const severance: Owned = { kind: 'tv', tmdbId: 95396, id: 'j-sev', title: 'Severance', played: true }
const library: Library = {
  owned: new Map([
    ['tmdb:movie:438631', 'j-dune'],
    ['tmdb:tv:95396', 'j-sev'],
  ]),
  titles: [dune, severance],
  recent: [severance, dune],
}

test("peopleOf: a film's director weighs most, then its leads; twice for what was watched", () => {
  const unwatched = { ...dune, played: false }
  const people = peopleOf([
    {
      title: unwatched,
      movie: {
        crew: [
          { id: 1, name: 'Director', job: 'Director' },
          { id: 9, name: 'Composer', job: 'Original Music Composer' },
        ],
        cast: [
          { id: 2, name: 'Lead', order: 0 },
          { id: 3, name: 'Fourth', order: 3 },
          { id: 4, name: 'Extra', order: 20 },
        ],
      },
    },
    { title: severance, tv: { cast: [{ id: 3, name: 'Fourth', order: 0 }] } },
  ])
  assert.deepEqual(
    people.map((p) => [p.name, p.weight, p.directs]),
    [
      ['Director', 3, true],
      ['Fourth', 3, false],
      ['Lead', 2, false],
    ],
  )
})

test('newWorkOf: directed, or a part played, out lately or coming; not as themselves, in documentaries or small parts', () => {
  const since = '2026-01-01'
  const work = newWorkOf(
    {
      crew: [
        { id: 1, media_type: 'movie', title: 'Directed', release_date: '2026-06-01', job: 'Director' },
        { id: 2, media_type: 'movie', title: 'Produced', release_date: '2026-06-01', job: 'Producer' },
        { id: 3, media_type: 'movie', title: 'Directed Long Ago', release_date: '2001-01-01', job: 'Director' },
      ],
      cast: [
        { id: 4, media_type: 'tv', name: 'A Series', first_air_date: '2026-03-01', character: 'Ann' },
        { id: 5, media_type: 'tv', name: 'Talk', first_air_date: '2026-03-01', character: 'Guest', genre_ids: [10767] },
        { id: 6, media_type: 'movie', title: 'About Them', release_date: '2026-03-01', character: 'Herself' },
        { id: 9, media_type: 'movie', title: 'A Documentary', release_date: '2026-03-01', character: '', genre_ids: [99] },
        { id: 7, media_type: 'movie', title: 'Cameo', release_date: '2026-03-01', character: 'Man', order: 25 },
        { id: 8, media_type: 'movie', title: 'No Date Yet', character: 'Ann' },
      ],
    },
    since,
  )
  assert.deepEqual(
    work.map((w) => [w.title.id, w.role]),
    [
      [1, 'directed'],
      [4, 'with'],
    ],
  )
})

test('discover: what Discover shows for now, the best series and films of this year and the three before (the empty left out)', async () => {
  const tmdb = new Tmdb('token', new Store(':memory:'), fakeTmdb().fetcher)
  const lists = await discover(tmdb, library)
  const year = new Date().getFullYear()
  assert.deepEqual(
    lists.map((l) => [l.key, l.name]),
    [
      [`series:${year}`, `Best series of ${year}`],
      [`series:${year - 1}`, `Best series of ${year - 1}`],
      ...[0, 1, 2, 3].map((i) => [`best:${year - i}`, `Best films of ${year - i}`]),
    ],
  )
})

test("discover: a year's best series, 3 seasons out or more, in the year they were last on, the best scored first", async () => {
  const fake = fakeTmdb()
  const tmdb = new Tmdb('token', new Store(':memory:'), fake.fetcher)
  const lists = await discover(tmdb, library, ['series'])
  const year = new Date().getFullYear()
  const list = (y: number) => lists.find((l) => l.key === `series:${y}`)?.items.map((s) => [s.title, s.kind, s.why]) ?? []
  assert.deepEqual(list(year), [['Black Mirror', 'tv', '7 seasons so far']], "Breaking Bad was last on long ago; Severance's third is still to come")
  assert.deepEqual(
    list(year - 1),
    [
      ['Heartstopper', 'tv', `3 seasons, cancelled ${year - 1}`],
      ['Game of Thrones', 'tv', `8 seasons, ended ${year - 1}`],
    ],
    'Black Mirror is on this year',
  )
  const asked = fake.calls.find((c) => c.startsWith('/discover/tv?') && c.includes(`air_date.gte=${year}-01-01`))
  assert.match(asked ?? '', new RegExp(`air_date\\.lte=${year}-12-31`))
  assert.match(asked ?? '', /sort_by=vote_count\.desc/)
  assert.match(asked ?? '', /vote_average\.gte=7\.5/)
  assert.match(asked ?? '', /without_genres=10763%2C10764%2C10766%2C10767/)
  assert.equal(fake.calls.filter((c) => c === '/tv/42009').length, 1, 'Black Mirror, on both years, is asked about once')
})

test('discover: every kind of list, in order, without what the library has', async (t) => {
  t.mock.method(console, 'error', () => undefined)
  const tmdb = new Tmdb('token', new Store(':memory:'), fakeTmdb().fetcher)
  const lists = await discover(tmdb, library, ALL)
  const year = new Date().getFullYear()
  assert.deepEqual(
    lists.map((l) => l.key),
    ['people', 'because:tv:95396', 'because:movie:438631', 'shows', `series:${year}`, `series:${year - 1}`, ...[0, 1, 2, 3].map((i) => `best:${year - i}`), 'cinema', 'upcoming', 'trending'],
  )
  const list = (key: string) => lists.find((l) => l.key === key)?.items ?? []
  assert.deepEqual(
    list('people').map((s) => [s.title, s.why]),
    [
      ['Marty Supreme', 'With Timothée Chalamet'],
      ['Dune: Part Three', 'Directed by Denis Villeneuve · With Zendaya'],
    ],
  )
  assert.deepEqual(
    list('because:movie:438631').map((s) => [s.title, s.why]),
    [['Blade Runner 2049', 'Because you watched Dune']],
  )
  assert.equal(lists.find((l) => l.key === 'because:tv:95396')?.name, 'Because you watched Severance')
  assert.deepEqual(
    list('shows').map((s) => [s.title, s.why, s.date]),
    [['Severance', 'Next: S3E1', daysFromNow(40)]],
  )
  assert.deepEqual(
    list('upcoming').map((s) => s.title),
    ['Sooner', 'Later'],
  )
  assert.deepEqual(
    list('trending').map((s) => [s.title, s.kind]),
    [
      ['Trending Film', 'movie'],
      ['Trending Series', 'tv'],
    ],
  )
})

test("discover: a list TMDB can't answer is left out, the rest come", async (t) => {
  const errors = t.mock.method(console, 'error', () => undefined)
  const answers = tmdbAnswers()
  delete answers['/movie/now_playing']
  const tmdb = new Tmdb('token', new Store(':memory:'), fakeTmdb(answers).fetcher)
  const keys = (await discover(tmdb, library, ALL)).map((l) => l.key)
  assert.ok(!keys.includes('cinema'))
  assert.ok(keys.includes('upcoming'))
  assert.equal(errors.mock.callCount(), 1)
})

test('discover: an empty library still has the lists for everyone', async () => {
  const tmdb = new Tmdb('token', new Store(':memory:'), fakeTmdb().fetcher)
  const keys = (await discover(tmdb, { owned: new Map(), titles: [], recent: [] }, ALL)).map((l) => l.key)
  assert.deepEqual(keys.slice(-3), ['cinema', 'upcoming', 'trending'])
  assert.ok(!keys.includes('people') && !keys.includes('shows'))
})
