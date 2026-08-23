import { Link } from 'react-router-dom'
import { BrandLockup } from '../components/BrandMark'

/**
 * What Scriber collects, and what it deliberately doesn't.
 *
 * Written to be true rather than to be safe. Two things here are unusual
 * enough that burying them would be a form of lying: dictation on Chrome
 * sends audio to Google, and the supervision extension can see which other
 * sites a student has open. Both are stated plainly and near the top.
 *
 * The Chrome Web Store also requires a public policy for any extension
 * touching user data, and this is it.
 */
export function Privacy() {
  return (
    <div className="legal-page">
      <header className="legal-head">
        <Link to="/" className="brand">
          <BrandLockup />
        </Link>
      </header>

      <main className="legal-body">
        <h1>Privacy</h1>
        <p className="legal-lede">
          Scriber is used by students sitting exams, often students with a disability provision.
          That makes the honest version of this page the only useful one, so this says what is
          collected, who can see it, and where the genuinely surprising bits are.
        </p>
        <p className="legal-meta">Last updated 22 August 2026</p>

        <h2>The two things worth knowing first</h2>

        <h3>Dictation is processed by your browser, and on Chrome that means Google</h3>
        <p>
          Scriber uses the browser's own speech recognition. In Chrome, that sends the audio of
          what you say to Google's servers to be turned into text, under Google's privacy policy,
          not ours. We never receive or store your audio — but Google receives it, and you should
          know that before dictating anything you would not want transcribed elsewhere.
        </p>
        <p>
          If that is not acceptable, the keyboard box at the bottom of the exam room takes the same
          dictation, commands and all, and involves no audio at all.
        </p>

        <h3>During a supervised test, your teacher can see more than usual</h3>
        <p>
          Sitting a live test run by your school is a deliberately supervised activity. For the
          length of that test, and only then, your supervisor can see:
        </p>
        <ul>
          <li>Your screen, shared live. It is not recorded and it is not stored — it is a direct connection between your browser and theirs that ends when the test does.</li>
          <li>Which other sites you have open, by name, if you have installed the Scriber extension.</li>
          <li>A running count of your words and the last couple of hundred characters you wrote.</li>
          <li>Notices when you leave the test tab, copy, paste, or open developer tools.</li>
        </ul>
        <p>
          None of this happens outside a test. The extension reports nothing when no test is
          running, and screen sharing stops the moment you leave the exam room.
        </p>

        <h2>What we store</h2>
        <table className="legal-table">
          <tbody>
            <tr>
              <th>Your account</th>
              <td>Your email address and name, held by Firebase Authentication so you can sign in.</td>
            </tr>
            <tr>
              <th>Your practice</th>
              <td>The text you dictated, your settings, and the statistics each session produces. Private to your account.</td>
            </tr>
            <tr>
              <th>Your own exam papers</th>
              <td>
                Kept in your browser's own storage on your own device. They are never uploaded.
                Only a paper's title and timings reach us.
              </td>
            </tr>
            <tr>
              <th>School-distributed papers</th>
              <td>
                Read as text in your browser and stored as text. The original file never leaves the
                teacher's device either.
              </td>
            </tr>
            <tr>
              <th>Exam numbers</th>
              <td>
                If your school uses them, the number you sit exams under. Set by staff, never by
                you, so that a printed answer can be identified without naming you.
              </td>
            </tr>
            <tr>
              <th>Supervision records</th>
              <td>
                For a live test: your progress, the integrity notices above, and the hostnames of
                other tabs. Visible to your school's staff, never to other students.
              </td>
            </tr>
          </tbody>
        </table>

        <h2>What we deliberately don't do</h2>
        <ul>
          <li>No advertising, and nothing sold or shared with anyone for marketing.</li>
          <li>
            No tracking cookies and no device fingerprint. We count page views with Cloudflare Web
            Analytics, which is cookieless and cannot follow you to any other site — see below.
          </li>
          <li>No recording of your screen or your voice.</li>
          <li>No full web addresses from the extension — hostnames and page titles only. That you opened a search engine is the point; what you typed into it is not our business.</li>
          <li>No access for your school to your own private practice. A teacher sees work you do <em>for them</em>, never the sessions you run on your own.</li>
        </ul>

        <h2>Who can see what</h2>
        <p>
          Access is enforced by the database's own security rules rather than by what the interface
          happens to show, which means it holds even if somebody goes looking. In short: you see
          your own work; your school's staff see the work you do for that school; nobody sees
          another student's.
        </p>
        <p>
          Scriber's own administrators can manage organisations, rosters and distributed papers
          across schools. They cannot read any student's private practice sessions or personal
          papers, and that limit is written into the security rules, not just the policy.
        </p>

        <h2>Counting visits</h2>
        <p>
          We use Cloudflare Web Analytics to see how many people reach the site and which pages
          they land on. It sets no cookies, builds no fingerprint of your device, and cannot
          recognise you on any other site — which is why there is no consent banner here. What it
          records is a page address, a referrer, a rough screen size and a country.
        </p>
        <p>
          It does not run in the exam room. A live test's address carries your school's and your
          test's identifiers, and those are nobody else's business — not even for counting.
        </p>

        <h2>The extension</h2>
        <p>
          The Scriber supervision extension is optional to install and useless until you pair it
          with your account. Pairing happens from Settings while you are signed in, or with a
          one-time code if the extension is in a browser you are not signed in on. Once paired, it
          reports the hostnames and titles of your open tabs — but only while you are sitting a
          test, and only to the school running it.
        </p>
        <p>
          You can unpair it at any time from the extension's own popup, or remove it entirely from
          your browser. Doing so during a test will be visible to your supervisor, which is rather
          the point of it.
        </p>

        <h2>Where it lives, and for how long</h2>
        <p>
          Data is held in Google Firebase (Authentication and Cloud Firestore). Your practice
          sessions stay until you delete them — every session has a Delete button, and deleting is
          immediate. Ask us to remove your account and everything under it goes with it.
        </p>

        <h2>Children</h2>
        <p>
          Scriber is used in schools, so many users are under 18. Where a school sets Scriber up,
          the school is responsible for the lawful basis of their students using it, and we act on
          their instructions in respect of that student data.
        </p>

        <h2>Asking us anything</h2>
        <p>
          To see what we hold about you, correct it, or have it deleted, email{' '}
          <a href="mailto:privacy@pracscriber.com">privacy@pracscriber.com</a>. If you are at a
          school using Scriber, your learning support team can usually sort it faster.
        </p>

        <p className="legal-foot">
          Scriber is an independent practice tool. It is not affiliated with or endorsed by NESA,
          and it does not replace the writer you are approved to work with.
        </p>
      </main>
    </div>
  )
}
