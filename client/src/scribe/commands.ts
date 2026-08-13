/**
 * The spoken command vocabulary.
 *
 * A scribe only writes what the student says. Anything in this table is a
 * *instruction* to the scribe rather than words to be written down. Everything
 * else is written verbatim.
 *
 * Phrases are matched longest-first, so "question mark" wins over "question".
 */

export type PunctuationCommand = {
  kind: 'punctuation'
  /** Characters written into the answer. */
  text: string
  /**
   * How the mark sits against neighbouring words:
   *  left   — tight against the word before  ("war,")
   *  right  — tight against the word after   ("(war")
   *  both   — tight against both             ("self-aware")
   *  spaced — a space either side            ("war — peace")
   */
  attach: 'left' | 'right' | 'both' | 'spaced'
  /** Ends a sentence — used for read-back and for coaching stats. */
  terminal?: boolean
  /** Toggling pairs (quotes, brackets) alternate between two characters. */
  pairWith?: string
}

export type StructureCommand = {
  kind: 'structure'
  action: 'paragraph' | 'line'
}

export type ModifierCommand = {
  kind: 'modifier'
  action: 'capital' | 'allCaps' | 'capsOn' | 'capsOff' | 'lowerCase'
}

export type EditCommand = {
  kind: 'edit'
  action: 'scratchThat' | 'deleteWord' | 'deleteSentence'
}

export type ControlCommand = {
  kind: 'control'
  action: 'readBack' | 'readBackAll' | 'stopReading'
}

export type Command =
  | PunctuationCommand
  | StructureCommand
  | ModifierCommand
  | EditCommand
  | ControlCommand

export type CommandEntry = {
  /** Canonical name shown in the reference card. */
  label: string
  /** Every spoken phrase that triggers it. */
  phrases: string[]
  command: Command
  /** Grouping for the on-screen reference card. */
  group: 'Punctuation' | 'Structure' | 'Capitals' | 'Corrections' | 'Read back'
  /** Shown in the reference card as an example. */
  example?: string
}

const p = (
  text: string,
  attach: PunctuationCommand['attach'] = 'left',
  extra: Partial<PunctuationCommand> = {},
): PunctuationCommand => ({ kind: 'punctuation', text, attach, ...extra })

