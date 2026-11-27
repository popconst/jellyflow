import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keyName, Keys, typing } from './index.ts'

test('keys: counts and two-key commands', () => {
  const keys = new Keys()
  assert.equal(keys.feed('1'), undefined)
  assert.equal(keys.feed('2'), undefined)
  assert.deepEqual(keys.feed('j'), { key: 'j', count: 12 })
  assert.equal(keys.feed('g'), undefined)
  assert.equal(keys.pending, 'g')
  assert.deepEqual(keys.feed('g'), { key: 'gg', count: undefined })
  assert.deepEqual(keys.feed('0'), { key: '0', count: undefined })
  assert.deepEqual(keys.feed('G'), { key: 'G', count: undefined })
})

test("keyName: vim's names; nothing with Cmd or Alt", () => {
  const key = (k: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) =>
    keyName({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })
  assert.equal(key('j'), 'j')
  assert.equal(key('G'), 'G')
  assert.equal(key('Escape'), '<Esc>')
  assert.equal(key(' '), '<Space>')
  assert.equal(key('d', { ctrlKey: true }), '<C-d>')
  assert.equal(key('Enter', { ctrlKey: true }), '<C-enter>')
  assert.equal(key('j', { metaKey: true }), undefined)
  assert.equal(key('Shift'), undefined)
})

test('typing: keys in a text field are its own', () => {
  assert.equal(typing({ target: { tagName: 'INPUT' } }), true)
  assert.equal(typing({ target: { tagName: 'TEXTAREA' } }), true)
  assert.equal(typing({ target: { tagName: 'BODY' } }), false)
  assert.equal(typing({ target: null }), false)
})
