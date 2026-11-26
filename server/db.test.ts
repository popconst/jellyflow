import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { suggestion } from '../src/core/discover.ts'
import { Store } from './db.ts'

const matrix = suggestion({ id: 603, title: 'The Matrix', release_date: '1999-03-31' }, 'movie', '')
const silo = suggestion({ id: 700, name: 'Silo', first_air_date: '2023-05-04' }, 'tv', '')

test('the database is made where asked, and opening it again keeps what is in it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jellyflow-db-'))
  try {
    const path = join(dir, 'deeper', 'jellyflow.db')
    const first = new Store(path)
    first.wish('u1', matrix, 1000)
    first.close()
    const again = new Store(path)
    assert.deepEqual(
      again.wishlist('u1').map((w) => w.item.ref),
      ['tmdb:movie:603'],
    )
    again.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('not interested: per user, the latest first; off the wishlist; wished for again, interesting again', () => {
  const store = new Store(':memory:')
  store.wish('u1', matrix, 1000)
  store.dismiss('u1', matrix.ref, 2000)
  store.dismiss('u1', silo.ref, 3000)
  store.dismiss('u1', silo.ref, 4000)
  assert.deepEqual(store.dismissed('u1'), [silo.ref, matrix.ref])
  assert.deepEqual(store.wishlist('u1'), [], 'not interested: off the wishlist')
  assert.deepEqual(store.dismissed('u2'), [])
  store.wish('u1', matrix, 5000)
  assert.deepEqual(store.dismissed('u1'), [silo.ref], 'wished for again')
  assert.equal(store.undismiss('u1', silo.ref), true)
  assert.equal(store.undismiss('u1', silo.ref), false)
  assert.deepEqual(store.dismissed('u1'), [])
})

test("TMDB's answers: found while fresh enough", () => {
  const store = new Store(':memory:')
  store.keepTmdb('/movie/603', '{"id":603}', 5000)
  assert.equal(store.tmdb('/movie/603', 4000), '{"id":603}')
  assert.equal(store.tmdb('/movie/603', 6000), undefined, 'too old')
  assert.equal(store.tmdb('/movie/604', 0), undefined)
  store.keepTmdb('/movie/603', '{"id":603,"new":true}', 7000)
  assert.equal(store.tmdb('/movie/603', 6000), '{"id":603,"new":true}')
})

test('the lists: in order, per user, replaced whole; only if worked out for what is asked', () => {
  const store = new Store(':memory:')
  store.keepLists('u1', 'best', [
    { key: 'people', name: 'People', items: [matrix], computed: 1 },
    { key: 'best:2025', name: 'Best of 2025', items: [silo], computed: 1 },
  ])
  store.keepLists('u2', 'best', [{ key: 'trending', name: 'Trending', items: [], computed: 2 }])
  assert.deepEqual(
    store.lists('u1', 'best').map((l) => [l.key, l.items[0]?.title]),
    [
      ['people', 'The Matrix'],
      ['best:2025', 'Silo'],
    ],
  )
  assert.deepEqual(store.lists('u1', 'people,best'), [], 'worked out for something else')
  store.keepLists('u1', 'best', [{ key: 'cinema', name: 'In cinemas', items: [], computed: 3 }])
  assert.deepEqual(
    store.lists('u1', 'best').map((l) => l.key),
    ['cinema'],
  )
  assert.deepEqual(
    store.lists('u2', 'best').map((l) => l.key),
    ['trending'],
  )
})

test('the wishlist: newest first, per user; added again keeps when, not what was marked', () => {
  const store = new Store(':memory:')
  store.wish('u1', matrix, 1000)
  store.wish('u1', { ...silo, owned: 'j1', wished: true }, 2000)
  store.wish('u2', matrix, 3000)
  assert.deepEqual(
    store.wishlist('u1').map((w) => [w.item.title, w.added]),
    [
      ['Silo', 2000],
      ['The Matrix', 1000],
    ],
  )
  assert.equal(store.wishlist('u1')[0]?.item.owned, undefined, 'what the library has is worked out when asked')
  store.wish('u1', { ...matrix, why: 'again' }, 5000)
  // as JSON keeps it: the fields with no value aren't stored
  assert.deepEqual(store.wishlist('u1')[1], { item: JSON.parse(JSON.stringify({ ...matrix, why: 'again' })), added: 1000 })
  assert.equal(store.unwish('u1', 'tmdb:movie:603'), true)
  assert.equal(store.unwish('u1', 'tmdb:movie:603'), false)
  assert.deepEqual(
    store.wishlist('u2').map((w) => w.item.ref),
    ['tmdb:movie:603'],
  )
})
