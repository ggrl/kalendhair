import { useState } from 'react'
import { login, resetCredentials } from './api'

/**
 * The door. One shared salon password (ADR-0004), and behind a link, the master password's one
 * screen: set a new salon password and a new PIN (ADR-0017).
 *
 * There is no "stay logged in" tick, because the session already lasts a month and slides
 * while it is used - a tick would offer a choice between that and something worse.
 */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [resetting, setResetting] = useState(false)

  const [password, setPassword] = useState('')
  const [master, setMaster] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pin, setPin] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Said after a reset, on the login form somebody then has to use. */
  const [notice, setNotice] = useState<string | null>(null)

  function attempt(work: Promise<void>, done: () => void) {
    setBusy(true)
    setError(null)
    work.then(
      () => {
        setBusy(false)
        done()
      },
      (failure: unknown) => {
        setBusy(false)
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
  }

  if (resetting) {
    return (
      <main className="shell login">
        <form
          className="login__form"
          onSubmit={(event) => {
            event.preventDefault()
            attempt(resetCredentials(master, newPassword, pin), () => {
              setResetting(false)
              setMaster('')
              setNewPassword('')
              setPin('')
              setNotice('Passwort und PIN wurden geändert. Alle Geräte sind abgemeldet.')
            })
          }}
        >
          <h1>Passwort zurücksetzen</h1>
          <p className="login__hint">
            Mit dem Hauptpasswort. Es setzt das Salon-Passwort und die PIN neu und meldet alle Geräte ab.
          </p>

          <label htmlFor="master">Hauptpasswort</label>
          <input
            id="master"
            type="password"
            autoComplete="off"
            value={master}
            onChange={(event) => setMaster(event.target.value)}
            required
          />

          <label htmlFor="new-password">Neues Salon-Passwort</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />

          <label htmlFor="new-pin">Neue PIN (vier Ziffern)</label>
          <input
            id="new-pin"
            // Not type="number": leading zeros matter in a PIN, and a spinner does not belong
            // on one. inputMode gives a phone the digit keypad without letting the field hold
            // anything else - the server checks four digits either way.
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            required
          />

          {error !== null && (
            <p className="login__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy}>
            {busy ? 'Wird gespeichert …' : 'Zurücksetzen'}
          </button>
          <button
            type="button"
            className="login__link"
            onClick={() => {
              setResetting(false)
              setError(null)
            }}
          >
            Zurück zur Anmeldung
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="shell login">
      <form
        className="login__form"
        onSubmit={(event) => {
          event.preventDefault()
          attempt(login(password), () => {
            setPassword('')
            onSignedIn()
          })
        }}
      >
        <h1>Terminplan</h1>
        <p className="login__hint">Bitte das Salon-Passwort eingeben.</p>

        {notice !== null && <p className="login__notice">{notice}</p>}

        <label htmlFor="password">Salon-Passwort</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {error !== null && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Wird geprüft …' : 'Anmelden'}
        </button>
        <button
          type="button"
          className="login__link"
          onClick={() => {
            setResetting(true)
            setError(null)
            setNotice(null)
          }}
        >
          Passwort oder PIN vergessen?
        </button>
      </form>
    </main>
  )
}
