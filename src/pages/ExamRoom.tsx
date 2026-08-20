import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { createAttempt, getPaper, saveAttempt, type Paper } from '../lib/data'
import { getOrgPaper, type OrgPaper } from '../lib/org'
import { RULE_PROFILES } from '../lib/ruleProfile'
import {
  finishTestParticipant,
  joinTestSession,
  subscribeTestSession,
  updateTestProgress,
  type TestSession,
} from '../lib/testSession'
import { CommandDrawer } from '../components/CommandReference'
import { PaperViewer } from '../components/PaperViewer'
import { OrgPaperViewer } from '../components/OrgPaperViewer'
import { Dictation, readAloud, speechRecognitionSupported } from '../scribe/speech'
import {
  applyUtterance,
  chunkUtterance,
  createState,
  lastSentences,
  render,
  type ScribeEvent,
  type ScribeState,
} from '../scribe/engine'
import {
  answerSpelling,
  createMemory,
  drain,
  flush,
  hear,
  load,
  loadTone,
  skipSpelling,
  type MemoryEvent,
  type MemoryState,
  type PendingUnit,
} from '../scribe/workingMemory'

type Phase = 'setup' | 'lobby' | 'reading' | 'working' | 'paused' | 'finished'

type LogEntry = { at: number; heard: string; commands: string[] }

const format = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/**
 * The countdown, isolated in its own memoized component with its own local
 * 1-second tick. ExamRoom re-renders often while the student is
 * dictating — interim speech text, the writer's queue draining — and none of
 * that needs to touch the clock or drag it (and the PDF pane beside it) along
 * for the ride. Ticking once a second rather than four times is also simply
 * all a countdown display needs.
 */
const ExamClock = memo(function ExamClock({
  phaseEndsAt,
  phase,
}: {
  phaseEndsAt: RefObject<number | null>
  phase: Phase
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (phase !== 'reading' && phase !== 'working') return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [phase])

  const remaining = phaseEndsAt.current === null ? 0 : phaseEndsAt.current - now
  const lowTime = remaining < 5 * 60_000
  const clockClass =
    phase === 'reading'
      ? 'clock clock-reading'
      : remaining <= 0
        ? 'clock clock-out'
        : lowTime
          ? 'clock clock-low'
          : 'clock'

  return (
    <div className={clockClass}>
      {phase === 'reading' && (
        <span className="tiny" style={{ marginRight: 6 }}>
          READING
        </span>
      )}
      {remaining <= 0 && phase === 'working' ? "Time's up" : format(Math.abs(remaining))}
    </div>
  )
})

