import type { Invite, Membership } from '../lib/org'
import { planExpired, seatUsage, type OrgPlan } from '../lib/seats'

/**
 * How much of a school's licence is used, worked out from the roster already
 * on screen rather than a fresh count — so it can never disagree with the
 * list underneath it. The write path in org.ts counts on the server instead,
 * because a guard must not trust what a browser thinks the roster is.
 */
export function SeatMeter({
  plan,
  members,
  invites,
}: {
  plan: OrgPlan
  members: Membership[]
  invites: Invite[]
}) {
  if (plan.studentSeats === null) return null

  const used = members.filter((m) => m.role === 'student').length
  const reserved = invites.filter((i) => i.status === 'pending' && i.role === 'student').length
  const usage = seatUsage(plan, used, reserved)
  const seats = plan.studentSeats
  const filled = Math.min(1, (used + reserved) / Math.max(1, seats))
  const expired = planExpired(plan)

  return (
    <div className={`seat-meter ${usage.full || expired ? 'seat-meter-full' : ''}`}>
      <div className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
        {/* An outstanding invite is a seat that is gone, so it belongs in the
            headline number — leading with the roster alone would read as room
            to spare while the bar underneath sits full. */}
        <strong className="grow">
          {used + reserved} of {seats} student {seats === 1 ? 'seat' : 'seats'} taken
          {reserved > 0 && (
            <span className="muted">
              {' '}
              · {used} on the roster, {reserved} invited
            </span>
          )}
        </strong>
        <span className={`badge ${plan.kind === 'demo' ? 'badge-accent' : 'badge-good'}`}>
          {plan.kind === 'demo' ? 'Demo' : 'Licensed'}
        </span>
      </div>
      <div className="seat-meter-track" aria-hidden="true">
        <span className="seat-meter-fill" style={{ transform: `scaleX(${filled})` }} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {expired ? (
          <>
            This demo ran out on {new Date(plan.expiresAt!).toLocaleDateString('en-AU')}. Get in
            touch and we'll extend it or license the school properly.
          </>
        ) : usage.full ? (
          <>Every seat is taken. Get in touch to add more — teachers and admins never use one.</>
        ) : plan.kind === 'demo' ? (
          <>
            A demo covers {seats} students
            {plan.expiresAt && <> until {new Date(plan.expiresAt).toLocaleDateString('en-AU')}</>}.
            Teachers and admins don't use a seat.
          </>
        ) : (
          <>Teachers and admins don't use a seat — only students do.</>
        )}
      </p>
    </div>
  )
}
