import { useCallback, useEffect, useState } from 'react'
import type { CoreHoursDay, StaffMember } from '../calendar/types'
import { germanWeekday } from '../calendar/dates'
import { DAY_ENDS_AT, DAY_STARTS_AT, SLOT_COUNT, SLOT_MINUTES, minutesSinceMidnight, wallClockFromMinutes } from '../calendar/grid'
import {
  PinRefused,
  Unauthenticated,
  addStaff,
  changePassword,
  changePin,
  fetchHours,
  fetchStaff,
  moveStaff,
  removeStaff,
  saveHours,
  unlockSettings,
  updateStaff,
} from './api'

/**
 * The screen the salon manages itself from: staff and credentials. ADR-0018.
 *
 * The PIN is asked for every time this opens and lives in this component's state for exactly as
 * long as it is on screen - the owner chose that over anything longer-lived, and it means there
 * is no ticket to leave lying around on the front desk machine. Going back to the board drops it.
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
  const failed = useCallback(
    (error: unknown, say: (message: string) => void) => {
      failure(error, { onSignedOut, onLocked, say })
    },
    [onLocked, onSignedOut],
  )

  const reload = useCallback(() => {
    fetchStaff(pin).then(setStaff, (error: unknown) => failed(error, setProblem))
  }, [pin, failed])

  useEffect(reload, [reload])

  /**
   * One place for every write, so no button can forget to say what went wrong.
   *
   * `reloadAfter` is false for exactly one caller: changing the PIN takes this screen's own key
   * away, so the reload that follows every other write would be refused with the old PIN and
   * lock the screen a second time - wiping the message that says why it locked the first time.
   *
   * `say` is where the German sentence goes, and it defaults to the message line at the top of
   * this screen. A section far enough down the page that the top is off-screen passes its own,
   * because a refusal nobody can see reads exactly like a save that worked.
   */
  const run = useCallback(
    (work: Promise<void>, done?: () => void, reloadAfter = true, say: (message: string | null) => void = setProblem) => {
      setBusy(true)
      setProblem(null)
      setNotice(null)
      say(null)
      work.then(
        () => {
          setBusy(false)
          done?.()
          if (reloadAfter) reload()
        },
        (error: unknown) => {
          setBusy(false)
          failed(error, say)
          // The list is reloaded after a refusal too: a refusal means the screen and the database
          // disagree, and the screen is the one that is wrong.
          reload()
        },
      )
    },
    [reload, failed],
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

      <StaffSection staff={staff} busy={busy} pin={pin} run={run} problem={problem} onRetry={reload} />
      <HoursSection busy={busy} pin={pin} run={run} onFailed={failed} />
      <CredentialsSection busy={busy} pin={pin} run={run} onPinChanged={onLocked} />
    </main>
  )
}

/**
 * Where a failed settings request goes: the login screen, the PIN prompt, or a sentence on screen.
 *
 * One home for that decision, because it is three different answers to what looks like one event.
 * The password changed, so nobody is logged in anywhere; or the PIN changed, so the board is fine
 * and this screen is not; or something else went wrong and the server said what. Answering all
 * three the same way sends somebody hunting for the wrong problem.
 */
function failure(
  error: unknown,
  {
    onSignedOut,
    onLocked,
    say,
  }: { onSignedOut: () => void; onLocked: (why?: string) => void; say: (message: string) => void },
): void {
  if (error instanceof Unauthenticated) {
    onSignedOut()
    return
  }
  if (error instanceof PinRefused) {
    onLocked()
    return
  }
  say(error instanceof Error ? error.message : String(error))
}

interface SectionProps {
  busy: boolean
  pin: string
  /**
   * `say` is where a refusal's German sentence goes. It defaults to the message line at the top of
   * the screen; a section low enough down the page that the top is off-screen passes its own.
   */
  run: (
    work: Promise<void>,
    done?: () => void,
    reloadAfter?: boolean,
    say?: (message: string | null) => void,
  ) => void
}

