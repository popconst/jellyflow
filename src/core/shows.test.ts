import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Item } from '../lib/jellyfin/index.ts'
import { toMovie } from './movies.ts'
import { filmChoices, seriesChoice } from './page.ts'
import { fold } from './search.ts'
import { categoryOf, continuing, inWatch, searchShelf, shelves, watchingOf, type Library } from './shelves.ts'
import { episodeCode, episodesFrom, lastWatched, nextEpisode, seasonsOf, toShow, upNext } from './shows.ts'
import { filterTitles, status } from './titles.ts'

const MIN = 60 * 10_000_000
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}T12:00:00Z`

const series = (id: string, name: string, extra: Partial<Item> = {}): Item => ({ Id: id, Name: name, Type: 'Series', ...extra })

/** S{season}E{number}, 22 minutes, with what was done with it */
const ep = (season: number, number: number, data: { played?: boolean; at?: number; on?: number } = {}): Item => ({
  Id: `e${season}.${number}`,
  Name: `Episode ${number}`,
  Type: 'Episode',
  SeriesId: 's',
  ParentIndexNumber: season,
  IndexNumber: number,
  RunTimeTicks: 22 * MIN,
  UserData: {
    Played: data.played ?? false,
    PlaybackPositionTicks: (data.at ?? 0) * MIN,
    ...(data.on ? { LastPlayedDate: day(data.on) } : {}),
  },
})

test('series: years running or ended, newest content first', () => {
  const office = toShow(series('o', 'The Office', { ProductionYear: 2005, EndDate: '2013-05-16T00:00:00Z', Status: 'Ended', DateCreated: day(1), DateLastMediaAdded: day(9) }))
  assert.equal(office.year, '2005–2013')
  assert.equal(office.added, Date.parse(day(9)))
  assert.equal(toShow(series('p', 'Paddington', { ProductionYear: 2019, Status: 'Continuing' })).year, '2019–')
  assert.equal(toShow(series('m', 'Mini', { ProductionYear: 2020, EndDate: '2020-12-01T00:00:00Z' })).year, '2020')
  assert.equal(toShow(series('c', 'A course')).year, '')
})

test('episodes: by season and number, specials last; codes and seasons', () => {
  const list = episodesFrom([ep(2, 1), ep(0, 1), ep(1, 2), ep(1, 1)])
  assert.deepEqual(
    list.map(episodeCode),
    ['S1:E1', 'S1:E2', 'S2:E1', 'Special 1'],
  )
  assert.deepEqual(
    seasonsOf(list).map((s) => `${s.name}:${s.episodes.length}`),
    ['Season 1:2', 'Season 2:1', 'Specials:1'],
  )
})

test('up next: where to pick a series up', () => {
  // never watched: the first episode (not a special)
  assert.equal(upNext(episodesFrom([ep(0, 1), ep(1, 1), ep(1, 2)]))?.episode.id, 'e1.1')
  // stopped partway through the one watched last: resume it
  const partway = upNext(episodesFrom([ep(1, 1, { played: true, on: 1 }), ep(1, 2, { at: 7, on: 2 }), ep(1, 3)]))
  assert.equal(partway?.episode.id, 'e1.2')
  assert.equal(partway?.resume, true)
  // watched one to the end since: the one after it, even past an older one stopped partway
  const after = upNext(episodesFrom([ep(1, 1, { at: 5, on: 1 }), ep(1, 2, { played: true, on: 3 }), ep(1, 3), ep(2, 1)]))
  assert.equal(after?.episode.id, 'e1.3')
  assert.equal(after?.resume, false)
  assert.equal(after?.started, true)
  // into the next season; past ones watched already; specials skipped
  assert.equal(upNext(episodesFrom([ep(1, 1, { played: true, on: 2 }), ep(2, 1, { played: true, on: 1 }), ep(2, 2), ep(0, 1)]))?.episode.id, 'e2.2')
  // the last one watched: back to the first not watched
  assert.equal(upNext(episodesFrom([ep(1, 1), ep(1, 2, { played: true, on: 4 })]))?.episode.id, 'e1.1')
  // all watched: nothing
  assert.equal(upNext(episodesFrom([ep(1, 1, { played: true, on: 1 }), ep(1, 2, { played: true, on: 2 })])), undefined)
  assert.equal(lastWatched(episodesFrom([ep(1, 1, { played: true, on: 1 }), ep(1, 2, { at: 3, on: 6 }), ep(1, 3)])), Date.parse(day(6)))
})

const film = (id: string, genres: string[], added: number, data: Item['UserData'] = {}, rating?: string): Item => ({
  Id: id,
  Name: id,
  Type: 'Movie',
  Genres: genres,
  ...(rating ? { OfficialRating: rating } : {}),
  DateCreated: day(added),
  RunTimeTicks: 100 * MIN,
  UserData: data,
})

test('rows: films then series newest first, then six genre rows with each title in one; courses not in Watch', () => {
  const films: Library = {
    id: 'films',
    name: 'Movies',
    kind: 'movies',
    titles: [
      film('cars', ['Animation', 'Family', 'Comedy'], 1, {}, 'G'),
      film('up', ['Animation', 'Adventure'], 3, {}, 'PG-13'),
      film('heat', ['Crime', 'Drama', 'Thriller'], 2, {}, 'R'),
      film('alien', ['Horror', 'Science Fiction'], 4, {}, 'R'),
      film('free solo', ['Documentary'], 5, {}, 'PG-13'),
      film('love', ['Romance'], 6, {}, 'R'),
      // an old family musical, unrated: for kids; a family action film rated PG-13: not
      film('veronica', ['Family', 'Fantasy', 'Music'], 7),
      film('plan', ['Action', 'Comedy', 'Family'], 8, {}, 'PG-13'),
    ].map(toMovie),
  }
  const shows: Library = {
    id: 'shows',
    name: 'Shows',
    kind: 'tvshows',
    titles: [
      toShow(series('fog', 'Willy Fog', { Genres: ['Animation', 'Action & Adventure', 'Kids'], DateCreated: day(5) })),
      toShow(series('chef', 'MasterChef', { Genres: ['Reality'], DateCreated: day(7) })),
    ],
  }
  const courses: Library = { id: 'courses', name: 'Courses', kind: 'tvshows', titles: [toShow(series('poker', 'Poker', { DateCreated: day(9) }))] }
  assert.deepEqual(
    [shows, courses, films].filter(inWatch).map((l) => l.id),
    ['shows', 'films'],
  )
  assert.equal(categoryOf(shows.titles[1]!), undefined)
  const rows = shelves([shows, films])
  assert.deepEqual(
    rows.map((r) => `${r.name}: ${r.tiles.map((t) => t.id).join(', ')}`),
    [
      'Movies: plan, veronica, love, free solo, alien, up, heat, cars',
      'Shows: chef, fog',
      'Documentaries: free solo',
      // a cartoon for all ages and a children's series
      'Kids: veronica, fog, cars',
      // up: no big genre (PG-13: not for kids), Adventure is nearest Action
      'Action: plan, up',
      // heat: Crime is a small genre, Drama the first big one in its list; alien: Horror's nearest is Thriller
      'Drama: love, heat',
      'Thriller: alien',
    ],
  )
  // the same titles: the same tiles, so the rows keep their covers
  assert.equal(shelves([shows, films])[0]!.tiles[0], rows[0]!.tiles[0])
  assert.deepEqual(
    searchShelf([...films.titles, ...shows.titles], 'fog').tiles.map((t) => t.id),
    ['fog'],
  )
})

test('continue watching: latest first; one taken off stays off until it is watched again', () => {
  const movies = [
    film('cars', [], 1, { PlaybackPositionTicks: 30 * MIN, LastPlayedDate: day(3) }),
    film('up', [], 1, { PlaybackPositionTicks: 0, Played: true, LastPlayedDate: day(8) }),
    film('heat', [], 1, { PlaybackPositionTicks: 10 * MIN, LastPlayedDate: day(5) }),
  ].map(toMovie)
  const show = toShow(series('fog', 'Willy Fog', { UserData: { UnplayedItemCount: 24 } }))
  const watching = watchingOf(show, episodesFrom([ep(1, 1, { played: true, on: 4 }), ep(1, 2)]))
  assert.equal(watching?.episode.id, 'e1.2')
  assert.equal(watchingOf(show, episodesFrom([ep(1, 1)])), undefined)
  assert.deepEqual(
    continuing(movies, [watching!], {}).map((t) => t.id),
    ['heat', 'fog', 'cars'],
  )
  // taken off when last watched on the 5th: off; watched since (the 6th): back
  assert.deepEqual(
    continuing(movies, [watching!], { heat: Date.parse(day(5)) }).map((t) => t.id),
    ['fog', 'cars'],
  )
  assert.deepEqual(
    continuing(movies, [watching!], { heat: Date.parse(day(4)) }).map((t) => t.id),
    ['heat', 'fog', 'cars'],
  )
  assert.equal(status(show), '24 to watch')
  assert.equal(status(movies[1]!), 'watched')
})

test('page: what a film or a series offers to play', () => {
  const [cars, up] = [
    film('cars', [], 1, { PlaybackPositionTicks: 30 * MIN }),
    film('up', [], 1, { Played: true }),
  ].map(toMovie)
  assert.deepEqual(
    filmChoices(cars!).map((c) => `${c.label} @${c.at}`),
    ['Resume from 30:00 @1800', 'Play from the beginning @0'],
  )
  assert.deepEqual(
    filmChoices(up!).map((c) => c.label),
    ['Play again'],
  )
  const list = episodesFrom([ep(1, 1, { played: true, on: 1 }), ep(1, 2, { at: 5, on: 2 }), ep(1, 3), ep(0, 1)])
  assert.equal(seriesChoice(list)?.label, 'Resume S1:E2')
  assert.equal(seriesChoice(list)?.at, 300)
  assert.equal(seriesChoice(episodesFrom([ep(1, 1, { played: true, on: 1 }), ep(1, 2)]))?.label, 'Next S1:E2')
  assert.equal(seriesChoice(episodesFrom([ep(1, 1, { played: true, on: 1 })]))?.label, 'Watch again from S1:E1')
  // the episode after: the next in order, past the specials
  assert.equal(nextEpisode(list, 'e1.3'), undefined)
  assert.equal(nextEpisode(list, 'e1.2')?.id, 'e1.3')
})

test('search: accents and case don’t matter', () => {
  const leon = toMovie({ ...film('leon', ['Crime'], 1), Name: 'Léon: The Professional' })
  assert.equal(filterTitles([leon], 'leon').length, 1)
  assert.equal(filterTitles([leon], 'LÉON pro').length, 1)
  assert.equal(fold('Björk Știrile Ølstykke Straße'), 'bjork stirile olstykke strasse')
})
