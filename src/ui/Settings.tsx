import { useCallback, useEffect, useState } from 'react'
import type { StaffMember } from '../calendar/types'
import {
  PinRefused,
  Unauthenticated,
  addStaff,
  changePassword,
  changePin,
  fetchStaff,
  moveStaff,
  removeStaff,
  unlockSettings,
  updateStaff,
} from './api'

/**
 * The screen the salon manages itself from: staff and credentials. ADR-0018.
 *
 * The PIN is asked for every time this opens and lives in this component's state for exactly as
 * long as it is on screen - the owner chose that over anything longer-lived, and it means there
 * is no ticket to leave lying around on the front desk machine. Going back to the board drops it.
 *
 * The core hours are the third thing ADR-0018 puts here and they are not built: they move
 * `opening.ts` half into the database and grow `GET /api/day` a field, which is its own change.
 */
export function Settings({ onClose, onSignedOut }: { onClose: () => void; onSignedOut: () => void }) {
  const [pin, setPin] = useState<string | null>(null)
  /** Why the PIN is being asked for again, when there is a reason worth saying. */
  const [locked, setLocked] = useState<string | null>(null)

  const lock = useCallback((why?: string) => {
    setPin(null)
    setLocked(why ?? null)
  }, [])

  if (pin === null) {
    return (
      <PinPrompt
        why={locked}
        onUnlocked={(entered) => {
          setLocked(null)
          setPin(entered)
        }}
        onClose={onClose}
      />
    )
  }

  return <SettingsScreen pin={pin} onLocked={lock} onSignedOut={onSignedOut} onClose={onClose} />
}

function PinPrompt({
  why,
  onUnlocked,
  onClose,
}: {
  why: string | null
  onUnlocked: (pin: string) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <main className="shell settings">
      <form
        className="settings__gate"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          setProblem(null)
          unlockSettings(typed).then(
            () => {
              setBusy(false)
              onUnlocked(typed)
            },
            (error: unknown) => {
              setBusy(false)
              setTyped('')
              setProblem(error instanceof Error ? error.message : String(error))
            },
          )
        }}
      >
        <h1>Einstellungen</h1>
        <p className="settings__hint">Zum Ändern bitte die PIN eingeben.</p>

        {why !== null && <p className="settings__notice">{why}</p>}

        <label htmlFor="pin">PIN</label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={4}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          required
        />

        {problem !== null && (
          <p className="settings__error" role="alert">
            {problem}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Wird geprüft …' : 'Weiter'}
        </button>
        <button type="button" className="settings__link" onClick={onClose}>
          Zurück zum Kalender
        </button>
      </form>
    </main>
  )
}

function SettingsScreen({
  pin,
  onLocked,
  onSignedOut,
  onClose,
}: {
  pin: string
  onLocked: (why?: string) => void
  onSignedOut: () => void
  onClose: () => void
}) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Every change reloads the whole list rather than patching the copy on screen.
   *
   * The same reason the board reloads a day after a write: the server owns the order, and a
   * client that renumbers its own copy after a move will disagree with the next person to open
   * this screen. Six rows is not a payload worth being clever about.
   */
  const reload = useCallback(() => {
    fetchStaff(pin).then(setStaff, (error: unknown) => {
      // The two ways this screen can stop being allowed, and they are different: the password
      // changed, so nobody is logged in anywhere, or the PIN changed, so the board is fine and
      // this screen is not. Answering both with the same message would send somebody hunting for
      // the wrong problem.
      if (error instanceof Unauthenticated) {
        onSignedOut()
        return
      }
      if (error instanceof PinRefused) {
        onLocked()
        return
      }
      setProblem(error instanceof Error ? error.message : String(error))
    })
  }, [pin, onLocked, onSignedOut])

  useEffect(reload, [reload])

  /**
   * One place for every write, so no button can forget to say what went wrong.
   *
   * `reloadAfter` is false for exactly one caller: changing the PIN takes this screen's own key
   * away, so the reload that follows every other write would be refused with the old PIN and
   * lock the screen a second time - wiping the message that says why it locked the first time.
   */
  const run = useCallback(
    (work: Promise<void>, done?: () => void, reloadAfter = true) => {
      setBusy(true)
      setProblem(null)
      setNotice(null)
      work.then(
        () => {
          setBusy(false)
          done?.()
          if (reloadAfter) reload()
        },
        (error: unknown) => {
          setBusy(false)
          if (error instanceof Unauthenticated) {
            onSignedOut()
            return
          }
          if (error instanceof PinRefused) {
            onLocked()
            return
          }
          setProblem(error instanceof Error ? error.message : String(error))
          // The list is reloaded after a refusal too: a refusal means the screen and the database
          // disagree, and the screen is the one that is wrong.
          reload()
        },
      )
    },
    [reload, onLocked, onSignedOut],
  )

  return (
    <main className="shell settings">
      <header className="settings__bar">
        <h1>Einstellungen</h1>
        <button type="button" onClick={onClose}>
          Zurück zum Kalender
        </button>
      </header>

      {problem !== null && (
        <p className="settings__error" role="alert">
          {problem}
        </p>
      )}
      {notice !== null && <p className="settings__notice">{notice}</p>}

      <StaffSection staff={staff} busy={busy} pin={pin} run={run} />
      <CredentialsSection busy={busy} pin={pin} run={run} onPinChanged={onLocked} />
    </main>
  )
}

interface SectionProps {
  busy: boolean
  pin: string
  run: (work: Promise<void>, done?: () => void, reloadAfter?: boolean) => void
}

