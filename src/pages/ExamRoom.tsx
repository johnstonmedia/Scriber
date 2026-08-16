import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { createAttempt, getPaper, saveAttempt, type Paper } from '../lib/data'
import { CommandDrawer } from '../components/CommandReference'
import { PaperViewer } from '../components/PaperViewer'
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

type Phase = 'setup' | 'reading' | 'working' | 'paused' | 'finished'

type LogEntry = { at: number; heard: string; commands: string[] }

const format = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function ExamRoom() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, settings } = useAuth()

  const paperId = params.get('paper')
  const [paper, setPaper] = useState<Paper | null>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)

  const [scribe, setScribe] = useState<ScribeState>(createState)
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [phase, setPhase] = useState<Phase>('setup')
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

  // Timing is driven from a wall-clock deadline so a busy tab can't drift.
  const [now, setNow] = useState(() => Date.now())
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

  const readingMs = (paper?.readingMinutes ?? 5) * 60_000
  const workingMs = ((paper?.workingMinutes ?? 40) + extraMinutes) * 60_000

  // ------------------------------------------------------------------- load

  useEffect(() => {
    if (!paperId || !user) return
    getPaper(user.uid, paperId)
      .then(setPaper)
      .catch(() => setNotice('Could not load that paper.'))
  }, [paperId, user])

  // -------------------------------------------------------------- the clock

  useEffect(() => {
    if (phase !== 'reading' && phase !== 'working') return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [phase])

  const remaining = phaseEndsAt.current === null ? 0 : phaseEndsAt.current - now

  useEffect(() => {
    if (phase !== 'reading' || remaining > 0) return
    phaseEndsAt.current = Date.now() + workingMs
    setPhase('working')
  }, [phase, remaining, workingMs])

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
    (units: PendingUnit[]) => {
      if (units.length === 0) return
      let state = scribeRef.current
      const events: ScribeEvent[] = []

      for (let i = 0; i < units.length; ) {
        const burst = units[i]!.burst
        let end = i
        while (end < units.length && units[end]!.burst === burst) end++
        const text = units.slice(i, end).map((unit) => unit.text).join(' ')
        const result = applyUtterance(state, text, settings.ruleProfile, burst)
        state = result.state
        events.push(...result.events)
        i = end
      }

      scribeRef.current = state
      setScribe(state)
      handleEvents(events, state)
    },
    [settings.ruleProfile, handleEvents],
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

      // The writer has stopped and asked a question — whatever you say next is
      // the answer to it, not more of your essay.
      if (memoryRef.current.spellCheck) {
        spellingAnswerRef.current(heard)
        return
      }

      const units = chunkUtterance(heard, settings.ruleProfile)
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
    [settings.ruleProfile, handleMemoryEvents],
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

  useEffect(() => {
    const instance = new Dictation(
      {
        onFinal: write,
        onInterim: setInterim,
        onError: setNotice,
        onListeningChange: setListening,
      },
      settings.recogniserLanguage,
    )
    dictation.current = instance
    return () => {
      instance.dispose()
      dictation.current = null
    }
  }, [write, settings.recogniserLanguage])

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
            paperId: paper?.id ?? null,
            title: paper?.title ?? 'Free practice',
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
    setNow(Date.now())
  }

  function submitSpelling(spoken: string) {
    const result = answerSpelling(memoryRef.current, spoken, {
      // Where spelling is assessed the writer must put down what was spelled.
      writeStudentSpelling: settings.ruleProfile === 'strict',
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
    setNow(Date.now())
    setPhase('working')
  }

  async function finish() {
    dictation.current?.stop()
    readAloud.stop()

    // Whatever the writer still had in hand goes onto the page before we score it.
    const flushed = flush(memoryRef.current)
    memoryRef.current = flushed.memory
    setMemory(flushed.memory)
    commit(flushed.released)
    setPhase('finished')
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
            <h1>{paper ? paper.title : 'Free practice'}</h1>
            <p className="muted">
              {paper
                ? `${paper.readingMinutes} min reading · ${paper.workingMinutes} min working`
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
              <span className="badge badge-accent">
                {settings.ruleProfile === 'strict'
                  ? 'Strict — you dictate every mark'
                  : 'Assisted — the writer may add punctuation'}
              </span>
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

  const memoryLoad = load(memory)
  const tone = loadTone(memoryLoad)
  const toneLabel =
    tone === 'critical'
      ? 'Slow down — your writer is losing it'
      : tone === 'busy'
        ? 'Your writer is falling behind'
        : 'Your writer is keeping up'

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
    <div className="exam-shell">
      <header className="exam-bar">
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('/')}>
          ← Leave
        </button>

        <div className={clockClass}>
          {phase === 'reading' && <span className="tiny" style={{ marginRight: 6 }}>READING</span>}
          {remaining <= 0 && phase === 'working' ? "Time's up" : format(Math.abs(remaining))}
        </div>

        <span className="badge">
          {settings.ruleProfile === 'strict' ? 'Strict scribe rules' : 'Assisted'}
        </span>
        <span className="badge">{scribe.stats.words} words</span>

        <div className="spacer" />

        {paper && (
          <button className="btn btn-sm" onClick={() => setShowPaper((v) => !v)}>
            {showPaper ? 'Hide paper' : 'Show paper'}
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setShowCommands(true)}>
          What to say
        </button>
        {phase === 'paused' ? (
          <button className="btn btn-sm btn-primary" onClick={resume}>
            Resume
          </button>
        ) : (
          <button className="btn btn-sm" onClick={pause}>
            Pause
          </button>
        )}
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

      <div className="exam-body" data-panes={paper && showPaper ? 'split' : 'answer-only'}>
        {paper && showPaper && (
          <>
            <div className="pane pane-paper">
              <PaperViewer paper={paper} />
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
              disabled={!supported || phase === 'paused'}
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
              <button className="btn" type="submit" disabled={!typed.trim()}>
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
