import { COMMANDS, type CommandEntry } from '../scribe/commands'

const GROUP_ORDER: CommandEntry['group'][] = [
  'Punctuation',
  'Structure',
  'Capitals',
  'Corrections',
  'Read back',
]

export function CommandList() {
  return (
    <>
      {GROUP_ORDER.map((group) => (
        <section className="command-group" key={group}>
          <h4>{group}</h4>
          {COMMANDS.filter((entry) => entry.group === group).map((entry) => (
            <div className="command-row" key={entry.label}>
              <div style={{ flex: '0 0 42%' }}>
                <div className="say">{entry.phrases[0]}</div>
                {entry.phrases.length > 1 && (
                  <div className="tiny faint" style={{ marginTop: 3 }}>
                    also: {entry.phrases.slice(1, 4).join(', ')}
                  </div>
                )}
              </div>
              <div className="grow">
                <div style={{ fontWeight: 560 }}>{entry.label}</div>
                {entry.example && <div className="tiny muted">{entry.example}</div>}
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  )
}

export function CommandDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="drawer-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="What to say"
      >
        <header className="drawer-head">
          <div className="grow">
            <h2>What to say</h2>
            <p className="small muted">
              Everything else you say is written down word for word.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <CommandList />
        </div>
      </aside>
    </div>
  )
}
