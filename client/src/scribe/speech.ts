/**
 * Browser speech in and speech out.
 *
 * Recognition uses the Web Speech API, which in practice means Chrome, Edge or
 * Safari. Recognition stops itself after a pause, so we restart it while the
 * student is still dictating — an exam answer is many minutes long.
 */

type SpeechRecognitionAlternative = { transcript: string; confidence: number }
type SpeechRecognitionResult = {
  isFinal: boolean
  length: number
  0: SpeechRecognitionAlternative
}
type SpeechRecognitionEventLike = {
  resultIndex: number
  results: { length: number; [index: number]: SpeechRecognitionResult }
}
type SpeechRecognitionErrorLike = { error: string; message?: string }

type RecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type RecognitionConstructor = new () => RecognitionLike

function recognitionConstructor(): RecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechRecognitionSupported = () => recognitionConstructor() !== null

export type DictationHandlers = {
  /** A completed burst of speech, ready to be written down. */
  onFinal: (transcript: string) => void
  /** Live text, shown greyed out until it is finalised. */
  onInterim: (transcript: string) => void
  onError: (message: string) => void
  onListeningChange: (listening: boolean) => void
}

export class Dictation {
  private recognition: RecognitionLike | null = null
  private wantListening = false
  private restartTimer: number | null = null

  private handlers: DictationHandlers
  private lang: string

  constructor(handlers: DictationHandlers, lang = 'en-AU') {
    this.handlers = handlers
    this.lang = lang
  }

  get listening() {
    return this.wantListening
  }

  start() {
    const Constructor = recognitionConstructor()
    if (!Constructor) {
      this.handlers.onError(
        'This browser cannot listen for speech. Use Chrome, Edge or Safari, or type your dictation instead.',
      )
      return
    }
    if (this.wantListening) return

    this.wantListening = true
    this.spinUp(Constructor)
    this.handlers.onListeningChange(true)
  }

  private spinUp(Constructor: RecognitionConstructor) {
    const recognition = new Constructor()
    recognition.lang = this.lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result) continue
        const transcript = result[0].transcript
        if (result.isFinal) {
          this.handlers.onFinal(transcript)
        } else {
          interim += transcript
        }
      }
      this.handlers.onInterim(interim)
    }

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.wantListening = false
        this.handlers.onListeningChange(false)
        this.handlers.onError(
          'Microphone access was blocked. Allow the microphone in your browser settings and start again.',
        )
        return
      }
      this.handlers.onError(`Speech recognition problem: ${event.error}.`)
    }

    // Recognition ends on its own after a pause — start it again if the student
    // has not pressed stop.
    recognition.onend = () => {
      if (!this.wantListening) return
      this.restartTimer = window.setTimeout(() => {
        if (!this.wantListening) return
        try {
          recognition.start()
        } catch {
          this.spinUp(Constructor)
        }
      }, 200)
    }

    this.recognition = recognition
    try {
      recognition.start()
    } catch {
      /* start() throws if already running; the onend handler covers restarts. */
    }
  }

  stop() {
    this.wantListening = false
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.recognition?.stop()
    this.handlers.onInterim('')
    this.handlers.onListeningChange(false)
  }

  dispose() {
    this.wantListening = false
    if (this.restartTimer !== null) window.clearTimeout(this.restartTimer)
    this.recognition?.abort()
    this.recognition = null
  }
}

/** The writer reading your answer back to you. */
export const readAloud = {
  supported: () => typeof window !== 'undefined' && 'speechSynthesis' in window,

  speak(text: string, rate = 0.95) {
    if (!this.supported() || !text.trim()) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    utterance.lang = 'en-AU'
    window.speechSynthesis.speak(utterance)
  },

  stop() {
    if (this.supported()) window.speechSynthesis.cancel()
  },
}