export const COMMANDS: CommandEntry[] = [
  // ---------------------------------------------------------------- Punctuation
  {
    label: 'Full stop',
    phrases: ['full stop', 'fullstop', 'period', 'point stop'],
    command: p('.', 'left', { terminal: true }),
    group: 'Punctuation',
    example: '"the war ended full stop" → the war ended.',
  },
  {
    label: 'Comma',
    phrases: ['comma'],
    command: p(','),
    group: 'Punctuation',
  },
  {
    label: 'Question mark',
    phrases: ['question mark'],
    command: p('?', 'left', { terminal: true }),
    group: 'Punctuation',
  },
  {
    label: 'Exclamation mark',
    phrases: ['exclamation mark', 'exclamation point'],
    command: p('!', 'left', { terminal: true }),
    group: 'Punctuation',
  },
  {
    label: 'Semicolon',
    phrases: ['semicolon', 'semi colon'],
    command: p(';'),
    group: 'Punctuation',
  },
  {
    label: 'Colon',
    phrases: ['colon'],
    command: p(':'),
    group: 'Punctuation',
  },
  {
    label: 'Apostrophe',
    phrases: ['apostrophe'],
    command: p('’', 'both'),
    group: 'Punctuation',
    example: '"student apostrophe s" → student’s',
  },
  {
    label: 'Open quotation marks',
    phrases: [
      'open quotation marks',
      'open quotation mark',
      'open quotes',
      'open quote',
      'open inverted commas',
      'quote',
    ],
    command: p('“', 'right'),
    group: 'Punctuation',
  },
  {
    label: 'Close quotation marks',
    phrases: [
      'close quotation marks',
      'close quotation mark',
      'close quotes',
      'close quote',
      'closed quotes',
      'close inverted commas',
      'unquote',
      'end quote',
    ],
    command: p('”', 'left'),
    group: 'Punctuation',
  },
  {
    label: 'Single quote (open)',
    phrases: ['open single quote', 'open single quotation mark'],
    command: p('‘', 'right'),
    group: 'Punctuation',
  },
  {
    label: 'Single quote (close)',
    phrases: ['close single quote', 'close single quotation mark'],
    command: p('’', 'left'),
    group: 'Punctuation',
  },
  {
    label: 'Open bracket',
    phrases: ['open bracket', 'open brackets', 'open parenthesis', 'left bracket'],
    command: p('(', 'right'),
    group: 'Punctuation',
  },
  {
    label: 'Close bracket',
    phrases: ['close bracket', 'close brackets', 'close parenthesis', 'right bracket'],
    command: p(')', 'left'),
    group: 'Punctuation',
  },
  {
    label: 'Dash',
    phrases: ['dash', 'em dash'],
    command: p('—', 'spaced'),
    group: 'Punctuation',
  },
  {
    label: 'Hyphen',
    phrases: ['hyphen'],
    command: p('-', 'both'),
    group: 'Punctuation',
    example: '"self hyphen aware" → self-aware',
  },
  {
    label: 'Ellipsis',
    phrases: ['ellipsis', 'dot dot dot'],
    command: p('…'),
    group: 'Punctuation',
  },
  {
    label: 'Slash',
    phrases: ['slash', 'forward slash'],
    command: p('/', 'both'),
    group: 'Punctuation',
  },

  // ----------------------------------------------------------------- Structure
  {
    label: 'New paragraph',
    phrases: ['new paragraph', 'new para', 'next paragraph', 'paragraph break'],
    command: { kind: 'structure', action: 'paragraph' },
    group: 'Structure',
    example: 'Starts a new paragraph. Say it after your full stop.',
  },
  {
    label: 'New line',
    phrases: ['new line', 'next line', 'line break'],
    command: { kind: 'structure', action: 'line' },
    group: 'Structure',
  },

  // ------------------------------------------------------------------ Capitals
  {
    label: 'Capital',
    phrases: ['capital', 'capitalise', 'capitalize', 'cap'],
    command: { kind: 'modifier', action: 'capital' },
    group: 'Capitals',
    example: '"capital australia" → Australia',
  },
  {
    label: 'All caps (one word)',
    phrases: ['all capitals', 'all caps'],
    command: { kind: 'modifier', action: 'allCaps' },
    group: 'Capitals',
    example: '"all caps nesa" → NESA',
  },
  {
    label: 'Caps on',
    phrases: ['caps on', 'capitals on'],
    command: { kind: 'modifier', action: 'capsOn' },
    group: 'Capitals',
  },
  {
    label: 'Caps off',
    phrases: ['caps off', 'capitals off'],
    command: { kind: 'modifier', action: 'capsOff' },
    group: 'Capitals',
  },

  // --------------------------------------------------------------- Corrections
  {
    label: 'Scratch that',
    phrases: ['scratch that', 'delete that', 'strike that'],
    command: { kind: 'edit', action: 'scratchThat' },
    group: 'Corrections',
    example: 'Removes everything you said in your last burst of dictation.',
  },
  {
    label: 'Delete last word',
    phrases: ['delete last word', 'delete word', 'rub out last word'],
    command: { kind: 'edit', action: 'deleteWord' },
    group: 'Corrections',
  },
  {
    label: 'Delete last sentence',
    phrases: ['delete last sentence', 'delete sentence'],
    command: { kind: 'edit', action: 'deleteSentence' },
    group: 'Corrections',
  },

  // ----------------------------------------------------------------- Read back
  {
    label: 'Read back',
    phrases: ['read back', 'read that back', 'read it back', 'read back last two sentences'],
    command: { kind: 'control', action: 'readBack' },
    group: 'Read back',
    example: 'Your writer reads the last 2 sentences back to you.',
  },
  {
    label: 'Read back everything',
    phrases: ['read back everything', 'read back all', 'read the whole answer'],
    command: { kind: 'control', action: 'readBackAll' },
    group: 'Read back',
  },
  {
    label: 'Stop reading',
    phrases: ['stop reading', 'stop read back'],
    command: { kind: 'control', action: 'stopReading' },
    group: 'Read back',
  },
]

/** Phrase → command, longest phrase first so multi-word commands win. */
export type PhraseIndex = { words: string[]; entry: CommandEntry }[]

export function buildPhraseIndex(enabled?: (e: CommandEntry) => boolean): PhraseIndex {
  const index: PhraseIndex = []
  for (const entry of COMMANDS) {
    if (enabled && !enabled(entry)) continue
    for (const phrase of entry.phrases) {
      index.push({ words: phrase.split(' '), entry })
    }
  }
  return index.sort((a, b) => b.words.length - a.words.length)
}

export const MAX_PHRASE_WORDS = COMMANDS.reduce(
  (max, e) => Math.max(max, ...e.phrases.map((p) => p.split(' ').length)),
  1,
)
