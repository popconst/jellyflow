import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Item } from '../lib/jellyfin/index.ts'
import { toMovie } from './movies.ts'
import { filterTitles, imdbUrl, left, progress } from './titles.ts'

const film = (id: string, name: string, sort: string, year: number, genres: string[], extra: Partial<Item> = {}): Item => ({
  Id: id,
  Name: name,
  Type: 'Movie',
  SortName: sort,
  ProductionYear: year,
  Genres: genres,
  RunTimeTicks: 100 * 60 * 10_000_000,
  ...extra,
})

test('films: searchable by title, year and genre, with where they were stopped', () => {
  const movies = [
    film('w', 'Winnie the Pooh', 'Winnie the Pooh', 2011, ['Animation', 'Family']),
    film('l', 'The Lion King', 'Lion King', 1994, ['Animation', 'Drama'], {
      UserData: { PlaybackPositionTicks: 25 * 60 * 10_000_000 },
    }),
    film('c', 'Cars', 'Cars', 2006, ['Animation', 'Comedy'], { OfficialRating: 'G', CommunityRating: 7.3 }),
  ].map(toMovie)
  assert.deepEqual(
    filterTitles(movies, 'animation 199').map((m) => m.id),
    ['l'],
  )
  assert.deepEqual(
    filterTitles(movies, 'POOH').map((m) => m.id),
    ['w'],
  )
  assert.equal(filterTitles(movies, '').length, 3)
  const lion = movies[1]!
  assert.equal(lion.resume, 1500)
  assert.equal(progress(lion), 0.25)
  assert.equal(left(lion), 75 * 60)
  assert.equal(movies[2]!.rating, 'G')
  assert.equal(movies[2]!.sortTitle, 'Cars')
})

test('imdbUrl: a title\'s IMDb page from its id; nothing from anything else', () => {
  assert.equal(imdbUrl('tt0133093'), 'https://www.imdb.com/title/tt0133093/')
  assert.equal(imdbUrl(undefined), undefined)
  assert.equal(imdbUrl(null), undefined)
  assert.equal(imdbUrl(''), undefined)
  assert.equal(imdbUrl('tt0133093/../x'), undefined)
})
