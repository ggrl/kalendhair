import { useCallback, useEffect, useState } from 'react'
import type { Day } from '../calendar/types'
import { addDays, addWeeks } from '../calendar/dates'
import { isSalonDate } from '../calendar/salon-date'
import { fetchDay } from './api'
import { Board } from './Board'
import { TopBar } from './TopBar'

/**
 * The date lives in the address bar, so a refresh, a crash or a redeploy returns to the day
 * somebody was actually on rather than to today. An unreadable or invented date is ignored
 * rather than corrected: the server then answers today, which is the one day always safe to
 * show.
 */
function dateFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get('date')
  return value !== null && isSalonDate(value) ? value : null
}

interface Failure {
  /** Which day failed to load. Naming it is the difference between a warning and a riddle. */
  date: string
  message: string
}

export function App() {
  // null means "whatever the salon calls today" - a question only the server may answer,
  // because the browser's clock is whatever the person's laptop says it is.
  const [requested, setRequested] = useState<string | null>(dateFromUrl)
  const [day, setDay] = useState<Day | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [retries, setRetries] = useState(0)

  useEffect(() => {
    // Back and forward have to move the board, or the address bar is decoration.
    const onPop = () => setRequested(dateFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let current = true
    setLoading(true)
    setFailure(null)

    fetchDay(requested)
      .then((loaded) => {
        if (!current) return
        setDay(loaded)
        setLoading(false)
        // Put the resolved day in the URL when the request did not name one, so a refresh
        // stays put. Replace rather than push: opening the app is not a navigation step.
        if (requested === null) {
          window.history.replaceState(null, '', `?date=${loaded.date}`)
        }
      })
      .catch((error: unknown) => {
        if (!current) return
        setLoading(false)
        setFailure({
          date: requested ?? 'heute',
          message: error instanceof Error ? error.message : String(error),
        })

        // Put the address bar back on the day still being shown. Otherwise the header said
        // one date, the board showed another day's appointments and the URL a third - which
        // is how somebody reads tomorrow's board and says today's times out loud on the
        // phone.
        //
        // `requested` is deliberately left alone. Resetting it here re-ran the fetch, which
        // failed again and relabelled this very banner with the reverted date - so the fix
        // for "say which day failed" hid the day that failed. `pending` below reads the
        // shown day while a failure stands, which is what stepping should be relative to.
        setDay((shown) => {
          if (shown !== null) {
            window.history.replaceState(null, '', `?date=${shown.date}`)
          }
          return shown
        })
      })

    return () => {
      current = false
    }
  }, [requested, retries])

  const goTo = useCallback((target: string | null) => {
    // null is the edge of the representable calendar. The step simply does not go anywhere,
    // rather than putting `+010000-01` in the address bar.
    if (target === null) return

    // Only a real move earns a history entry. Pushing unconditionally meant three impatient
    // clicks left three identical entries, so Back had to be pressed three times before the
    // board moved at all.
    if (new URLSearchParams(window.location.search).get('date') !== target) {
      window.history.pushState(null, '', `?date=${target}`)
    }
    setRequested(target)
  }, [])

  if (day === null) {
    return (
      <main className="shell">
        {failure === null ? (
          <p>Termine werden geladen …</p>
        ) : (
          <div className="shell__failure" role="alert">
            <p>Laden fehlgeschlagen: {failure.message}</p>
            <button type="button" onClick={() => setRetries((count) => count + 1)}>
              Erneut versuchen
            </button>
          </div>
        )}
      </main>
    )
  }

  // Steps are computed from the day that was ASKED for, not the one that has arrived. Reading
  // the loaded day meant a second click during a slow load recomputed the same target and was
  // silently swallowed: two requests for three clicks.
  //
  // Except after a failure, where the day on screen is the loaded one and stepping from a date
  // that never arrived would skip over it.
  const pending = failure !== null ? day.date : (requested ?? day.date)
  // While a load is open the header names the day being fetched, so a click is visibly
  // acknowledged. The board is dimmed at the same time, because it still shows the old day.
  const shown = loading ? pending : day.date

  return (
    <main className="shell">
      <TopBar
        date={shown}
        today={day.today}
        isToday={shown === day.today}
        onStep={(weeks) => goTo(addWeeks(pending, weeks))}
        onToday={() => goTo(day.today)}
      />

      {failure !== null && (
        <div className="shell__failure" role="alert">
          <p>
            {failure.date} konnte nicht geladen werden. Angezeigt wird weiterhin {day.date}.{' '}
            <span className="shell__failure-detail">({failure.message})</span>
          </p>
          <button type="button" onClick={() => setRetries((count) => count + 1)}>
            Erneut versuchen
          </button>
        </div>
      )}

      <div className="shell__board">
        {/* Narrow full-height strips rather than wide blocks: six columns on a laptop is
            already tight, and full height keeps them easy to hit without taking width. */}
        <button
          type="button"
          className="edge edge--prev"
          onClick={() => goTo(addDays(pending, -1))}
          title="Vorheriger Tag"
          aria-label="Vorheriger Tag"
        >
          <span aria-hidden="true">‹</span>
        </button>

        <div className={`shell__day${loading ? ' shell__day--loading' : ''}`}>
          {loading && <p className="shell__loading">Termine werden geladen …</p>}
          <Board day={day} />
        </div>

        <button
          type="button"
          className="edge edge--next"
          onClick={() => goTo(addDays(pending, 1))}
          title="Nächster Tag"
          aria-label="Nächster Tag"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </main>
  )
}
