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

export function App() {
  // null means "whatever the salon calls today" - a question only the server may answer,
  // because the browser's clock is whatever the person's laptop says it is.
  const [requested, setRequested] = useState<string | null>(dateFromUrl)
  const [day, setDay] = useState<Day | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    // Back and forward have to move the board, or the address bar is decoration.
    const onPop = () => setRequested(dateFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let current = true
    setFailure(null)

    fetchDay(requested)
      .then((loaded) => {
        if (!current) return
        setDay(loaded)
        // Put the resolved day in the URL when the request did not name one, so a refresh
        // stays put. Replace rather than push: opening the app is not a navigation step.
        if (requested === null) {
          window.history.replaceState(null, '', `?date=${loaded.date}`)
        }
      })
      .catch((error: unknown) => {
        if (!current) return
        // Keep the previous day on screen and say the load failed. Blanking the board would
        // be indistinguishable from a day with nothing booked.
        setFailure(error instanceof Error ? error.message : String(error))
      })

    return () => {
      current = false
    }
  }, [requested])

  const goTo = useCallback((date: string) => {
    window.history.pushState(null, '', `?date=${date}`)
    setRequested(date)
  }, [])

  if (day === null) {
    return (
      <main className="shell">
        {failure === null ? <p>Tag wird geladen …</p> : <p role="alert">Laden fehlgeschlagen: {failure}</p>}
      </main>
    )
  }

  return (
    <main className="shell">
      <TopBar
        date={day.date}
        today={day.today}
        onStep={(weeks) => goTo(addWeeks(day.date, weeks))}
        onToday={() => goTo(day.today)}
      />

      {failure !== null && (
        <p className="shell__stale" role="alert">
          Anzeige veraltet, Laden fehlgeschlagen: {failure}
        </p>
      )}

      <div className="shell__board">
        {/* Narrow full-height strips rather than wide blocks: six columns on a laptop is
            already tight, and full height keeps them easy to hit without taking width. */}
        <button
          type="button"
          className="edge edge--prev"
          onClick={() => goTo(addDays(day.date, -1))}
          aria-label="Vorheriger Tag"
        >
          <span aria-hidden="true">&lsaquo;</span>
        </button>

        <Board day={day} />

        <button
          type="button"
          className="edge edge--next"
          onClick={() => goTo(addDays(day.date, 1))}
          aria-label="Nächster Tag"
        >
          <span aria-hidden="true">&rsaquo;</span>
        </button>
      </div>
    </main>
  )
}