export function ExamRoom() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, settings, memberships } = useAuth()

  const paperId = params.get('paper')
  const orgId = params.get('org')
  const testId = params.get('test')
  const [paper, setPaper] = useState<Paper | null>(null)
  const [orgPaper, setOrgPaper] = useState<OrgPaper | null>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [test, setTest] = useState<TestSession | null>(null)
  const testAttemptStarted = useRef(false)

  /** Whichever source this practice paper came from — personal or distributed. */
  const paperMeta = paper ?? orgPaper

  /**
   * If any class this student belongs to in this org has been assigned a
   * subset of the paper's questions, they see just those — union across
   * classes when they're in more than one. No assignment for any of their
   * classes means null, and the viewer falls back to the whole paper.
   */
  const assignedQuestionIds = useMemo(() => {
    if (!orgPaper || !orgId) return null
    const membership = memberships.find((m) => m.orgId === orgId)
    if (!membership) return null
    const ids = new Set<string>()
    let hasAssignment = false
    for (const classId of membership.classIds) {
      const forClass = orgPaper.classQuestions[classId]
      if (forClass && forClass.length > 0) {
        hasAssignment = true
        forClass.forEach((id) => ids.add(id))
      }
    }
    return hasAssignment ? [...ids] : null
  }, [orgPaper, orgId, memberships])

  const [scribe, setScribe] = useState<ScribeState>(createState)
  const [interim, setInterim] = useState('')
  /** Throttles interim speech text — see handleInterim below. */
  const interimThrottle = useRef<{ timer: number | null; latest: string }>({
    timer: null,
    latest: '',
  })
  const [listening, setListening] = useState(false)
  const [phase, setPhase] = useState<Phase>(() => (testId ? 'lobby' : 'setup'))
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [showCommands, setShowCommands] = useState(false)
  const [typed, setTyped] = useState('')
  const [showPaper, setShowPaper] = useState(true)
  const [extraMinutes, setExtraMinutes] = useState(0)

  // The writer's working memory — the lag, the backlog and the spelling checks.
  const [memory, setMemory] = useState<MemoryState>(() => createMemory(settings.memory))
  const [repeatAsk, setRepeatAsk] = useState<{ lost: number; resumeFrom: string } | null>(null)
  const [spelling, setSpelling] = useState('')
  const memoryRef = useRef(memory)
  memoryRef.current = memory
  const burstRef = useRef(0)
  /** Set below — lets the dictation handler answer an open spelling question. */
  const spellingAnswerRef = useRef<(spoken: string) => void>(() => {})

  // Timing is driven from a wall-clock deadline so a busy tab can't drift. The
  // deadline itself lives in a ref and its display in the isolated <ExamClock>
  // below — nothing about the countdown needs to live in this component's
  // state or re-render it.
  const phaseEndsAt = useRef<number | null>(null)
  const workedMs = useRef(0)
  const dictation = useRef<Dictation | null>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  const scribeRef = useRef(scribe)
  scribeRef.current = scribe
  const logRef = useRef<LogEntry[]>([])
  const startedAt = useRef<number>(Date.now())

  const supported = useMemo(speechRecognitionSupported, [])
  const answerText = useMemo(() => render(scribe.atoms), [scribe.atoms])

  // In a live test, the teacher's standard for the whole class overrides the
  // student's own personal preference — everything else in Settings (memory,
  // read-back rate, font size) stays theirs.
  const effectiveRuleProfile = test ? test.ruleProfile : settings.ruleProfile

  const readingMs = testId
    ? (test?.readingMinutes ?? 10) * 60_000
    : (paperMeta?.readingMinutes ?? 5) * 60_000
  const workingMs = testId
    ? (test?.workingMinutes ?? 40) * 60_000
    : ((paperMeta?.workingMinutes ?? 40) + extraMinutes) * 60_000

  // ------------------------------------------------------------------- load

  useEffect(() => {
    if (!user) return
    if (orgId && paperId) {
      getOrgPaper(orgId, paperId)
        .then(setOrgPaper)
        .catch(() => setNotice('Could not load that paper.'))
      return
    }
    if (paperId) {
      getPaper(user.uid, paperId)
        .then(setPaper)
        .catch(() => setNotice('Could not load that paper.'))
    }
  }, [paperId, orgId, user])

  // ------------------------------------------------------------- live test

  // The shared source of truth for a live test's phase and its deadline —
  // every participant (and the teacher's monitor) watches the same doc.
  useEffect(() => {
    if (!orgId || !testId) return
    return subscribeTestSession(orgId, testId, setTest)
  }, [orgId, testId])

  // Arriving in the waiting room marks this student ready — the teacher's
  // monitor counts this the moment it lands.
  useEffect(() => {
    if (!orgId || !testId || !user) return
    void joinTestSession(orgId, testId, { uid: user.uid, name: user.name })
  }, [orgId, testId, user])

  // A test's paper (if it has one) comes from the test doc, not a `paper=`
  // URL param — there isn't one in test mode.
  useEffect(() => {
    if (!orgId || !test?.paperId) return
    getOrgPaper(orgId, test.paperId)
      .then(setOrgPaper)
      .catch(() => setNotice('Could not load the test paper.'))
  }, [orgId, test?.paperId])

  // Mirrors the synced test phase onto this student's own view. The teacher
  // controls reading → working; a student can never skip ahead of it, and a
  // test the teacher ends is finished for every participant still in it,
  // wherever they'd got to.
  useEffect(() => {
    if (!testId || !test) return
    if (test.phase === 'lobby') {
      setPhase('lobby')
      return
    }
    if (test.phase === 'finished') {
      if (phaseRef.current !== 'finished' && phaseRef.current !== 'setup' && phaseRef.current !== 'lobby') {
        void finish()
      } else {
        setPhase('finished')
      }
      return
    }
    phaseEndsAt.current = test.phaseEndsAt
    if (!testAttemptStarted.current) {
      testAttemptStarted.current = true
      void beginTestAttempt()
    }
    setPhase(test.phase)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test, testId])

  async function beginTestAttempt() {
    startedAt.current = Date.now()
    if (!user) return
    try {
      setAttemptId(
        await createAttempt(user.uid, {
          paperId: test?.paperId && orgId ? `org:${orgId}:${test.paperId}` : test ? `test:${orgId}:${test.id}` : null,
          title: test?.title ?? 'Live test',
          ruleProfile: effectiveRuleProfile,
        }),
      )
    } catch {
      setNotice('Working offline — this session will not be saved to your history.')
    }
  }

  // Throttled progress the teacher's monitor can see — word count and a
  // short trailing preview, not a full transcript, and not on every word.
  useEffect(() => {
    if (!orgId || !testId || !user || phase !== 'working') return
    const id = window.setInterval(() => {
      void updateTestProgress(orgId, testId, user.uid, {
        wordCount: scribeRef.current.stats.words,
        preview: render(scribeRef.current.atoms).slice(-200),
      })
    }, 8000)
    return () => window.clearInterval(id)
  }, [orgId, testId, user, phase])

  // -------------------------------------------------------------- the clock

  // Reading time hands over to working time on its own — scheduled once for
  // exactly when it ends, rather than polled. Polling every quarter-second to
  // ask "has it ended yet?" was re-rendering this whole page, PDF pane
  // included, four times a second for the entire reading period.
  useEffect(() => {
    // A live test's reading → working handover is the teacher's call, driven
    // by the synced test doc (see the "live test" effects above) — not a
    // timer this client computes for itself.
    if (testId) return
    if (phase !== 'reading') return
    const msLeft = Math.max(0, (phaseEndsAt.current ?? Date.now()) - Date.now())
    const id = window.setTimeout(() => {
      phaseEndsAt.current = Date.now() + workingMs
      setPhase('working')
    }, msLeft)
    return () => window.clearTimeout(id)
  }, [phase, workingMs, testId])

  // ------------------------------------------------------------- the writer

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current.slice(-4), { id, text }])
    window.setTimeout(() => setToasts((c) => c.filter((t) => t.id !== id)), 2200)
  }, [])

  const handleEvents = useCallback(
    (events: ScribeEvent[], state: ScribeState) => {
      for (const event of events) {
        if (event.type === 'command') toast(event.label)
        if (event.type === 'notice') setNotice(event.message)
        if (event.type === 'stopReading') readAloud.stop()
        if (event.type === 'readBack') {
          const text =
            event.scope === 'all'
              ? render(state.atoms)
              : lastSentences(state.atoms, 2)
          readAloud.speak(text || 'Nothing has been written yet.', settings.readBackRate)
        }
      }
    },
    [toast, settings.readBackRate],
  )

  /**
   * Units the writer has committed to the page. Consecutive units from the same
   * spoken burst go in together, so "scratch that" still rubs out the whole
   * burst even though the writer wrote it down in pieces.
   */
  const commit = useCallback(
    (units: PendingUnit[], options?: { forceClose?: boolean }) => {
      if (units.length === 0) return
      let state = scribeRef.current
      const events: ScribeEvent[] = []

      for (let i = 0; i < units.length; ) {
        const burst = units[i]!.burst
        let end = i
        while (end < units.length && units[end]!.burst === burst) end++
        const group = units.slice(i, end)
        const text = group.map((unit) => unit.text).join(' ')
        // The writer releases a burst's words a few at a time, at writing
        // pace — an assisted-mode period belongs only on the piece that
        // actually reaches the end of what the student said, never on every
        // partial piece a drain tick happens to release.
        const closeSentence = options?.forceClose || group[group.length - 1]!.lastOfBurst
        const result = applyUtterance(state, text, effectiveRuleProfile, burst, closeSentence)
        state = result.state
        events.push(...result.events)
        i = end
      }

      scribeRef.current = state
      setScribe(state)
      handleEvents(events, state)
    },
    [effectiveRuleProfile, handleEvents],
  )

  const handleMemoryEvents = useCallback(
    (events: MemoryEvent[]) => {
      for (const event of events) {
        if (event.type === 'repeat') {
          setRepeatAsk({ lost: event.lost, resumeFrom: event.resumeFrom })
          readAloud.speak(
            event.resumeFrom
              ? `Sorry, could you say that again from, ${event.resumeFrom}`
              : 'Sorry, could you say that again?',
            settings.readBackRate,
          )
        }
        if (event.type === 'spellCheck') {
          setSpelling('')
          readAloud.speak('How do you spell that?', settings.readBackRate)
        }
        if (event.type === 'spellCheckResult') {
          toast(event.correct ? 'Spelling confirmed' : `Spelled "${event.attempt}"`)
        }
      }
    },
    [settings.readBackRate, toast],
  )

  /** One finished burst of dictation, from the microphone or the keyboard. */
  const write = useCallback(
    (transcript: string) => {
      const heard = transcript.trim()
      if (!heard) return

      // In a live test, reading time is enforced, not just suggested — the
      // writer simply won't take anything down until the teacher moves the
      // class into working time.
      if (testId && phaseRef.current === 'reading') return

      // The writer has stopped and asked a question — whatever you say next is
      // the answer to it, not more of your essay.
      if (memoryRef.current.spellCheck) {
        spellingAnswerRef.current(heard)
        return
      }

      const units = chunkUtterance(heard, effectiveRuleProfile)
      if (units.length === 0) return

      const burst = ++burstRef.current
      const result = hear(memoryRef.current, units, Date.now(), burst)
      memoryRef.current = result.memory
      setMemory(result.memory)
      handleMemoryEvents(result.events)

      logRef.current = [
        ...logRef.current,
        { at: Date.now() - startedAt.current, heard, commands: [] },
      ]
    },
    [testId, effectiveRuleProfile, handleMemoryEvents],
  )

  // A test hook for driving the writer's long timers without waiting them out.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __scriberAgeSession?: (ms: number) => void }
    w.__scriberAgeSession = (ms: number) => {
      const aged = {
        ...memoryRef.current,
        startedAt: (memoryRef.current.startedAt ?? Date.now()) - ms,
      }
      memoryRef.current = aged
      setMemory(aged)
    }
    return () => {
      delete w.__scriberAgeSession
    }
  }, [])

  // The pen moves on its own clock, a beat behind the student.
  useEffect(() => {
    if (phase !== 'working' && phase !== 'reading') return
    const id = window.setInterval(() => {
      const current = memoryRef.current
      if (current.pending.length === 0 || current.spellCheck) return
      const result = drain(current, Date.now())
      if (result.released.length === 0 && result.events.length === 0) return
      memoryRef.current = result.memory
      setMemory(result.memory)
      commit(result.released)
      handleMemoryEvents(result.events)
    }, 120)
    return () => window.clearInterval(id)
  }, [phase, commit, handleMemoryEvents])

  /**
   * Chrome fires interim speech results many times a second while the student
   * is actively talking — setting state on every single one re-renders this
   * whole page (including the PDF pane) at that same rate. Throttled to a
   * gentle 80ms, well under what's perceptible as "instant", except the empty
   * string on stop, which clears immediately rather than lagging behind.
   */
  const handleInterim = useCallback((text: string) => {
    const state = interimThrottle.current
    state.latest = text
    if (text === '') {
      if (state.timer !== null) {
        window.clearTimeout(state.timer)
        state.timer = null
      }
      setInterim('')
      return
    }
    if (state.timer !== null) return
    state.timer = window.setTimeout(() => {
      state.timer = null
      setInterim(state.latest)
    }, 80)
  }, [])

  useEffect(() => {
    const instance = new Dictation(
      {
        onFinal: write,
        onInterim: handleInterim,
        onError: setNotice,
        onListeningChange: setListening,
      },
      settings.recogniserLanguage,
    )
    dictation.current = instance
    return () => {
      instance.dispose()
      dictation.current = null
      if (interimThrottle.current.timer !== null) {
        window.clearTimeout(interimThrottle.current.timer)
        interimThrottle.current.timer = null
      }
    }
  }, [write, handleInterim, settings.recogniserLanguage])

  // Keep the newest text in view as the writer works.
  useEffect(() => {
    const node = answerRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [answerText, interim])

  // ------------------------------------------------------------- persistence

  const saveTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!attemptId || !user || phase === 'setup' || phase === 'finished') return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void saveAttempt(user.uid, attemptId, {
        answerText,
        atoms: scribe.atoms,
        stats: { ...scribe.stats, writer: memory.stats },
        log: logRef.current,
        durationMs: Date.now() - startedAt.current,
      }).catch(() =>
        setNotice('Your work could not be saved just now. It is still on screen.'),
      )
    }, 2000)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [answerText, scribe, memory, attemptId, user, phase])

  // ---------------------------------------------------------------- actions

  async function beginSession(skipReading: boolean) {
    startedAt.current = Date.now()
    if (user) {
      try {
        setAttemptId(
          await createAttempt(user.uid, {
            paperId: orgPaper ? `org:${orgId}:${orgPaper.id}` : paper?.id ?? null,
            title: paperMeta?.title ?? 'Free practice',
            ruleProfile: settings.ruleProfile,
          }),
        )
      } catch {
        setNotice('Working offline — this session will not be saved to your history.')
      }
    }
    if (skipReading || readingMs === 0) {
      phaseEndsAt.current = Date.now() + workingMs
      setPhase('working')
    } else {
      phaseEndsAt.current = Date.now() + readingMs
      setPhase('reading')
    }
  }

  function submitSpelling(spoken: string) {
    const result = answerSpelling(memoryRef.current, spoken, {
      // Where spelling is assessed the writer must put down what was spelled.
      writeStudentSpelling: effectiveRuleProfile === 'strict',
    })
    if (result.released.length === 0) return
    memoryRef.current = result.memory
    setMemory(result.memory)
    commit(result.released)
    handleMemoryEvents(result.events)
    setSpelling('')
  }

  spellingAnswerRef.current = submitSpelling

  function passOnSpelling() {
    const result = skipSpelling(memoryRef.current)
    memoryRef.current = result.memory
    setMemory(result.memory)
    commit(result.released)
    setSpelling('')
  }

  function toggleMic() {
    if (!dictation.current) return
    if (listening) {
      dictation.current.stop()
    } else {
      setNotice(null)
      dictation.current.start()
    }
  }

  function pause() {
    dictation.current?.stop()
    readAloud.stop()
    workedMs.current = phaseEndsAt.current ? phaseEndsAt.current - Date.now() : 0
    setPhase('paused')
  }

  function resume() {
    phaseEndsAt.current = Date.now() + workedMs.current
    setPhase('working')
  }

  async function finish() {
    dictation.current?.stop()
    readAloud.stop()

    // Whatever the writer still had in hand goes onto the page before we score
    // it — genuinely the end of the answer, so force the closing punctuation
    // even if the last word released here wasn't the last word of its burst.
    const flushed = flush(memoryRef.current)
    memoryRef.current = flushed.memory
    setMemory(flushed.memory)
    commit(flushed.released, { forceClose: true })
    setPhase('finished')
    if (testId && orgId && user) {
      void finishTestParticipant(orgId, testId, user.uid).catch(() => undefined)
    }
    if (!attemptId || !user) {
      setNotice('This session was not saved because Firebase was unreachable.')
      return
    }
    try {
      await saveAttempt(user.uid, attemptId, {
        answerText,
        atoms: scribe.atoms,
        stats: { ...scribe.stats, writer: memoryRef.current.stats },
        log: logRef.current,
        durationMs: Date.now() - startedAt.current,
        status: 'finished',
      })
      navigate(`/sessions/${attemptId}`)
    } catch {
      setNotice('Could not save the finished session. Copy your answer before leaving.')
    }
  }

  // ------------------------------------------------------------------- views

  if (phase === 'setup') {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-head">
          <div className="grow">
            <h1>{paperMeta ? paperMeta.title : 'Free practice'}</h1>
            <p className="muted">
              {paperMeta
                ? `${paperMeta.readingMinutes} min reading · ${paperMeta.workingMinutes} min working`
                : 'No paper attached — practise dictating from anything in front of you.'}
            </p>
          </div>
        </div>

        <div className="card card-pad stack gap-4">
          <div>
            <h2>Before you start</h2>
            <p className="muted small" style={{ marginTop: 6 }}>
              You are the one in charge of the page. Your writer will not add a single full stop,
              capital or paragraph unless you say it out loud.
            </p>
          </div>

          <div className="stack gap-2">
            <div className="row gap-2 wrap">
              <span className="badge badge-accent">{RULE_PROFILES[settings.ruleProfile].full}</span>
              {supported ? (
                <span className="badge badge-good">Microphone ready</span>
              ) : (
                <span className="badge badge-warn">No speech in this browser — type instead</span>
              )}
            </div>
            {!supported && (
              <p className="small muted">
                Speech recognition needs Chrome, Edge or Safari. You can still practise by typing
                each spoken burst into the box at the bottom.
              </p>
            )}
          </div>

          <div className="field" style={{ maxWidth: 240 }}>
            <label htmlFor="extra">Extra time (rest breaks or extra working time)</label>
            <select
              id="extra"
              className="input"
              value={extraMinutes}
              onChange={(e) => setExtraMinutes(Number(e.target.value))}
            >
              <option value={0}>None</option>
              <option value={5}>+5 minutes</option>
              <option value={10}>+10 minutes</option>
              <option value={15}>+15 minutes</option>
              <option value={20}>+20 minutes</option>
              <option value={30}>+30 minutes</option>
            </select>
          </div>

          <hr className="divider" />

          <div className="row gap-2 wrap">
            <button className="btn btn-primary btn-lg" onClick={() => void beginSession(false)}>
              Start with reading time
            </button>
            <button className="btn btn-lg" onClick={() => void beginSession(true)}>
              Skip to working time
            </button>
            <button className="btn btn-ghost spacer" onClick={() => setShowCommands(true)}>
              What do I say?
            </button>
          </div>
        </div>

        {showCommands && <CommandDrawer onClose={() => setShowCommands(false)} />}
      </div>
    )
  }

  if (phase === 'lobby') {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-head">
          <div className="grow">
            <h1>{test?.title ?? 'Live test'}</h1>
            <p className="muted">{test?.className ? `${test.className} · ` : ''}Waiting for teacher to begin exam</p>
          </div>
          <button className="btn btn-ghost" onClick={() => navigate('/')}>
            Leave
          </button>
        </div>

        <div className="card card-pad stack gap-4">
          <div className="row gap-2 wrap">
            <span className="badge badge-good">You're marked ready</span>
            {test && <span className="badge badge-accent">{RULE_PROFILES[test.ruleProfile].full}</span>}
          </div>
          <p className="muted small">
            The teacher will start the test for the whole class at once. This screen updates itself —
            no need to refresh.
          </p>
        </div>
      </div>
    )
  }

  const memoryLoad = load(memory)
  const tone = loadTone(memoryLoad)
  const toneLabel =
    tone === 'critical'
      ? 'Slow down — your writer is losing it'
      : tone === 'busy'
        ? 'Your writer is falling behind'
        : 'Your writer is keeping up'

  return (
    <div className="exam-shell">
      <header className="exam-bar">
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('/')}>
          ← Leave
        </button>

        <ExamClock phaseEndsAt={phaseEndsAt} phase={phase} />

        <span className="badge">{RULE_PROFILES[effectiveRuleProfile].short}</span>
        <span className="badge">{scribe.stats.words} words</span>
        {testId && <span className="badge badge-accent">Live test</span>}

        <div className="spacer" />

        {paperMeta && (
          <button className="btn btn-sm" onClick={() => setShowPaper((v) => !v)}>
            {showPaper ? 'Hide paper' : 'Show paper'}
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setShowCommands(true)}>
          What to say
        </button>
        {!testId &&
          (phase === 'paused' ? (
            <button className="btn btn-sm btn-primary" onClick={resume}>
              Resume
            </button>
          ) : (
            <button className="btn btn-sm" onClick={pause}>
              Pause
            </button>
          ))}
        <button className="btn btn-sm btn-primary" onClick={() => void finish()}>
          Finish
        </button>
      </header>

      <div
        className="load-bar no-print"
        data-tone={tone}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(memoryLoad * 100)}
        aria-label={toneLabel}
        title={toneLabel}
      >
        <div className="load-bar-fill" style={{ width: `${memoryLoad * 100}%` }} />
        {tone !== 'calm' && <span className="load-bar-label">{toneLabel}</span>}
      </div>

      {repeatAsk && (
        <div className="writer-says no-print" role="alert">
          <span className="writer-says-icon" aria-hidden="true">!</span>
          <div className="grow">
            <strong>Sorry — could you say that again?</strong>
            <div className="small">
              {repeatAsk.resumeFrom
                ? <>I lost the last {repeatAsk.lost} {repeatAsk.lost === 1 ? 'word' : 'words'}. Carry on from &ldquo;<em>{repeatAsk.resumeFrom}</em>&rdquo;.</>
                : <>I lost the last {repeatAsk.lost} {repeatAsk.lost === 1 ? 'word' : 'words'}. Start that part again.</>}
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => setRepeatAsk(null)}>
            Got it
          </button>
        </div>
      )}

      {notice && (
        <div className="alert alert-warn no-print" style={{ borderRadius: 0 }}>
          <div className="row gap-3">
            <span className="grow">{notice}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="exam-body" data-panes={paperMeta && showPaper ? 'split' : 'answer-only'}>
        {paperMeta && showPaper && (
          <>
            <div className="pane pane-paper">
              {orgPaper ? (
                <OrgPaperViewer paper={orgPaper} assignedQuestionIds={assignedQuestionIds} />
              ) : paper ? (
                <PaperViewer paper={paper} uid={user?.uid ?? ''} />
              ) : null}
            </div>
            <div className="pane-divider" />
          </>
        )}

        <div className="pane pane-answer answer-pane">
          <div className="answer-scroll" ref={answerRef}>
            <div className="answer-sheet" data-size={settings.fontSize}>
              {answerText || (
                <span className="answer-placeholder">
                  {phase === 'reading'
                    ? 'Reading time. Read the question — your writer starts when you do.'
                    : 'Start the microphone and dictate. Say your punctuation as you go.'}
                </span>
              )}
              {memory.spellCheck && <span className="awaiting-spelling"> ▁▁▁▁▁</span>}
              {settings.showLiveText && interim && (
                <span className="interim"> {interim}</span>
              )}
            </div>
          </div>

          {memory.spellCheck && (
            <div className="spell-check no-print">
              <div className="row gap-3 wrap">
                <span className="writer-says-icon" aria-hidden="true">?</span>
                <div className="grow">
                  <strong>How do you spell that?</strong>
                  <div className="small muted">
                    Spell the word you just said, letter by letter — say it or type it.
                    Your writer has stopped until you do.
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={passOnSpelling}>
                  Skip
                </button>
              </div>
              <form
                className="row gap-2"
                style={{ marginTop: 10 }}
                onSubmit={(event) => {
                  event.preventDefault()
                  submitSpelling(spelling)
                }}
              >
                <input
                  className="input grow"
                  autoFocus
                  value={spelling}
                  onChange={(event) => setSpelling(event.target.value)}
                  placeholder="i r r e v e r s i b l e"
                  aria-label="Spell the word"
                />
                <button className="btn btn-primary" disabled={!spelling.trim()}>
                  That's it
                </button>
              </form>
            </div>
          )}

          <div className="mic-dock no-print">
            <button
              type="button"
              className="mic-button"
              data-live={listening}
              onClick={toggleMic}
              disabled={!supported || phase === 'paused' || (!!testId && phase === 'reading')}
            >
              <span className="mic-dot" />
              {listening ? 'Listening — press to stop' : 'Start dictating'}
            </button>

            <button
              className="btn"
              onClick={() =>
                readAloud.speak(lastSentences(scribe.atoms, 2) || 'Nothing written yet.', settings.readBackRate)
              }
            >
              Read back
            </button>

            <form
              className="type-fallback"
              onSubmit={(event) => {
                event.preventDefault()
                write(typed)
                setTyped('')
              }}
            >
              <input
                className="input"
                placeholder='Or type what you would say — "and so comma new paragraph"'
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Type your dictation"
              />
              <button className="btn" type="submit" disabled={!typed.trim() || (!!testId && phase === 'reading')}>
                Write
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="command-log no-print" aria-live="polite">
        {toasts.map((t) => (
          <div className="command-toast" key={t.id}>
            {t.text}
          </div>
        ))}
      </div>

      {showCommands && <CommandDrawer onClose={() => setShowCommands(false)} />}
    </div>
  )
}
