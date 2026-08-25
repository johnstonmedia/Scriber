/**
 * Getting words to the writer while the student is still talking.
 *
 * The lag people complained about was never the writer's simulated pace. It
 * was that nothing reached the writer *at all* until Chrome decided a stretch
 * of speech was final, which it does in whole clauses, seconds after they were
 * spoken. So the shape of it was: say fifteen words, watch an empty page for
 * three seconds, then watch the writer work through a backlog for another six.
 * Two lags stacked, one of them invisible, and the visible one blamed.
 *
 * The interim transcript is there the whole time and grows a word or two at a
 * time. The catch is that it is *provisional* — the recogniser revises what it
 * has already shown, usually near the end of what it has heard, as later
 * context arrives. Almost never at the front.
 *
 * So: hold back the last few words, and treat everything before them as
 * settled. The held-back window is what absorbs the revisions. Words reach the
 * writer within a couple of hundred milliseconds of being spoken, the writer's
 * own pacing becomes the only lag, and that lag is the thing the product is
 * actually about.
 *
 * Pure. `absorb` takes the state and the latest transcript, and returns the
 * units that are newly safe to write.
 */

import { chunkUtterance, type RuleProfile } from './engine'

export type StreamState = {
  /** Units already handed to the writer from the segment in progress. */
  taken: string[]
  /**
   * Times the recogniser has revised text it had already settled. Not used to
   * decide anything — surfaced so a session report can say honestly that some
   * words went down before the recogniser changed its mind.
   */
  revisions: number
}

export function createStream(): StreamState {
  return { taken: [], revisions: 0 }
}

/**
 * How many words at the end of an interim transcript are treated as unsettled.
 *
 * Three is the number that matters. Below it the recogniser's revisions start
 * landing on text already written; above it the lag it was meant to remove
 * comes back. It is also comfortably more than the longest spoken command, so
 * "new paragraph" is never split across the boundary — though that is belt and
 * braces, since units are released whole regardless.
 */
export const DEFAULT_LOOKAHEAD = 3

export type AbsorbResult = { state: StreamState; units: string[] }

/**
 * Take whatever is newly settled out of an interim transcript.
 *
 * Units, not words: `chunkUtterance` decides where the boundaries are, and a
 * unit is released only when the whole of it sits inside the settled region.
 * The engine and the writer's queue both work in units, and a "new" released
 * without its "paragraph" would be written down as a word.
 */
export function absorbInterim(
  state: StreamState,
  transcript: string,
  profile: RuleProfile,
  lookahead = DEFAULT_LOOKAHEAD,
): AbsorbResult {
  const units = chunkUtterance(transcript, profile)
  if (units.length === 0) return { state, units: [] }

  // Count in words, because the lookahead is a claim about how much of the
  // recogniser's output is still in flux, and that is measured in words.
  const wordCounts = units.map((unit) => unit.split(' ').length)
  const totalWords = wordCounts.reduce((sum, n) => sum + n, 0)
  const settledWords = totalWords - lookahead
  if (settledWords <= 0) return { state, units: [] }

  let cursor = 0
  let settledUnits = 0
  for (let i = 0; i < units.length; i++) {
    const end = cursor + wordCounts[i]!
    if (end > settledWords) break
    cursor = end
    settledUnits = i + 1
  }

  return release(state, units.slice(0, settledUnits))
}

/**
 * The recogniser has finalised this segment. Everything left goes.
 *
 * The final transcript can differ from the interim we were reading — that is
 * the whole reason for the lookahead — so what is released is whatever the
 * final says beyond what was already taken, not the difference between two
 * strings.
 */
export function absorbFinal(
  state: StreamState,
  transcript: string,
  profile: RuleProfile,
): AbsorbResult {
  const units = chunkUtterance(transcript, profile)
  const result = release(state, units)
  // The segment is over; the next one starts from nothing.
  return { state: { taken: [], revisions: result.state.revisions }, units: result.units }
}

/** A segment ended without a final — abandon what was in flight. */
export function resetSegment(state: StreamState): StreamState {
  return { ...state, taken: [] }
}

function release(state: StreamState, settled: string[]): AbsorbResult {
  const { taken } = state
  if (settled.length <= taken.length) {
    // Nothing new. If what came back disagrees with what we already wrote, the
    // recogniser revised settled text — worth counting, but there is nothing
    // to do about it: those words are on the page and a writer cannot unhear
    // something they have already written down.
    const revised = disagrees(taken, settled)
    return {
      state: revised ? { ...state, revisions: state.revisions + 1 } : state,
      units: [],
    }
  }

  const fresh = settled.slice(taken.length)
  const revised = disagrees(taken, settled)
  return {
    state: {
      taken: settled.slice(0, taken.length + fresh.length),
      revisions: revised ? state.revisions + 1 : state.revisions,
    },
    units: fresh,
  }
}

function disagrees(taken: string[], settled: string[]): boolean {
  const shared = Math.min(taken.length, settled.length)
  for (let i = 0; i < shared; i++) if (taken[i] !== settled[i]) return true
  return false
}
