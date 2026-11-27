import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byScore, parseRef, refOf, suggestion, uniqueByRef } from './discover.ts'

test('refs: a TMDB film or series, and back', () => {
  assert.equal(refOf('movie', 603), 'tmdb:movie:603')
  assert.deepEqual(parseRef('tmdb:tv:1399'), { kind: 'tv', id: 1399 })
  assert.equal(parseRef('tmdb:person:1'), undefined)
  assert.equal(parseRef('mb:release-group:abc'), undefined)
  assert.equal(parseRef('tmdb:movie:603/x'), undefined)
})

test('suggestion: a film or a series from TMDB; a score only from enough votes', () => {
  const film = suggestion(
    { id: 603, title: 'The Matrix', release_date: '1999-03-31', vote_average: 8.2149, vote_count: 26000, poster_path: '/m.jpg', backdrop_path: null, genre_ids: [28, 878, 1] },
    'movie',
    'Because',
  )
  assert.deepEqual(film, {
    ref: 'tmdb:movie:603',
    kind: 'movie',
    tmdbId: 603,
    title: 'The Matrix',
    year: '1999',
    date: '1999-03-31',
    score: 8.2,
    votes: 26000,
    overview: '',
    genres: ['Action', 'Science Fiction'],
    poster: '/m.jpg',
    backdrop: undefined,
    why: 'Because',
  })
  const series = suggestion({ id: 1, name: 'New Show', first_air_date: '', vote_average: 9, vote_count: 3 }, 'tv', '')
  assert.equal(series.title, 'New Show')
  assert.equal(series.date, undefined)
  assert.equal(series.year, '')
  assert.equal(series.score, undefined, 'three votes say little')
  assert.deepEqual(series.genres, [])
  const details = suggestion({ id: 2, title: 'B', genres: [{ id: 18, name: 'Drama' }] }, 'movie', '')
  assert.deepEqual(details.genres, ['Drama'], "a title's details name its genres")
})

test('byScore: the best scored first; of the same score, the more voted for; no score last', () => {
  const s = (id: number, score: number, votes: number) =>
    suggestion({ id, title: `T${id}`, vote_average: score, vote_count: votes }, 'movie', '')
  const sorted = [s(1, 7.5, 3000), s(2, 8.1, 900), s(3, 9, 10), s(4, 7.5, 5600)].sort(byScore)
  assert.deepEqual(
    sorted.map((x) => x.title),
    ['T2', 'T4', 'T1', 'T3'],
  )
})

test('uniqueByRef: each title once, the first time it comes', () => {
  const a = suggestion({ id: 1, title: 'A' }, 'movie', 'first')
  const b = suggestion({ id: 1, title: 'A' }, 'movie', 'second')
  const c = suggestion({ id: 1, name: 'A' }, 'tv', '')
  assert.deepEqual(
    uniqueByRef([a, b, c]).map((s) => [s.ref, s.why]),
    [
      ['tmdb:movie:1', 'first'],
      ['tmdb:tv:1', ''],
    ],
  )
})
