// Calendar's dates and events.json (no browser).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, parseDayKey, monthGrid, parseEvents, serializeEvents, sortEvents, isTime, type CalEvent } from '../../src/apps/kcalendar/events.ts'

test('day keys round-trip and reject bad days', () => {
  assert.equal(dayKey(new Date(2026, 9, 8)), '2026-10-08')
  assert.equal(parseDayKey('2026-10-08')?.getDate(), 8)
  assert.equal(parseDayKey('2026-02-30'), null, 'no 30 February')
  assert.equal(parseDayKey('8 Oct'), null)
})

test('the month grid starts on a Monday and covers the whole month', () => {
  const weeks = monthGrid(2026, 9) // October 2026: 1 Oct is a Thursday
  assert.equal(weeks.length, 6)
  assert.equal(weeks[0][0].getDay(), 1, 'first column is Monday')
  assert.equal(dayKey(weeks[0][0]), '2026-09-28')
  const days = weeks.flat().map(dayKey)
  assert.ok(days.includes('2026-10-01') && days.includes('2026-10-31'))
})

test('times are HH:MM or empty', () => {
  assert.ok(isTime(''))
  assert.ok(isTime('09:30'))
  assert.ok(!isTime('24:00'))
  assert.ok(!isTime('9:30am'))
})

test('events sort by day, then time (all day first), then title', () => {
  const ev = (id: string, date: string, time: string, title: string): CalEvent => ({ id, date, time, title, note: '' })
  const sorted = sortEvents([ev('a', '2026-10-09', '', 'b'), ev('b', '2026-10-08', '10:00', 'x'), ev('c', '2026-10-08', '', 'y')])
  assert.deepEqual(sorted.map((e) => e.id), ['c', 'b', 'a'])
})

test('events.json round-trips and skips bad entries', () => {
  const list: CalEvent[] = [{ id: 'one', date: '2026-10-08', time: '14:00', title: 'Lab meeting', note: 'Room 3' }]
  const text = serializeEvents(list)
  assert.deepEqual(parseEvents(text), list)
  const messy = JSON.stringify({ events: [{ date: 'bad', title: 'x' }, { date: '2026-01-02', title: '  ' }, { date: '2026-01-03', title: 'ok', time: '99:99' }, 'nope'] })
  const got = parseEvents(messy)
  assert.equal(got.length, 1)
  assert.equal(got[0].title, 'ok')
  assert.equal(got[0].time, '', 'a bad time becomes all day')
  assert.ok(got[0].id, 'every event has an id')
  assert.throws(() => parseEvents('not json'), /not a Calendar file/)
})
