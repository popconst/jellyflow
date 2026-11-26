import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AUTH, fakeJellyfin } from './fakes.ts'
import { credentials, Users } from './users.ts'

test("credentials: the device and the token in the page's Authorization header", () => {
  assert.deepEqual(credentials(AUTH), { token: 'good-token', device: { id: 'test-1', name: 'Test' } })
  assert.equal(credentials('MediaBrowser Client="jellyflow", DeviceId="d"'), undefined, 'not logged in')
  assert.equal(credentials('Bearer good-token'), undefined)
  assert.equal(credentials(undefined), undefined)
})

test('who: whose token it is, says Jellyfin; asked again only after a while', async () => {
  const jellyfin = await fakeJellyfin()
  try {
    const users = new Users(jellyfin.url)
    const user = await users.who(AUTH)
    assert.equal(user?.id, 'user-1')
    assert.equal(user?.name, 'tester')
    assert.equal(user?.jellyfin.session.userId, 'user-1')
    assert.equal((await users.who(AUTH))?.id, 'user-1')
    assert.equal(jellyfin.requests.filter((r) => r.startsWith('/Users/Me')).length, 1)
    assert.equal(await users.who(AUTH.replace('good-token', 'bad-token')), undefined)
    assert.equal(await users.who(undefined), undefined)
  } finally {
    await jellyfin.close()
  }
})
