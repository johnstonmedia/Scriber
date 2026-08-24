/**
 * Measuring the silences in somebody's speech.
 *
 * Split in two on purpose. `segmentGaps` is pure — a stream of loudness
 * readings goes in, the lengths of the silences come out — so the part that
 * decides what counts as a pause can be tested without a microphone, which is
 * the part that would otherwise only ever be checked by a person reading a
 * passage and squinting at the result. `PauseMeter` is the thin wrapper that
 * gets real numbers out of a real microphone.
 *
 * Loudness only. No audio is recorded, kept, or sent anywhere: the meter reads
 * the level a few dozen times a second and throws each reading away. That is
 * not a privacy nicety, it is what makes this safe to ask a fifteen-year-old
 * to do.
 */

/** One loudness reading: how loud, and when. */
export type Level = { at: number; rms: number }

export type Segmentation = {
  /** Silences between runs of speech, in milliseconds, in order. */
  gaps: number[]
  /** Runs of speech, so a caller can tell "said nothing" from "said one thing". */
  speechRuns: number
}

export type SegmentOptions = {
  /**
   * Loudness below this counts as silence. Set from the room's own noise
   * floor rather than a constant — a school library and a classroom with
   * thirty people in it are not the same room.
   */
  floor: number
  /**
   * Silences shorter than this are inside speech, not between it: the stop
   * before a plosive, the catch in a breath. Below about 120ms nobody
   * perceives a pause at all.
   */
  minGapMs: number
  /** Speech shorter than this is a cough or a chair, not a word. */
  minSpeechMs: number
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  floor: 0.015,
  minGapMs: 120,
  minSpeechMs: 80,
}

/**
 * Finds the silences between runs of speech.
 *
 * Leading and trailing silence are dropped: the gap before somebody starts
 * reading is not a pause they took, and neither is the one after they finish
 * while they reach for the mouse.
 */
export function segmentGaps(
  levels: Level[],
  options: SegmentOptions = DEFAULT_SEGMENT_OPTIONS,
): Segmentation {
  const runs: Array<{ start: number; end: number }> = []
  let runStart: number | null = null
  let lastLoud: number | null = null

  for (const level of levels) {
    const loud = level.rms >= options.floor
    if (loud) {
      if (runStart === null) runStart = level.at
      lastLoud = level.at
    } else if (runStart !== null && lastLoud !== null) {
      // Only close the run once the silence is long enough to be a real one,
      // so a momentary dip mid-word doesn't split a word in two.
      if (level.at - lastLoud >= options.minGapMs) {
        if (lastLoud - runStart >= options.minSpeechMs) runs.push({ start: runStart, end: lastLoud })
        runStart = null
        lastLoud = null
      }
    }
  }
  if (runStart !== null && lastLoud !== null && lastLoud - runStart >= options.minSpeechMs) {
    runs.push({ start: runStart, end: lastLoud })
  }

  const gaps: number[] = []
  for (let i = 1; i < runs.length; i += 1) {
    gaps.push(runs[i]!.start - runs[i - 1]!.end)
  }
  return { gaps, speechRuns: runs.length }
}

/**
 * The noise floor of this room, from a moment of it being quiet.
 *
 * Taken as a high percentile rather than the maximum so one chair scrape
 * doesn't set the threshold above the student's own voice.
 */
export function noiseFloor(levels: Level[]): number {
  if (levels.length === 0) return DEFAULT_SEGMENT_OPTIONS.floor
  const sorted = levels.map((l) => l.rms).sort((a, b) => a - b)
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!
  // A generous margin above the room, floored so a silent room doesn't
  // produce a threshold that treats breathing as speech.
  return Math.max(DEFAULT_SEGMENT_OPTIONS.floor, p90 * 2.5)
}

/**
 * Reads loudness from the microphone. Nothing is recorded — each reading is
 * used to decide loud-or-quiet and then discarded.
 */
export class PauseMeter {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private timer: number | null = null
  private levels: Level[] = []

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      // Every one of these is normally a kindness and here a distortion: the
      // browser's own noise suppression removes exactly the quiet the meter
      // is trying to measure, and automatic gain flattens the difference
      // between a pause and a word.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    const context = new AudioContext()
    const source = context.createMediaStreamSource(this.stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    this.context = context

    const buffer = new Float32Array(analyser.fftSize)
    this.levels = []
    // ~50Hz. Fast enough to place a 120ms gap within a couple of samples,
    // slow enough to cost nothing on a school laptop.
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (const sample of buffer) sum += sample * sample
      this.levels.push({ at: performance.now(), rms: Math.sqrt(sum / buffer.length) })
    }, 20)
  }

  /** Everything heard since the last call, and clears it. */
  take(): Level[] {
    const taken = this.levels
    this.levels = []
    return taken
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    void this.context?.close()
    this.context = null
  }
}
