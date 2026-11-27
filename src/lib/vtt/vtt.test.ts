import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linesAt, parseVtt } from './index.ts'

test('subtitles: WebVTT read into plain cues, found by time', () => {
  const cues = parseVtt(
    [
      'WEBVTT',
      '',
      'NOTE a comment',
      '',
      '1',
      '00:00:01.000 --> 00:00:03.500 align:middle line:90%',
      '<i>Hello</i> &amp; welcome',
      '',
      '00:02.000 --> 00:04.000',
      '<v Pooh>Oh, bother.</v>',
      'Second line',
      '',
      '01:00:00.000 --> 01:00:01.000',
      'Late',
    ].join('\r\n'),
  )
  assert.equal(cues.length, 3)
  assert.deepEqual(cues[0], { start: 1, end: 3.5, lines: ['Hello & welcome'] })
  assert.deepEqual(linesAt(cues, 0.5), [])
  assert.deepEqual(linesAt(cues, 2.5), ['Hello & welcome', 'Oh, bother.', 'Second line'])
  assert.deepEqual(linesAt(cues, 3.6), ['Oh, bother.', 'Second line'])
  assert.deepEqual(linesAt(cues, 3600.5), ['Late'])
  assert.deepEqual(linesAt(cues, 4000), [])
})

test('subtitles: cues with no text, or that end before they start, are left out', () => {
  const cues = parseVtt('WEBVTT\n\n00:05.000 --> 00:04.000\nBackwards\n\n00:06.000 --> 00:07.000\n<i></i>\n\n00:08,500 --> 00:09.000\nComma')
  assert.deepEqual(cues, [{ start: 8.5, end: 9, lines: ['Comma'] }])
})
