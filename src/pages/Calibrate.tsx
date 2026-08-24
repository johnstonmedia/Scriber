import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  CALIBRATION_PASSAGE,
  DEFAULT_CALIBRATION,
  deriveThresholds,
  type Calibration,
  type GapSample,
  type MarkKind,
} from '../scribe/calibration'
import { PauseMeter, noiseFloor, segmentGaps, type Level } from '../scribe/pauseMeter'

/** The marks inside one line, in the order a reader will pass them. */
function marksIn(line: string): MarkKind[] {
  const marks: MarkKind[] = []
  for (const char of line) if (char === ',') marks.push('comma')
  return marks
}

type LineState = 'waiting' | 'listening' | 'kept' | 'unclear'

/**
 * Teaching the writer how one student's pauses sound.
 *
 * Read one line at a time rather than the whole passage. Doing it line by
 * line is what makes the measurement honest: within a single line we know
 * exactly how many pauses to expect, so a reading that produces a different
 * number can be thrown away instead of guessed at. Across a whole passage
 * there is no way to tell a missed pause from an extra one.
 */
export function Calibrate() {
  const { user, settings, saveSettings, calibrationTester, loading } = useAuth()
  const [index, setIndex] = useState(0)
  const [state, setState] = useState<LineState>('waiting')
  const [samples, setSamples] = useState<GapSample[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<Calibration | null>(null)
  const meterRef = useRef<PauseMeter | null>(null)
  const floorRef = useRef<number>(0)

  useEffect(() => () => meterRef.current?.stop(), [])

  if (loading) return null

  if (!calibrationTester) {
    return (
      <div className="page" style={{ maxWidth: 640 }}>
        <div className="page-head">
          <div>
            <h1>Teaching your writer</h1>
          </div>
        </div>
        <div className="card card-pad stack gap-3">
          <p>
            This one is still being tried out with a few people at a time, so it is available by
            invitation rather than to everybody. It asks you to read aloud and then changes how
            your practice is punctuated, and getting that wrong for somebody is worse than not
            having it at all — so we would rather watch it work for a handful of students first.
          </p>
          <p className="small muted">
            If you would like to be one of them, say so and we'll add you.{' '}
            <Link to="/settings">Everything else in Settings</Link> works as usual.
          </p>
        </div>
      </div>
    )
  }

  const line = CALIBRATION_PASSAGE[index]
  const done = index >= CALIBRATION_PASSAGE.length

  async function listen() {
    setProblem(null)
    setState('listening')
    try {
      const meter = new PauseMeter()
      meterRef.current = meter
      await meter.start()
      // A second of the room before they speak, so the threshold is set from
      // this room rather than from an assumption about rooms.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      floorRef.current = noiseFloor(meter.take())
    } catch {
      setState('waiting')
      setProblem(
        "We couldn't reach your microphone. Check the permission in your browser's address bar, then try again.",
      )
    }
  }

  function finishLine() {
    const meter = meterRef.current
    if (!meter || line === undefined) return
    const levels: Level[] = meter.take()
    meter.stop()
    meterRef.current = null

    const expected = marksIn(line)
    const { gaps, speechRuns } = segmentGaps(levels, {
      floor: floorRef.current,
      minGapMs: 120,
      minSpeechMs: 80,
    })

    // The count has to match exactly. A reading with the wrong number of
    // pauses cannot be lined up against the line's commas, and a guess here
    // would end up as punctuation in somebody's exam.
    if (speechRuns === 0) {
      setState('unclear')
      setProblem("We didn't hear anything. Check your microphone is the one you're speaking into.")
      return
    }
    if (gaps.length !== expected.length) {
      setState('unclear')
      setProblem(
        gaps.length > expected.length
          ? 'That had more pauses in it than the line has commas. Read it straight through, pausing only where the punctuation is.'
          : "We didn't hear a pause at every comma. Read it at the pace you'd use in an exam rather than quickly.",
      )
      return
    }

    setSamples((current) => [
      ...current,
      ...gaps.map((ms, i) => ({ ms, expected: expected[i]! })),
      // The end of a line is a full stop, and the pause after it is the one
      // that separates a sentence from the next.
      ...(index < CALIBRATION_PASSAGE.length - 1
        ? [{ ms: Math.max(...gaps, 0) * 2, expected: 'sentence' as const }]
        : []),
    ])
    setState('kept')
    setProblem(null)
  }

  function nextLine() {
    setIndex((i) => i + 1)
    setState('waiting')
  }

  async function finish() {
    const result = deriveThresholds(samples)
    if (!result.ok) {
      setProblem(result.reason)
      setSaved(null)
      return
    }
    setSaved(result.calibration)
    await saveSettings({ calibration: result.calibration })
  }

  const existing = settings.calibration ?? null

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Teaching your writer</h1>
          <p className="muted">
            A real writer learns what your pauses mean within a few minutes of meeting you. Read
            these four lines aloud and yours will too.
          </p>
        </div>
      </div>

      {existing && !saved && (
        <div className="alert alert-info" style={{ marginBottom: 22 }}>
          Your writer already knows your pauses, from{' '}
          {new Date(existing.capturedAt).toLocaleDateString('en-AU')}. Reading again replaces that
          — worth doing if your voice has changed, or if you did the first one somewhere noisy.
        </div>
      )}

      {problem && (
        <div className="alert alert-warn" style={{ marginBottom: 22 }}>
          {problem}
        </div>
      )}

      {saved ? (
        <div className="card card-pad stack gap-3">
          <h2>Done — your writer has it.</h2>
          <p>
            It now waits about <strong>{saved.comma}ms</strong> before deciding a pause was a
            comma, and <strong>{saved.sentence}ms</strong> before deciding it was a full stop.
            Those are your numbers, measured from the way you actually read.
          </p>
          <p className="small muted">
            This only changes anything under the HSC writer rules, where a writer may add
            punctuation. Under the NAPLAN and JCQ scribe protocol you dictate every mark yourself
            and there is nothing for it to infer.
          </p>
          <div className="row gap-2">
            <Link className="btn btn-primary" to="/">
              Back to practice
            </Link>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setSaved(null)
                setSamples([])
                setIndex(0)
                setState('waiting')
              }}
            >
              Read it again
            </button>
          </div>
        </div>
      ) : done ? (
        <div className="card card-pad stack gap-3">
          <h2>That's all four.</h2>
          <p className="muted">
            {samples.length} pauses measured. If they separate cleanly, your writer will use them;
            if they don't, it will say so and keep its usual pacing rather than guess.
          </p>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void finish()}>
            See what it learned
          </button>
        </div>
      ) : (
        <div className="card card-pad stack gap-4">
          <div className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
            <span className="badge badge-accent">
              Line {index + 1} of {CALIBRATION_PASSAGE.length}
            </span>
            {state === 'listening' && <span className="badge badge-live">Listening</span>}
          </div>

          <p className="calibration-line">{line}</p>

          <p className="small muted">
            Read it the way you would dictate in an exam — pause at the commas, and don't rush the
            full stop. Nothing is recorded: we measure only how loud it is, moment to moment.
          </p>

          {state === 'waiting' || state === 'unclear' ? (
            <button className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }} onClick={() => void listen()}>
              {state === 'unclear' ? 'Try this line again' : "I'm ready — start listening"}
            </button>
          ) : state === 'listening' ? (
            <button className="btn btn-lg" style={{ alignSelf: 'flex-start' }} onClick={finishLine}>
              Done reading this line
            </button>
          ) : (
            <div className="row gap-2 wrap">
              <span className="badge badge-good">Got it</span>
              <button className="btn btn-primary" onClick={nextLine}>
                {index === CALIBRATION_PASSAGE.length - 1 ? 'Finish' : 'Next line'}
              </button>
            </div>
          )}
        </div>
      )}

      <p className="small muted" style={{ marginTop: 22 }}>
        Signed in as {user?.email}. Your writer's current pacing:{' '}
        {existing ? `${existing.comma}ms / ${existing.sentence}ms` : `${DEFAULT_CALIBRATION.comma}ms / ${DEFAULT_CALIBRATION.sentence}ms (the default)`}
        .
      </p>
    </div>
  )
}
