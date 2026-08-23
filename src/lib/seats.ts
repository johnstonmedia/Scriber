/**
 * How many students an organisation is licensed for.
 *
 * A school arrives as a demo — five students, enough to put it in front of a
 * learning-support team without a purchase order — and is then licensed to
 * one of the tiers below. The plan is written by a site admin and by nobody
 * else: firestore.rules refuses a plan change from an organisation's own
 * admin, so a school cannot raise its own ceiling.
 *
 * What that does and does not buy, stated plainly: every path the interface
 * offers for admitting a student counts the roster first and refuses to go
 * over. An organisation admin who drove the Firestore SDK by hand could still
 * write a membership document past the cap, because a rule cannot count
 * documents in a collection without a denormalised counter, and a counter
 * that drifts high would lock a paying school out of seats it holds. That
 * trade is deliberate: exceeding a seat count is a billing dispute, and it
 * touches nothing confidential — exam papers and dictated answers are guarded
 * separately, by rules that do not depend on any of this.
 *
 * Seats count students. Teachers and admins are staff and are never counted:
 * a school should never have to choose between a second English teacher and
 * another student.
 */

/** What a school can buy, in students. */
export const SEAT_TIERS = [20, 30, 50, 75, 100, 150] as const

/** A demo is deliberately small — a real trial with a handful of students. */
export const DEMO_SEATS = 5

/** How long a demo runs before a site admin has to renew or license it. */
export const DEMO_DAYS = 30

export type OrgPlan = {
  kind: 'demo' | 'licensed'
  /** Null means uncapped — see planOf() for when that happens. */
  studentSeats: number | null
  /** Demos expire; licences don't, until someone changes them. */
  expiresAt: string | null
  setBy: string
  setAt: string
}

/**
 * An organisation document written before seats existed carries no plan at
 * all, and is uncapped. Defaulting those to a demo's five seats would lock
 * schools out of rosters they already have, which is a worse failure than an
 * old organisation going uncounted until a site admin sets its plan.
 */
export const UNCAPPED: OrgPlan = {
  kind: 'licensed',
  studentSeats: null,
  expiresAt: null,
  setBy: '',
  setAt: '',
}

export function demoPlan(setBy: string, now = new Date()): OrgPlan {
  const expires = new Date(now.getTime() + DEMO_DAYS * 24 * 60 * 60 * 1000)
  return {
    kind: 'demo',
    studentSeats: DEMO_SEATS,
    expiresAt: expires.toISOString(),
    setBy,
    setAt: now.toISOString(),
  }
}

export function licensedPlan(studentSeats: number, setBy: string, now = new Date()): OrgPlan {
  return {
    kind: 'licensed',
    studentSeats,
    expiresAt: null,
    setBy,
    setAt: now.toISOString(),
  }
}

/** Reads a plan off raw organisation data, falling back to uncapped. */
export function planOf(data: unknown): OrgPlan {
  if (!data || typeof data !== 'object') return UNCAPPED
  const plan = (data as { plan?: unknown }).plan
  if (!plan || typeof plan !== 'object') return UNCAPPED
  const p = plan as Record<string, unknown>
  const seats = typeof p.studentSeats === 'number' && p.studentSeats >= 0 ? p.studentSeats : null
  return {
    kind: p.kind === 'demo' ? 'demo' : 'licensed',
    studentSeats: seats,
    expiresAt: typeof p.expiresAt === 'string' && p.expiresAt ? p.expiresAt : null,
    setBy: typeof p.setBy === 'string' ? p.setBy : '',
    setAt: typeof p.setAt === 'string' ? p.setAt : '',
  }
}

export function planExpired(plan: OrgPlan, now = new Date()): boolean {
  return plan.expiresAt !== null && new Date(plan.expiresAt).getTime() < now.getTime()
}

export type SeatUsage = {
  plan: OrgPlan
  /** Students on the roster right now. */
  used: number
  /** Invited students who have not accepted yet — a seat already spoken for. */
  reserved: number
  /** Null when uncapped. */
  seats: number | null
  remaining: number | null
  full: boolean
}

export function seatUsage(plan: OrgPlan, used: number, reserved: number): SeatUsage {
  const seats = plan.studentSeats
  const remaining = seats === null ? null : Math.max(0, seats - used - reserved)
  return {
    plan,
    used,
    reserved,
    seats,
    remaining,
    full: seats !== null && used + reserved >= seats,
  }
}

/** The sentence a school reads when it can't add anybody else. */
export function seatsFullMessage(usage: SeatUsage, orgName: string): string {
  const seats = usage.seats ?? 0
  const held = usage.reserved > 0 ? ` (${usage.used} on the roster, ${usage.reserved} invited)` : ''
  return usage.plan.kind === 'demo'
    ? `${orgName} is on a demo, which covers ${seats} students${held}. Ask us to license the school to add more.`
    : `${orgName} is licensed for ${seats} students${held}. Ask us to raise the limit to add more.`
}

export function planLabel(plan: OrgPlan): string {
  if (plan.studentSeats === null) return 'No seat limit set'
  return plan.kind === 'demo'
    ? `Demo — ${plan.studentSeats} students`
    : `Licensed — up to ${plan.studentSeats} students`
}
