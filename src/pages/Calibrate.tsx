import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  DEFAULT_CALIBRATION,
  deriveThresholds,
  type Calibration,
  type GapSample,
} from '../scribe/calibration'
import {
  alignGaps,
  gradeRound,
  nextSentence,
  observedGaps,
  parseSentence,
  readingMatches,
  roundSamples,
  type DrillSentence,
  type ParsedSentence,
  type RecogniserUpdate,
  type RoundResult,
} from '../scribe/drill'
import { MARK_LABEL, type PunctuationModel, type PunctuationSample } from '../scribe/punctuation'
import { Dictation, speechRecognitionSupported } from '../scribe/speech'
import { contributeRound, loadPunctuationModel, refreshPunctuationModel } from '../lib/punctuationModel'

type Stage = 'ready' | 'listening' | 'marked'

/**
 * Teaching the writer where punctuation goes.
 *
 * The shape of this screen is the point of it. A sentence goes up, the student
 * reads it aloud, and the writer commits to what it heard *before* the answer
 * is shown — then both are put side by side. That ordering is what makes it
 * teaching rather than a demonstration: the writer is wrong in front of you,
 * about a sentence you can see, so what it got wrong is legible instead of
 * being a vague sense that the punctuation is off.
 *
 * What it learns goes two places. The student's own pauses set their own
 * thresholds, which is theirs alone. The graded boundaries go to the shared
 * model, so a student who spends ten minutes here has improved the writer for
 * every student on the site — which is the only thing that makes ten minutes
 * of somebody's afternoon worth asking for.
 */