function StaffSection({
  staff,
  busy,
  pin,
  run,
  problem,
  onRetry,
}: SectionProps & { staff: StaffMember[] | null; problem: string | null; onRetry: () => void }) {
  const [newName, setNewName] = useState('')
  /** Which row is being renamed, and to what. Null when nobody is. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  /** Which row has asked "are you sure". Deleting is the one thing here that cannot be undone. */
  const [confirming, setConfirming] = useState<string | null>(null)

  // Not "loading" forever: a review pass answered this fetch with a 500 and got the error and
  // the loading line on screen together, with no way out but leaving and re-typing the PIN.
  if (staff === null) {
    return problem === null ? (
      <p>Mitarbeiterinnen werden geladen …</p>
    ) : (
      <p>
        <button type="button" onClick={onRetry}>
          Erneut versuchen
        </button>
      </p>
    )
  }

  return (
    <section className="settings__section">
      <h2>Mitarbeiterinnen</h2>
      <p className="settings__hint">
        Die Reihenfolge ist die Reihenfolge der Spalten auf dem Kalender. Wer deaktiviert ist, erscheint dort
        nicht mehr - und ihre Termine ebenfalls nicht, auch nicht an vergangenen Tagen. Nichts wird gelöscht:
        beim Aktivieren ist alles wieder da.
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
                  required
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

/**
 * Every time the board can be shaded from or to: 06:00 to 20:00, on the quarter hour.
 *
 * Built from `grid.ts` rather than written out, so the choices cannot outlive the window they
 * belong to. A dropdown and not a typed field because the board draws 15-minute rows: 09:07 is a
 * time the grid cannot put where it says, and offering it only to refuse it wastes somebody's
 * afternoon.
 */
const TIME_CHOICES = Array.from({ length: SLOT_COUNT + 1 }, (_, index) =>
  wallClockFromMinutes(minutesSinceMidnight(DAY_STARTS_AT) + index * SLOT_MINUTES),
)

/** What a day gets when somebody unticks `Geschlossen`: the salon's own ordinary working day. */
const USUAL_DAY = { from: '09:00', to: '18:00' }

/**
 * The salon's core hours, the third thing ADR-0018 puts on this screen.
 *
 * The whole week is edited and then saved by one button, which is what the owner chose: somebody
 * sits down once a year and fixes the hours, and a per-row save would be seven requests, seven
 * places to fail, and a half-edited week the screen would have to explain.
 */
function HoursSection({
  busy,
  pin,
  run,
  onFailed,
}: SectionProps & { onFailed: (error: unknown, say: (message: string) => void) => void }) {
  const [week, setWeek] = useState<CoreHoursDay[] | null>(null)
  /**
   * Said here, beside the button, and not on the message line at the top of the screen.
   *
   * A review pass measured it: with the salon's six staff rows above this section, a refused save
   * rendered its sentence 373px above the top of the viewport. Nothing moved, nothing went red,
   * and the only reading available to the person at the desk was that the week had been saved -
   * when it had not been written at all.
   */
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  /**
   * Loaded here rather than by the screen above, because this section is the only thing that
   * wants it - and reloaded after a save for the same reason the staff list is: the database is
   * what the next person to open this screen will see, not the draft this one was holding.
   */
  const load = useCallback(() => {
    setProblem(null)
    // Routed through the same three-way decision as every other request on this screen: a load
    // that fails because the PIN changed belongs at the PIN prompt, not on a retry button that
    // will fail identically every time it is pressed.
    fetchHours(pin).then(setWeek, (error: unknown) => onFailed(error, setProblem))
  }, [pin, onFailed])

  useEffect(load, [load])

  const change = (weekday: number, hours: CoreHoursDay['hours']) => {
    // The confirmation goes as soon as the week stops being the one it was about, or it sits there
    // saying "saved" over an edit that has not been.
    setSaved(false)
    setWeek((current) => current?.map((day) => (day.weekday === weekday ? { ...day, hours } : day)) ?? null)
  }

  if (week === null) {
    return (
      <section className="settings__section">
        <h2>Kernzeiten</h2>
        {problem === null ? (
          <p>Kernzeiten werden geladen …</p>
        ) : (
          <>
            {/* The sentence, and then the button. A naked retry button with nothing saying what
                failed leaves somebody pressing it to find out. */}
            <p className="settings__error" role="alert">
              {problem}
            </p>
            <p>
              <button type="button" onClick={load}>
                Erneut versuchen
              </button>
            </p>
          </>
        )}
      </section>
    )
  }

  return (
    <section className="settings__section">
      <h2>Kernzeiten</h2>
      {/* The one place this belief can be corrected. A screen that lets somebody edit opening
          times is exactly where they conclude that booking outside them will be refused - and
          ADR-0015's whole ruling is that it is not. */}
      <p className="settings__hint">
        Diese Zeiten färben nur den Kalender: außerhalb ist er rot hinterlegt. Termine sind weiterhin an jedem
        Tag von {DAY_STARTS_AT} bis {DAY_ENDS_AT} möglich, auch an Sonntagen und Feiertagen.
      </p>

      <form
        className="settings__hours"
        onSubmit={(event) => {
          event.preventDefault()
          setSaved(false)
          run(
            saveHours(pin, week),
            () => {
              setSaved(true)
              load()
            },
            false,
            setProblem,
          )
        }}
      >
        <ul>
          {week.map((day) => (
            <li key={day.weekday}>
              <span className="settings__weekday">{germanWeekday(day.weekday)}</span>

              <label className="settings__closed">
                <input
                  type="checkbox"
                  checked={day.hours === null}
                  onChange={(event) => change(day.weekday, event.target.checked ? null : USUAL_DAY)}
                />
                Geschlossen
              </label>

              {day.hours !== null && (
                <>
                  <select
                    aria-label={`${germanWeekday(day.weekday)} von`}
                    value={day.hours.from}
                    onChange={(event) => change(day.weekday, { from: event.target.value, to: day.hours!.to })}
                  >
                    {TIME_CHOICES.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                  <span>bis</span>
                  <select
                    aria-label={`${germanWeekday(day.weekday)} bis`}
                    value={day.hours.to}
                    onChange={(event) => change(day.weekday, { from: day.hours!.from, to: event.target.value })}
                  >
                    {TIME_CHOICES.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </li>
          ))}
        </ul>

        {/* Both answers land here, next to the control that asked the question, because the top
            of this screen is off-screen by the time somebody is standing on this button. */}
        {problem !== null && (
          <p className="settings__error" role="alert">
            {problem}
          </p>
        )}
        {saved && problem === null && <p className="settings__notice">Die Kernzeiten wurden gespeichert.</p>}

        <button type="submit" disabled={busy}>
          Kernzeiten speichern
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
  /**
   * Typed twice, and this is the only field in the application that is.
   *
   * Both review passes arrived at it from different directions. One masked field, one typo, and
   * the salon is logged out of a board whose password nobody in the building knows - the way back
   * is the master password out of `.env`, which on a VPS means somebody with shell access. The
   * master-password screen has one field on purpose: a typo there costs re-typing a password you
   * are holding. Here it costs an evening.
   */
  const [again, setAgain] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [newPin, setNewPin] = useState('')

  return (
    <section className="settings__section">
      <h2>Passwort und PIN</h2>

      <form
        className="settings__credential"
        onSubmit={(event) => {
          event.preventDefault()
          if (password !== again) {
            setMismatch(true)
            return
          }
          setMismatch(false)
          run(changePassword(pin, password), () => {
            setPassword('')
            setAgain('')
          })
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

        <label htmlFor="salon-password-again">Neues Salon-Passwort wiederholen</label>
        <input
          id="salon-password-again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          required
        />

        {mismatch && (
          <p className="settings__error" role="alert">
            Die beiden Passwörter sind nicht gleich.
          </p>
        )}

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
