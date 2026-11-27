import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Motion } from './motion.ts'

test('motion: a tap glides one album; a hold runs ever faster and slows onto an album', () => {
  const run = (m: Motion, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) m.tick(1 / 60, 1000)
  }
  const m = new Motion()
  m.press(1)
  m.release(1)
  run(m, 1)
  assert.equal(m.pos, 1)
  assert.equal(m.moving, false)

  // held: the keyboard starts repeating, and it runs, faster and faster
  m.press(1)
  run(m, 0.15)
  m.repeat(1)
  run(m, 0.2)
  const early = m.velocity
  assert.ok(early >= 12, `sliding from the start: ${early}`)
  run(m, 0.8)
  assert.ok(m.velocity > early * 3, `faster the longer it's held: ${early} → ${m.velocity}`)
  const at = m.pos
  m.release(1)
  let prev = m.velocity
  let jolt = 0
  for (let t = 0; t < 1.5; t += 1 / 60) {
    m.tick(1 / 60, 1000)
    jolt = Math.max(jolt, Math.abs(m.velocity) - Math.abs(prev))
    prev = m.velocity
  }
  assert.equal(m.moving, false)
  assert.ok(Number.isInteger(m.pos) && m.pos > at && m.pos <= Math.ceil(at) + 6, `stops on an album just ahead: ${at} → ${m.pos}`)
  assert.ok(jolt <= 0.001, `slows down without speeding up again: ${jolt}`)

  // no key repeat: a long press runs too
  m.press(-1)
  run(m, 60)
  m.release(-1)
  run(m, 1)
  assert.equal(m.pos, 0, 'stops at the first album')

  m.jump(500)
  assert.equal(m.pos, 488, 'a far jump starts close by')
  run(m, 2)
  assert.equal(m.pos, 500)

  // a click glides there, more gently than a jump
  const j = new Motion()
  j.jump(4)
  m.snap(0)
  m.glide(4)
  run(j, 0.15)
  run(m, 0.15)
  assert.ok(m.pos < j.pos - 0.5, 'a glide is gentler')
  run(m, 2)
  assert.equal(m.pos, 4)
})