export function Calibrate() {
  const { user, settings, saveSettings, calibrationTester, loading } = useAuth()

  const [sentence, setSentence] = useState<DrillSentence | null>(null)
  const [parsed, setParsed] = useState<ParsedSentence | null>(null)
  const [stage, setStage] = useState<Stage>('ready')
  const [result, setResult] = useState<RoundResult | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [rounds, setRounds] = useState(0)
  const [contributed, setContributed] = useState(0)
  const [observations, setObservations] = useState<number | null>(null)
  const [saved, setSaved] = useState<Calibration | null>(null)
  const [heardText, setHeardText] = useState('')

  /** Every gap this student has been measured on, across the whole session. */
  const gapSamples = useRef<GapSample[]>([])
  /** How many words the recogniser had, and when — the raw timing. */
  const updates = useRef<RecogniserUpdate[]>([])
  const heardRef = useRef('')
  const dictation = useRef<Dictation | null>(null)
  const modelRef = useRef<PunctuationModel | undefined>(undefined)

  const supported = useRef(speechRecognitionSupported()).current

  useEffect(() => {
    void loadPunctuationModel().then((model) => {
      modelRef.current = model
      setObservations(model.observations)
    })
  }, [])

  useEffect(() => () => dictation.current?.dispose(), [])

  const pick = useCallback((finished: string[]) => {
    const next = nextSentence(finished)
    setSentence(next)
    setParsed(parseSentence(next.text))
    setResult(null)
    setHeardText('')
    setProblem(null)
    setStage('ready')
  }, [])

  useEffect(() => {
    if (!sentence) pick([])
  }, [sentence, pick])

  /**
   * Note what the recogniser has heard so far, and when.
   *
   * Both interim and final results land here. Interim ones are what carry the
   * timing — a final arrives in one lump seconds later and would tell us only
   * that the whole sentence took four seconds.
   */
  const noteTranscript = useCallback((text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return
    heardRef.current = text
    const last = updates.current[updates.current.length - 1]
    if (last && last.words === words.length) return
    updates.current.push({ words: words.length, at: Date.now() })
  }, [])

  function listen() {
    if (!supported) {
      setProblem(
        'This browser cannot listen for speech. Chrome, Edge or Safari can — the drill needs to hear you read.',
      )
      return
    }
    updates.current = []
    heardRef.current = ''
    setProblem(null)
    setResult(null)
    setStage('listening')

    const instance = new Dictation({
      onFinal: noteTranscript,
      onInterim: noteTranscript,
      onError: (message) => {
        setProblem(message)
        setStage('ready')
      },
      onListeningChange: () => {},
    }, settings.recogniserLanguage)
    dictation.current = instance
    instance.start()
  }

  async function finishReading() {
    dictation.current?.stop()
    dictation.current?.dispose()
    dictation.current = null

    if (!parsed || !sentence) return
    const heard = heardRef.current.trim()
    setHeardText(heard)
    const words = heard.split(/\s+/).filter(Boolean)

    if (!readingMatches(parsed, words)) {
      setStage('ready')
      setProblem(
        words.length === 0
          ? "We didn't hear anything. Check the microphone in your browser's address bar, then read it again."
          : 'That did not come through as the sentence on the screen. Read it once more, at the pace you would use in an exam.',
      )
      return
    }

    const alignment = alignGaps(parsed, observedGaps(updates.current))
    const graded = gradeRound(parsed, alignment, settings.calibration, modelRef.current)
    setResult(graded)
    setStage('marked')
    setRounds((n) => n + 1)

    // The student's own pauses, for their own thresholds. Only the boundaries
    // that carry a mark say anything about what a comma or a full stop sounds
    // like for this person.
    gapSamples.current = [
      ...gapSamples.current,
      ...parsed.boundaries.flatMap((boundary, index) => {
        const ms = alignment.gapAt[index] ?? 0
        if (boundary.mark === 'none' || ms <= 0) return []
        // A question mark ends a sentence; the rise in the voice is what tells
        // them apart, and that is not something this measures.
        const expected = boundary.mark === 'question' ? 'sentence' : boundary.mark
        return [{ ms, expected } as GapSample]
      }),
    ]

    void offer(roundSamples(parsed, alignment))
  }

  /** Send the round to the shared model. Never blocks the student. */
  async function offer(samples: PunctuationSample[]) {
    try {
      const response = await contributeRound(samples, settings.calibration)
      setContributed((n) => n + response.accepted)
      if (response.observations !== null) setObservations(response.observations)
    } catch {
      // A round that could not be shared still taught the student something,
      // and telling them their practice "failed" because of a network is both
      // untrue and discouraging.
    }
  }

  async function finish() {
    const derived = deriveThresholds(gapSamples.current)
    modelRef.current = await refreshPunctuationModel()
    setObservations(modelRef.current.observations)
    if (!derived.ok) {
      setProblem(derived.reason)
      setSaved(null)
      setStage('marked')
      return
    }
    setSaved(derived.calibration)
    await saveSettings({ calibration: derived.calibration })
  }

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

  const existing = settings.calibration ?? null

  if (saved) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-head">
          <div className="grow">
            <h1>Your writer has it.</h1>
          </div>
        </div>
        <div className="card card-pad stack gap-3">
          <p>
            It now waits about <strong>{saved.comma}ms</strong> before deciding a pause was a
            comma, and <strong>{saved.sentence}ms</strong> before deciding it was a full stop.
            Those are your numbers, measured from the way you actually read.
          </p>
          {contributed > 0 && (
            <p>
              You also taught the shared writer <strong>{contributed}</strong> new readings, which
              every student on Scriber gets the benefit of.{' '}
              {observations !== null && (
                <span className="muted">It has {observations.toLocaleString('en-AU')} in total.</span>
              )}
            </p>
          )}
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
                gapSamples.current = []
                setRounds(0)
                setDone([])
                pick([])
              }}
            >
              Keep practising
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Teaching your writer</h1>
          <p className="muted">
            Read each sentence aloud. Your writer takes it down without seeing the answer, and then
            you both find out how it did.
          </p>
        </div>
      </div>

      {existing && rounds === 0 && (
        <div className="alert alert-info" style={{ marginBottom: 22 }}>
          Your writer already knows your pauses, from{' '}
          {new Date(existing.capturedAt).toLocaleDateString('en-AU')}. Practising again replaces
          that — worth doing if your voice has changed, or if you did the first one somewhere noisy.
        </div>
      )}

      {problem && (
        <div className="alert alert-warn" style={{ marginBottom: 22 }}>
          {problem}
        </div>
      )}

      <div className="card card-pad stack gap-4">
        <div className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
          <span className="badge badge-accent">Sentence {rounds + (stage === 'marked' ? 0 : 1)}</span>
          {stage === 'listening' && <span className="badge badge-live">Listening</span>}
          {sentence && <span className="small muted">{sentence.focus}</span>}
        </div>

        {/*
          Punctuation is stripped while they read it. Left in, the student
          performs the commas they can see, and the writer learns what somebody
          sounds like reading punctuation aloud rather than speaking.

          Once it is marked this line goes entirely: the report below shows
          what the writer wrote and what the sentence reads, and a third copy
          above them is just something else to compare against.
        */}
        {stage !== 'marked' && (
          <>
            <p className="calibration-line">{parsed?.words.join(' ')}</p>
            <p className="small muted">
              Read it as if you were dictating it, not as if you were reading it out. Nothing is
              recorded — only how long you paused, and the words of this sentence.
            </p>
          </>
        )}

        {stage === 'ready' && (
          <button className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }} onClick={listen}>
            {rounds === 0 ? "I'm ready — start listening" : 'Read this one'}
          </button>
        )}

        {stage === 'listening' && (
          <button className="btn btn-lg" style={{ alignSelf: 'flex-start' }} onClick={() => void finishReading()}>
            Done reading
          </button>
        )}

        {stage === 'marked' && result && (
          <RoundReport
            result={result}
            heard={heardText}
            onNext={() => {
              const finished = sentence ? [...done, sentence.id] : done
              setDone(finished)
              pick(finished)
            }}
            onFinish={() => void finish()}
            canFinish={gapSamples.current.filter((s) => s.expected === 'comma').length >= 3}
          />
        )}
      </div>

      <p className="small muted" style={{ marginTop: 22 }}>
        Signed in as {user?.email}. Your writer's current pacing:{' '}
        {existing
          ? `${existing.comma}ms / ${existing.sentence}ms`
          : `${DEFAULT_CALIBRATION.comma}ms / ${DEFAULT_CALIBRATION.sentence}ms (the default)`}
        {observations !== null && observations > 0 && (
          <> · the shared writer has learned from {observations.toLocaleString('en-AU')} readings</>
        )}
        .
      </p>
    </div>
  )
}

