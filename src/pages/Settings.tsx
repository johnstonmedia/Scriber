import { useState } from 'react'
import { useAuth, type Settings as SettingsShape } from '../lib/auth'
import { CommandList } from '../components/CommandReference'
import { readAloud } from '../scribe/speech'
import { MEMORY_PRESETS, type MemoryPreset } from '../scribe/workingMemory'

export function Settings() {
  const { user, settings, saveSettings, updateName } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [saved, setSaved] = useState<string | null>(null)

  function update<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) {
    void saveSettings({ [key]: value } as Partial<SettingsShape>)
    setSaved('Saved')
    window.setTimeout(() => setSaved(null), 1500)
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Settings</h1>
          <p className="muted">How your writer behaves while you practise.</p>
        </div>
        {saved && <span className="badge badge-good">{saved}</span>}
      </div>

      <div className="stack gap-4">
        <section className="card card-pad stack gap-4">
          <div>
            <h2>Your writer</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              A real writer is always a beat behind you, can only hold so much in their
              head, and will occasionally stop to ask how a word is spelled. Choose how
              closely yours behaves like a person.
            </p>
          </div>

          {(Object.keys(MEMORY_PRESETS) as MemoryPreset[]).map((key) => {
            const preset = MEMORY_PRESETS[key]
            return (
              <label
                key={key}
                className="row gap-3"
                style={{ alignItems: 'flex-start', cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  name="writer"
                  checked={settings.writerPreset === key}
                  onChange={() =>
                    void saveSettings({ writerPreset: key, memory: preset.settings })
                  }
                  style={{ marginTop: 4 }}
                />
                <span>
                  <strong>{preset.label}</strong>
                  <span className="small muted" style={{ display: 'block' }}>
                    {preset.hint} Holds about {preset.settings.capacity} words, starts
                    writing {(preset.settings.reactionMs / 1000).toFixed(1)}s after you
                    speak.
                  </span>
                </span>
              </label>
            )
          })}
        </section>

        <section className="card card-pad stack gap-4">
          <div>
            <h2>Scribe rules</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              Which set of rules your writer follows.
            </p>
          </div>

          <label className="row gap-3" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="profile"
              checked={settings.ruleProfile === 'strict'}
              onChange={() => update('ruleProfile', 'strict')}
              style={{ marginTop: 4 }}
            />
            <span>
              <strong>Strict — you dictate every mark</strong>
              <span className="small muted" style={{ display: 'block' }}>
                Your words are written in lower case with no punctuation except what you say out
                loud. This matches the scribe rules used where writing conventions are being
                assessed, and it is the harder, safer way to practise.
              </span>
            </span>
          </label>

          <label className="row gap-3" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="profile"
              checked={settings.ruleProfile === 'assisted'}
              onChange={() => update('ruleProfile', 'assisted')}
              style={{ marginTop: 4 }}
            />
            <span>
              <strong>Assisted — the writer may add punctuation and capitals</strong>
              <span className="small muted" style={{ display: 'block' }}>
                Under NESA's general HSC writer rules a writer is allowed to add punctuation and
                capitals without being told to. Your session report shows how many they added, so
                you can see what you would have missed.
              </span>
            </span>
          </label>
        </section>

        <section className="card card-pad stack gap-4">
          <h2>Voice</h2>

          <div className="field" style={{ maxWidth: 300 }}>
            <label htmlFor="lang">Recognition language</label>
            <select
              id="lang"
              className="input"
              value={settings.recogniserLanguage}
              onChange={(e) => update('recogniserLanguage', e.target.value)}
            >
              <option value="en-AU">English (Australia)</option>
              <option value="en-GB">English (United Kingdom)</option>
              <option value="en-NZ">English (New Zealand)</option>
              <option value="en-US">English (United States)</option>
            </select>
          </div>

          <div className="field" style={{ maxWidth: 300 }}>
            <label htmlFor="rate">Read-back speed — {settings.readBackRate.toFixed(2)}×</label>
            <input
              id="rate"
              type="range"
              min={0.6}
              max={1.4}
              step={0.05}
              value={settings.readBackRate}
              onChange={(e) => update('readBackRate', Number(e.target.value))}
            />
            <button
              type="button"
              className="btn btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() =>
                readAloud.speak(
                  'The writer will read your last two sentences back at this speed.',
                  settings.readBackRate,
                )
              }
            >
              Hear it
            </button>
          </div>
        </section>

        <section className="card card-pad stack gap-4">
          <h2>Answer sheet</h2>

          <div className="field" style={{ maxWidth: 300 }}>
            <label htmlFor="size">Text size</label>
            <select
              id="size"
              className="input"
              value={settings.fontSize}
              onChange={(e) => update('fontSize', e.target.value as SettingsShape['fontSize'])}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>

          <label className="row gap-2" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.showLiveText}
              onChange={(e) => update('showLiveText', e.target.checked)}
            />
            <span>
              Show words as they are heard
              <span className="small muted" style={{ display: 'block' }}>
                Turn this off for a more exam-like feel, where you only see text once it is written.
              </span>
            </span>
          </label>
        </section>

        <section className="card card-pad stack gap-3">
          <h2>Your account</h2>
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="displayName">Name</label>
            <input
              id="displayName"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== user?.name && void updateName(name.trim())}
            />
          </div>
          <p className="small muted">Signed in as {user?.email}</p>
        </section>

        <section className="card card-pad">
          <h2 style={{ marginBottom: 14 }}>Every command</h2>
          <CommandList />
        </section>
      </div>
    </div>
  )
}
