import { useEffect, useRef, useState } from 'react'
import { applyUtterance, chunkUtterance, createState, render, type ScribeState } from '../scribe/engine'
import {
  createMemory,
  drain,
  hear,
  load,
  loadTone,
  MEMORY_PRESETS,
  type MemoryState,
  type PendingUnit,
} from '../scribe/workingMemory'
import { useReveal } from '../lib/useReveal'

/**
 * A scripted dictation, run through the real engine and working memory —
 * not a fake animation. What a visitor sees here is exactly what a student
 * sees: the lag, the load bar, and one deliberate "too fast" moment.
 */
const SCRIPT: { text: string; pauseAfterMs: number }[] = [
  { text: 'capital the composer represents discovery comma not as a single moment', pauseAfterMs: 300 },
  {
    text: 'but as a sequence of unsettling realisations that build across the whole text and refuse to resolve neatly by the final stanza which is exactly the point the poet is making',
    pauseAfterMs: 1200,
  },
  { text: 'full stop', pauseAfterMs: 600 },
]

export function HomeDemo() {
  const { ref, visible } = useReveal<HTMLDivElement>(0.3)
  const [scribe, setScribe] = useState<ScribeState>(createState)
  const [memory, setMemory] = useState<MemoryState>(() => createMemory(MEMORY_PRESETS.demanding!.settings))
  const [caption, setCaption] = useState<'idle' | 'talking' | 'repeat' | 'done'>('idle')
  const started = useRef(false)

  useEffect(() => {
    if (!visible || started.current) return
    started.current = true

    let cancelled = false
    let memoryState = createMemory(MEMORY_PRESETS.demanding!.settings)
    let scribeState = createState()
    let burst = 0

    const drainTimer = window.setInterval(() => {
      if (cancelled) return
      const result = drain(memoryState, Date.now())
      memoryState = result.memory
      if (result.released.length > 0) {
        scribeState = commitUnits(scribeState, result.released)
      }
      if (result.events.some((e) => e.type === 'repeat')) setCaption('repeat')
      setMemory(memoryState)
      setScribe(scribeState)
    }, 120)

    async function runScript() {
      for (const step of SCRIPT) {
        if (cancelled) return
        setCaption('talking')
        burst += 1
        const result = hear(memoryState, chunkUtterance(step.text), Date.now(), burst)
        memoryState = result.memory
        setMemory(memoryState)
        await sleep(step.pauseAfterMs)
      }
      await sleep(2500)
      if (!cancelled) setCaption('done')
    }

    void runScript()
    return () => {
      cancelled = true
      window.clearInterval(drainTimer)
    }
  }, [visible])

  const text = render(scribe.atoms)
  const level = load(memory)
  const tone = loadTone(level)

  return (
    <div className="demo-widget" ref={ref}>
      <div className={`demo-load-bar`} data-tone={tone}>
        <div className="demo-load-fill" style={{ width: `${level * 100}%` }} />
      </div>
      <div className="demo-sheet">
        {text || <span className="demo-placeholder">The writer is listening…</span>}
        {caption === 'talking' && <span className="demo-cursor" />}
      </div>
      <div className="demo-caption">
        {caption === 'idle' && 'Scroll here and the writer starts listening.'}
        {caption === 'talking' && 'Dictating — watch the words land a beat behind.'}
        {caption === 'repeat' && '"Sorry — could you say that again?" The writer just lost the tail end.'}
        {caption === 'done' && 'That’s the real engine — the same one every student practises against.'}
      </div>
    </div>
  )
}

function commitUnits(state: ScribeState, units: PendingUnit[]): ScribeState {
  let next = state
  for (let i = 0; i < units.length; ) {
    const burst = units[i]!.burst
    let end = i
    while (end < units.length && units[end]!.burst === burst) end++
    const text = units
      .slice(i, end)
      .map((u) => u.text)
      .join(' ')
    next = applyUtterance(next, text, 'assisted', burst, end === units.length).state
    i = end
  }
  return next
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