/**
 * How the round went, in a sentence.
 *
 * Built from a list rather than concatenated conditionally. The first version
 * glued fragments together with an "and" between two of them and a full stop
 * on the end, which reads correctly right up until a round is imperfect in a
 * way neither fragment covers — a comma written where a question mark
 * belonged is not a mark added and not a mark missed — and then it says
 * "9 of 10 right. ." and stops.
 */
function summarise(result: RoundResult): string {
  const parts: string[] = []
  if (result.overWrites > 0) {
    parts.push(
      `${result.overWrites} mark${result.overWrites === 1 ? '' : 's'} it added that shouldn't be there`,
    )
  }
  if (result.underWrites > 0) parts.push(`${result.underWrites} it missed`)
  if (result.wrongMarks > 0) {
    parts.push(`${result.wrongMarks} where it chose the wrong mark`)
  }

  const detail =
    parts.length === 0
      ? ''
      : ` ${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts[parts.length - 1]}.`
  return `${result.correct} of ${result.total} right.${detail}`
}

/**
 * What the writer wrote, against what the sentence says.
 *
 * Both are shown in full even when they are identical — a student who got it
 * right should see that they got it right in the same shape they would have
 * seen a mistake, rather than in a green tick that means nothing.
 */
function RoundReport({
  result,
  heard,
  onNext,
  onFinish,
  canFinish,
}: {
  result: RoundResult
  heard: string
  onNext: () => void
  onFinish: () => void
  canFinish: boolean
}) {
  const perfect = result.produced === result.expected
  const mistakes = result.verdicts.filter((verdict) => !verdict.correct)

  return (
    <div className="stack gap-4">
      <div className="stack gap-2">
        <span className="small muted">Your writer wrote</span>
        <p className={`calibration-line ${perfect ? 'alert-good' : ''}`}>{result.produced}</p>
      </div>

      {!perfect && (
        <div className="stack gap-2">
          <span className="small muted">The sentence reads</span>
          <p className="calibration-line">{result.expected}</p>
        </div>
      )}

      <p>{perfect ? 'Every mark in the right place.' : summarise(result)}</p>

      {mistakes.length > 0 && (
        <table className="table small">
          <thead>
            <tr>
              <th scope="col">After</th>
              <th scope="col">You paused</th>
              <th scope="col">It wrote</th>
              <th scope="col">Should be</th>
            </tr>
          </thead>
          <tbody>
            {mistakes.map((verdict, index) => (
              <tr key={index}>
                <td>“{verdict.before}”</td>
                <td>{verdict.ms > 0 ? `${Math.round(verdict.ms)}ms` : 'not at all'}</td>
                <td>{MARK_LABEL[verdict.produced]}</td>
                <td>{MARK_LABEL[verdict.expected]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {heard && (
        <details>
          <summary className="small muted">What the microphone heard</summary>
          <p className="small muted" style={{ marginTop: 8 }}>
            {heard}
          </p>
        </details>
      )}

      <div className="row gap-2 wrap">
        <button className="btn btn-primary" onClick={onNext}>
          Next sentence
        </button>
        {canFinish && (
          <button className="btn btn-ghost" onClick={onFinish}>
            That's enough — see what it learned
          </button>
        )}
      </div>
      {!canFinish && (
        <p className="small muted">
          A few more sentences and there will be enough pauses to set your writer's own pacing.
        </p>
      )}
    </div>
  )
}
