import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEMO_SEATS,
  SEAT_TIERS,
  demoPlan,
  licensedPlan,
  planExpired,
  planOf,
  seatUsage,
  seatsFullMessage,
} from './seats'

test('an organisation written before seats existed is uncapped, not locked out', () => {
  const plan = planOf({ name: 'Old School' })
  assert.equal(plan.studentSeats, null)
  const usage = seatUsage(plan, 300, 40)
  assert.equal(usage.full, false)
  assert.equal(usage.remaining, null)
})

test('a malformed plan falls back to uncapped rather than to zero seats', () => {
  for (const bad of [null, undefined, 'demo', { plan: 'demo' }, { plan: { studentSeats: 'lots' } }]) {
    assert.equal(planOf(bad).studentSeats, null)
  }
})

test('a demo covers five students and expires', () => {
  const plan = demoPlan('admin-1', new Date('2026-01-01T00:00:00Z'))
  assert.equal(plan.kind, 'demo')
  assert.equal(plan.studentSeats, DEMO_SEATS)
  assert.equal(planExpired(plan, new Date('2026-01-15T00:00:00Z')), false)
  assert.equal(planExpired(plan, new Date('2026-03-01T00:00:00Z')), true)
})

test('a licence does not expire', () => {
  const plan = licensedPlan(50, 'admin-1')
  assert.equal(plan.expiresAt, null)
  assert.equal(planExpired(plan, new Date('2099-01-01T00:00:00Z')), false)
})

test('an invited student holds a seat before they accept', () => {
  const plan = licensedPlan(20, 'admin-1')
  const usage = seatUsage(plan, 18, 2)
  assert.equal(usage.remaining, 0)
  assert.equal(usage.full, true)
})

test('the last seat is available until it is taken', () => {
  const plan = licensedPlan(20, 'admin-1')
  assert.equal(seatUsage(plan, 19, 0).full, false)
  assert.equal(seatUsage(plan, 19, 0).remaining, 1)
  assert.equal(seatUsage(plan, 20, 0).full, true)
})

test('a roster already over its cap reports no seats left rather than a negative count', () => {
  const usage = seatUsage(licensedPlan(20, 'admin-1'), 25, 0)
  assert.equal(usage.remaining, 0)
  assert.equal(usage.full, true)
})

test('the full message names the plan, not an error code', () => {
  const demo = seatsFullMessage(seatUsage(demoPlan('a'), 5, 0), 'Northside High')
  assert.match(demo, /demo/)
  assert.match(demo, /Northside High/)
  assert.doesNotMatch(demo, /SCR-/)

  const licensed = seatsFullMessage(seatUsage(licensedPlan(30, 'a'), 28, 2), 'Northside High')
  assert.match(licensed, /30 students/)
  assert.match(licensed, /28 on the roster, 2 invited/)
})

test('the tiers are the ones sold, in order', () => {
  assert.deepEqual([...SEAT_TIERS], [20, 30, 50, 75, 100, 150])
})
