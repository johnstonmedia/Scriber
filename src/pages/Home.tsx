import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useReveal, useScrollProgress, useScrollY } from '../lib/useReveal'
import { HomeDemo } from '../components/HomeDemo'
import { HeroScene } from '../components/HeroScene'
import { BrandMark } from '../components/BrandMark'
import type { SiteContent } from '../lib/siteConfig'

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'reveal-in' : ''} ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  )
}

/** Each word fades and lifts in a beat after the last — the headline arrives the way dictation does. */
function CascadeHeading({ text, className = '' }: { text: string; className?: string }) {
  const { ref, visible } = useReveal<HTMLHeadingElement>(0.4)
  const words = text.split(' ')
  // The separating space has to sit outside the overflow-hidden word span, or
  // it collapses to nothing and every word runs into the next.
  const nodes: ReactNode[] = []
  words.forEach((word, i) => {
    if (i > 0) nodes.push(' ')
    nodes.push(
      <span key={i} className="cascade-word-wrap">
        <span
          className={`cascade-word ${visible ? 'cascade-word-in' : ''}`}
          style={{ transitionDelay: visible ? `${i * 60}ms` : '0ms' }}
        >
          {word}
        </span>
      </span>,
    )
  })
  return (
    <h1 ref={ref} className={className}>
      {nodes}
    </h1>
  )
}

export function Home({ content }: { content: SiteContent }) {
  const scrollY = useScrollY()
  const progress = useScrollProgress()

  return (
    <div className="home">
      <div className="home-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <header className="home-nav no-print">
        <Link to="/" className="brand">
          <BrandMark />
          Scriber
        </Link>
        <div className="spacer" />
        <Link to="/login" className="btn btn-ghost">
          Sign in
        </Link>
        <Link to="/login" className="btn btn-primary">
          Get started
        </Link>
      </header>

      <section className="home-hero">
        <div
          className="home-hero-glow"
          style={{ transform: `translateY(${scrollY * 0.15}px)` }}
          aria-hidden="true"
        />
        <div className="home-hero-shapes" aria-hidden="true">
          <span className="home-shape home-shape-a" style={{ transform: `translateY(${scrollY * 0.08}px)` }} />
          <span className="home-shape home-shape-b" style={{ transform: `translateY(${scrollY * -0.06}px)` }} />
          <span className="home-shape home-shape-c" style={{ transform: `translateY(${scrollY * 0.12}px)` }} />
        </div>
        <div className="home-hero-content">
          <span className="badge badge-accent home-eyebrow">For NESA exam writer provisions</span>
          <CascadeHeading className="home-h1" text={content.heroTitle} />
          <p className="home-lede">{content.heroBody}</p>
          <div className="row gap-3 wrap" style={{ marginTop: 8 }}>
            <Link to="/login" className="btn btn-primary btn-lg">
              {content.ctaLabel}
            </Link>
            <a href="#how" className="btn btn-lg">
              See how it works
            </a>
          </div>
          <HeroScene />
        </div>
        <div className="home-scroll-cue" aria-hidden="true">
          <span />
        </div>
      </section>

      <section className="home-section" id="how">
        <Reveal className="home-section-head">
          <span className="home-kicker">How it works</span>
          <h2 className="home-h2">Four steps, every time you practise.</h2>
        </Reveal>

        <Reveal className="home-steps-line-wrap" delay={40}>
          <div className="home-steps-line" />
        </Reveal>

        <div className="home-steps">
          {[
            {
              n: '01',
              title: 'Upload a past paper',
              body: 'PDF, image or text. Reading time and working time are set to match the real exam.',
            },
            {
              n: '02',
              title: 'Dictate your answer',
              body: 'Say your punctuation, your capitals, your paragraphs — out loud, exactly as you will on the day.',
            },
            {
              n: '03',
              title: 'The writer paces you',
              body: 'Words land a beat behind. Talk too fast and the writer loses the tail and asks you to repeat it.',
            },
            {
              n: '04',
              title: 'Review what to fix',
              body: 'A report on missed punctuation, pacing, and every time the writer had to ask you to slow down.',
            },
          ].map((step, i) => (
            <Reveal key={step.n} delay={i * 90} className="home-step">
              <span className="home-step-n">{step.n}</span>
              <h3>{step.title}</h3>
              <p className="muted">{step.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="home-section home-demo-section">
        <Reveal className="home-section-head">
          <span className="home-kicker">Not a transcription machine</span>
          <h2 className="home-h2">This is the actual engine. Scroll and watch it work.</h2>
          <p className="lede" style={{ maxWidth: '52ch' }}>
            Every other tool writes what you say the instant you say it. A real writer can't. Ours
            can't either — on purpose.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <HomeDemo />
        </Reveal>
      </section>

      <section className="home-section">
        <Reveal className="home-section-head">
          <span className="home-kicker">Built for schools</span>
          <h2 className="home-h2">One place for the whole learning-support team.</h2>
        </Reveal>

        <div className="home-org-grid">
          <Reveal className="home-org-card">
            <h3>Teachers</h3>
            <p className="muted">
              Build classes, distribute past papers to the students who need them, and see who's
              actually practising.
            </p>
          </Reveal>
          <Reveal delay={80} className="home-org-card">
            <h3>Admins</h3>
            <p className="muted">
              Invite staff and students, approve access requests, and reset a password in one
              click — never a shared spreadsheet again.
            </p>
          </Reveal>
          <Reveal delay={160} className="home-org-card">
            <h3>Students</h3>
            <p className="muted">
              Practise on your own, or join your school to get papers your teacher assigned —
              your dictated answers are never visible to anyone but you.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="home-cta">
        <Reveal>
          <h2 className="home-h2">Say it like you mean it.</h2>
          <p className="lede">Free to practise. No credit card. Ready in under a minute.</p>
          <Link to="/login" className="btn btn-primary btn-lg">
            Start practising
          </Link>
        </Reveal>
      </section>

      <footer className="home-footer">
        <p className="tiny faint">
          Scriber is an independent practice tool. It is not affiliated with or endorsed by NESA,
          and it does not replace the writer you are approved to work with in the exam.
        </p>
        <p className="tiny">
          <Link to="/privacy">Privacy</Link>
        </p>
      </footer>
    </div>
  )
}
