import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorization, Jellyfin } from './client.ts'
import { byDiscAndNumber, compareNames, date, folderName, seconds, ticks } from './items.ts'
import type { Device, Item } from './types.ts'

const device: Device = { client: 'myapp', version: '1.2.3', id: 'd-1', name: 'My "Mac"' }

test("authorization: the app, the device and, once logged in, the token, in Jellyfin's header", () => {
  assert.equal(authorization(device), `MediaBrowser Client="myapp", Device="My 'Mac'", DeviceId="d-1", Version="1.2.3"`)
  assert.match(authorization(device, 'tok'), /, Token="tok"$/)
})

test('urls: the query without what is undefined; the live events over ws(s), with the token', () => {
  const jellyfin = new Jellyfin({ server: 'https://jelly.example.com', token: 'tok', userId: 'u', userName: 'n' }, device)
  assert.equal(jellyfin.url('/Items', { a: 1, b: undefined, c: false }), 'https://jelly.example.com/Items?a=1&c=false')
  const socket = new URL(jellyfin.socketUrl())
  assert.equal(socket.protocol, 'wss:')
  assert.equal(socket.searchParams.get('ApiKey'), 'tok')
  assert.equal(socket.searchParams.get('deviceId'), 'd-1')
  assert.equal(jellyfin.imageUrl('i', 't', 300), 'https://jelly.example.com/Items/i/Images/Primary?tag=t&fillWidth=300&fillHeight=300&quality=90')
})

test('folders: names from the path, natural order', () => {
  assert.equal(folderName({ Id: 'x', Name: 'Kill', Type: 'MusicAlbum', Path: '/m/Metallica/1983 - Kill/' }), '1983 - Kill')
  assert.equal(folderName({ Id: 'x', Name: 'Kill', Type: 'MusicAlbum' }), 'Kill')
  assert.ok(compareNames('Disc 2', 'Disc 10') < 0)
  const track = (disc: number | undefined, n: number, path: string): Item => ({ Id: path, Name: path, Type: 'Audio', ParentIndexNumber: disc, IndexNumber: n, Path: path })
  assert.deepEqual(
    [track(2, 1, 'c'), track(1, 2, 'b'), track(undefined, 1, 'a')].sort(byDiscAndNumber).map((t) => t.Path),
    ['a', 'b', 'c'],
  )
})

test("units: Jellyfin's ticks and dates", () => {
  assert.equal(seconds(25 * 10_000_000), 25)
  assert.equal(seconds(undefined), 0)
  assert.equal(ticks(1.5), 15_000_000)
  assert.equal(date('2026-11-01T00:00:00Z'), Date.UTC(2026, 10, 1))
  assert.equal(date('not a date'), 0)
  assert.equal(date(undefined), 0)
})