function StaffSection({ staff, busy, pin, run }: SectionProps & { staff: StaffMember[] | null }) {
  const [newName, setNewName] = useState('')
  /** Which row is being renamed, and to what. Null when nobody is. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  /** Which row has asked "are you sure". Deleting is the one thing here that cannot be undone. */
  const [confirming, setConfirming] = useState<string | null>(null)

  if (staff === null) return <p>Mitarbeiterinnen werden geladen …</p>

  return (
    <section className="settings__section">
      <h2>Mitarbeiterinnen</h2>
      <p className="settings__hint">
        Die Reihenfolge ist die Reihenfolge der Spalten auf dem Kalender. Wer deaktiviert ist, erscheint dort
        nicht mehr - auch nicht an vergangenen Tagen.
      </p>

      <ul className="settings__staff">
        {staff.map((person, index) => (
          <li key={person.id} className={person.active ? undefined : 'settings__row--inactive'}>
            <div className="settings__order">
              <button
                type="button"
                aria-label={`${person.name} nach oben`}
                disabled={busy || index === 0}
                onClick={() => run(moveStaff(pin, person.id, 'up'))}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`${person.name} nach unten`}
                disabled={busy || index === staff.length - 1}
                onClick={() => run(moveStaff(pin, person.id, 'down'))}
              >
                ↓
              </button>
            </div>

            {editing?.id === person.id ? (
              <form
                className="settings__rename"
                onSubmit={(event) => {
                  event.preventDefault()
                  run(updateStaff(pin, person.id, { name: editing.name }), () => setEditing(null))
                }}
              >
                <input
                  aria-label={`Name von ${person.name}`}
                  value={editing.name}
                  autoFocus
                  onChange={(event) => setEditing({ id: person.id, name: event.target.value })}
                />
                <button type="submit" disabled={busy}>
                  Speichern
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  Abbrechen
                </button>
              </form>
            ) : (
              <>
                <span className="settings__name">
                  {person.name}
                  {!person.active && <span className="settings__tag"> (deaktiviert)</span>}
                </span>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing({ id: person.id, name: person.name })}
                >
                  Umbenennen
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(updateStaff(pin, person.id, { active: !person.active }))}
                >
                  {person.active ? 'Deaktivieren' : 'Aktivieren'}
                </button>

                {/* Offered only for somebody who has never held an entry: ADR-0018's narrow
                    exception to ADR-0002, for a name typed wrong. The database refuses the rest,
                    and the refusal says to deactivate instead. */}
                {person.deletable &&
                  (confirming === person.id ? (
                    <>
                      <span className="settings__confirm">Wirklich löschen?</span>
                      <button
                        type="button"
                        className="settings__danger"
                        disabled={busy}
                        onClick={() => run(removeStaff(pin, person.id), () => setConfirming(null))}
                      >
                        Ja, löschen
                      </button>
                      <button type="button" onClick={() => setConfirming(null)}>
                        Abbrechen
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="settings__danger"
                      disabled={busy}
                      onClick={() => setConfirming(person.id)}
                    >
                      Löschen
                    </button>
                  ))}
              </>
            )}
          </li>
        ))}
      </ul>

      <form
        className="settings__add"
        onSubmit={(event) => {
          event.preventDefault()
          run(addStaff(pin, newName), () => setNewName(''))
        }}
      >
        <label htmlFor="new-staff">Neue Mitarbeiterin</label>
        <input id="new-staff" value={newName} onChange={(event) => setNewName(event.target.value)} required />
        <button type="submit" disabled={busy}>
          Hinzufügen
        </button>
      </form>
    </section>
  )
}

function CredentialsSection({
  busy,
  pin,
  run,
  onPinChanged,
}: SectionProps & { onPinChanged: (why: string) => void }) {
  const [password, setPassword] = useState('')
  const [newPin, setNewPin] = useState('')

  return (
    <section className="settings__section">
      <h2>Passwort und PIN</h2>

      <form
        className="settings__credential"
        onSubmit={(event) => {
          event.preventDefault()
          run(changePassword(pin, password), () => setPassword(''))
        }}
      >
        <label htmlFor="salon-password">Neues Salon-Passwort</label>
        {/* Said before the click and not after it. ADR-0017 makes this log everybody out on
            purpose, including whoever is typing - which is alarming as a surprise and obvious as
            a warning. */}
        <p className="settings__hint">
          Alle Geräte werden abgemeldet, auch dieses. Danach müssen sich alle mit dem neuen Passwort anmelden.
        </p>
        <input
          id="salon-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button type="submit" disabled={busy}>
          Passwort ändern
        </button>
      </form>

      <form
        className="settings__credential"
        onSubmit={(event) => {
          event.preventDefault()
          run(
            changePin(pin, newPin),
            () => {
              setNewPin('')
            // The PIN this screen is holding is now the old one, so every further request would
            // be refused with it. Back to the prompt deliberately, saying why - otherwise the
            // next click looks like the screen breaking for no reason.
              onPinChanged('Die PIN wurde geändert. Bitte die neue PIN eingeben.')
            },
            false,
          )
        }}
      >
        <label htmlFor="new-pin">Neue PIN (vier Ziffern)</label>
        <p className="settings__hint">Niemand wird abgemeldet. Die PIN schützt nur diese Seite.</p>
        <input
          id="new-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={newPin}
          onChange={(event) => setNewPin(event.target.value)}
          required
        />
        <button type="submit" disabled={busy}>
          PIN ändern
        </button>
      </form>
    </section>
  )
}
