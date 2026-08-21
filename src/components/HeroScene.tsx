/**
 * The hero's illustration: what Scriber actually is, drawn rather than
 * described. Spoken words leave the microphone as tokens, some of them
 * punctuation the student said out loud; they queue in the writer's hand —
 * the gauge — and land on the page a beat later, in the writer's hand.
 *
 * Pure SVG and CSS so it costs nothing to load, scales to any width, and
 * stays legible in both themes. It stops entirely under
 * prefers-reduced-motion, where the drawn end-state is the point anyway.
 */
export function HeroScene() {
  const spoken = ['capital', 'the', 'war', 'ended', 'comma', 'finally', 'full stop']

  return (
    <div className="hero-scene" aria-hidden="true">
      <div className="hero-scene-stage">
        <div className="hero-mic">
          <span className="hero-mic-dot" />
          <span className="hero-mic-wave">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ animationDelay: `${i * 110}ms` }} />
            ))}
          </span>
        </div>

        <div className="hero-stream">
          {spoken.map((word, i) => (
            <span
              key={word}
              className={`hero-token ${word === 'comma' || word === 'full stop' || word === 'capital' ? 'hero-token-cmd' : ''}`}
              style={{ animationDelay: `${i * 420}ms` }}
            >
              {word}
            </span>
          ))}
        </div>

        <div className="hero-page">
          <div className="hero-page-head">
            <span className="hero-page-dot" />
            <span className="hero-page-dot" />
            <span className="hero-page-dot" />
          </div>
          <div className="hero-page-body">
            <p className="hero-written">
              <span style={{ animationDelay: '900ms' }}>The</span>{' '}
              <span style={{ animationDelay: '1320ms' }}>war</span>{' '}
              <span style={{ animationDelay: '1740ms' }}>ended,</span>{' '}
              <span style={{ animationDelay: '2160ms' }}>finally.</span>
              <b className="hero-caret" />
            </p>
            <span className="hero-rule" style={{ width: '82%' }} />
            <span className="hero-rule" style={{ width: '64%' }} />
            <span className="hero-rule" style={{ width: '73%' }} />
          </div>
          <div className="hero-gauge">
            <span className="hero-gauge-fill" />
          </div>
        </div>
      </div>
    </div>
  )
}
