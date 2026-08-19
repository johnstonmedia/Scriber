/**
 * Display copy for the two scribe rule profiles, named by the regime they
 * actually match rather than by how strict they feel.
 *
 * NESA's HSC writer provision is the lenient one — a writer may add
 * punctuation and capitals unprompted. The word-for-word, dictate-every-mark
 * regime is NAPLAN's scribe protocol and the UK JCQ's, not the HSC's. Naming
 * the modes after "strict" and "assisted" alone invited exactly that mix-up,
 * so every place a mode is shown to a user should read from here instead of
 * writing its own label.
 */

export type RuleProfile = 'strict' | 'assisted'

export const RULE_PROFILES: Record<
  RuleProfile,
  { short: string; full: string; description: string; citation: string }
> = {
  strict: {
    short: 'NAPLAN / JCQ Scribe',
    full: 'NAPLAN / JCQ Scribe — you dictate every mark',
    description:
      "Your words are written in lower case with no punctuation except what you say out loud. This is NAPLAN's scribe protocol and the UK JCQ's access-arrangement rules for a scribe — not the HSC writer rules. It's the harder, safer way to practise if your own provision requires dictated punctuation.",
    citation:
      '"The scribe will write word for word... printing all words in lower case without any punctuation, except as dictated by the student." — NAPLAN national protocols',
  },
  assisted: {
    short: 'HSC Writer (NESA)',
    full: 'HSC Writer (NESA) — the writer may add punctuation and capitals',
    description:
      "Under NESA's HSC writer provision, a writer may add punctuation and capital letters without being told to. Your session report shows how many they added, so you can see what you would have missed.",
    citation:
      '"A writer can add punctuation and capital letters without the specific direction of the student." — NESA, Writer provision',
  },
}
