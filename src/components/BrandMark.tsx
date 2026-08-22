/**
 * Scriber's mark: a comma resting on a ruled line.
 *
 * It is the most-said punctuation in the product, drawn sitting on the line it
 * was just written onto — the whole proposition without a word, which is that
 * the mark is on the page because somebody said it out loud.
 *
 * Kept as a component rather than an image so it inherits the current theme's
 * accent and renders crisply at any size, including the 16px it has to survive
 * as a favicon.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Scriber"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect width="64" height="64" rx="18" fill="var(--accent)" />
      {/* the ruled line of the page */}
      <rect x="16" y="50" width="32" height="3" rx="1.5" fill="var(--surface)" opacity="0.42" />
      {/* the mark the student said out loud, resting on it */}
      <path
        d="M42 25a8 8 0 1 0-8 8c0 0 1 8-9 15 14-4 17-15 17-23z"
        fill="var(--surface)"
        transform="translate(-2 0)"
      />
    </svg>
  )
}

/** The mark and the name together, as they appear in the top bar and on sign-in. */
export function BrandLockup({ size = 28, nameSize }: { size?: number; nameSize?: string }) {
  return (
    <span className="brand-lockup">
      <BrandMark size={size} />
      <span className="brand-word" style={nameSize ? { fontSize: nameSize } : undefined}>
        Scriber
      </span>
    </span>
  )
}
