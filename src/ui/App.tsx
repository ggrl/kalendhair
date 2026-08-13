import { useCallback, useEffect, useState } from 'react'
import type { Day, Entry } from '../calendar/types'
import { DAY_ENDS_AT, DAY_STARTS_AT } from '../calendar/grid'
import { addDays, addWeeks, shortGermanDate } from '../calendar/dates'
import { isSalonDate } from '../calendar/salon-date'
import { Refused, Unauthenticated, createEntry, fetchDay, removeEntry, updateEntry } from './api'
import { Board } from './Board'
import { EntryModal } from './EntryModal'
import { Login } from './Login'
import { Settings } from './Settings'
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

/** Whether the settings screen is the thing on screen. In the address bar for the same reason
 *  the date is: a refresh, a crash or a redeploy comes back to where somebody was. */
function settingsFromUrl(): boolean {
  return new URLSearchParams(window.location.search).has('settings')
}

/**
 * The address bar, written as a whole rather than one parameter at a time.
 *
 * Both parts every time, because they used to be written by different pieces of code: a load
 * settling while the settings screen was open rewrote the address to the date alone, and the
 * settings screen then vanished on the next refresh with nothing having asked it to.
 */
function urlFor(date: string, settings: boolean): string {
  return `?date=${date}${settings ? '&settings' : ''}`
}

/**
 * What to load, and how many times it has been asked for.
 *
 * The counter is the load-bearing part. Keying the fetch on the date alone meant asking for a
 * day already held was a no-op: React bailed out of an identical state update, the effect
 * never re-ran, and the request never happened. That made `Heute` inert whenever you were
 * already on today, and it let a second click after a failure push a history entry while
 * fetching nothing - which put the address bar on one day and the board on another, the exact
 * divergence the failure handling exists to prevent. Every ask increments, so every ask loads.
 */
interface Target {
  /** null means "whatever the salon calls today" - a question only the server may answer. */
  date: string | null
  attempt: number
}

interface Failure {
  /** Which day failed. Naming it is the difference between a warning and a riddle. */
  date: string
  message: string
}

const CLOCK = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })

export function App() {
  const [target, setTarget] = useState<Target>(() => ({ date: dateFromUrl(), attempt: 0 }))
  const [day, setDay] = useState<Day | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<Failure | null>(null)
  /**
   * When the day on screen was fetched. The brief's whole reason for existing is that nobody
   * holding a photograph can tell how stale it is - and until polling arrives, a board loaded
   * at 09:00 looks exactly like a live one at 14:00. This is the cheapest thing that stops the
   * screen making a claim it cannot support.
   */
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  /**
   * Whether the last request for a day came back with "no session".
   *
   * Not a copy of who is logged in - the browser cannot read the httpOnly cookie and must not
   * try to keep score. This is one fact about one answer, and asking for a day again is what
   * changes it. So a session that runs out, or a password change that ends everybody's,
   * surfaces as the login screen at the next load rather than at the next refresh.
   */
  const [needsLogin, setNeedsLogin] = useState(false)
  /** ADR-0018's screen, which is the whole page while it is open rather than a layer over the board. */
  const [settings, setSettings] = useState(settingsFromUrl)

  /**
   * The entry being edited, or a proposed slot for a new one. Null when nothing is open.
   *
   * `date` is captured when the form opens, and is the day that was on screen at that moment.
   * The form used to read the loaded day at save time instead, which is a different day whenever
   * one arrives while it is open: a step during a slow load booked the clicked slot on the day
   * that landed, and pressing Back with an appointment open moved that appointment to the
   * previous day. An `Entry` carries no date of its own, so nothing else remembered it. Neither
   * write is stale and neither clashes, so no refusal catches either one.
   */
  const [editor, setEditor] = useState<{
    date: string
    editing: Entry | null
    draft: { employeeId: string; startsAt: string; endsAt: string }
  } | null>(null)

  /** Something that happened to the data, as opposed to something that failed to load. */
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    // Back and forward have to move the board, or the address bar is decoration. That includes
    // stepping back out of the settings screen, which is a history entry like any other.
    const onPop = () => {
      setSettings(settingsFromUrl())
      setTarget((previous) => ({ date: dateFromUrl(), attempt: previous.attempt + 1 }))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let current = true
    setLoading(true)
    setFailure(null)

    fetchDay(target.date)
      .then((loaded) => {
        if (!current) return
        setNeedsLogin(false)
        setDay(loaded)
        setLoadedAt(CLOCK.format(new Date()))
        setLoading(false)

        // When a load settles, the address bar names the day on screen. Unconditionally.
        //
        // Writing it only for a request that named no date left a silent one-sided desync:
        // after a failed step the failure handler had already rewritten the URL to the day
        // still showing, and a successful retry then loaded the new day without putting the URL
        // back. Board and header agreed on Friday, the URL said Thursday, nothing said
        // otherwise, and the next refresh or copied link quietly landed on Thursday. The brief
        // puts the date in the URL so a refresh returns to the day somebody was actually on.
        //
        // Replace rather than push: settling a load is not a navigation step.
        if (new URLSearchParams(window.location.search).get('date') !== loaded.date) {
          window.history.replaceState(null, '', urlFor(loaded.date, settingsFromUrl()))
        }
      })
      .catch((error: unknown) => {
        if (!current) return
        setLoading(false)

        // Not a failed load, and it must not be shown as one: "Laden fehlgeschlagen" over a
        // board that is simply locked sends somebody to look at the server.
        if (error instanceof Unauthenticated) {
          setNeedsLogin(true)
          // The form goes with it. The login screen replaces the whole tree, so a form left
          // open here comes back after the login with its typing gone and its captured date
          // still pointing at the day that was on screen before - which then saves onto a day
          // nobody is looking at. Found by a review pass, by pressing Back with a form open.
          setEditor(null)
          return
        }

        setFailure({
          date: target.date ?? 'Heute',
          message: error instanceof Error ? error.message : String(error),
        })

        // Put the address bar back on the day still being shown. Otherwise the header said
        // one date, the board showed another day's appointments and the URL a third - which is
        // how somebody reads tomorrow's board and says today's times out loud on the phone.
        setDay((shown) => {
          if (shown !== null) {
            window.history.replaceState(null, '', urlFor(shown.date, settingsFromUrl()))
          }
          return shown
        })
      })

    return () => {
      current = false
    }
  }, [target])

  const goTo = useCallback((next: string | null) => {
    // null is the edge of the representable calendar. The step goes nowhere, rather than
    // putting `+010000-01` in the address bar.
    if (next === null) return

    // Only a real move earns a history entry. Pushing unconditionally meant three impatient
    // clicks left three identical entries, so Back had to be pressed three times before the
    // board moved at all.
    if (new URLSearchParams(window.location.search).get('date') !== next) {
      window.history.pushState(null, '', urlFor(next, false))
    }
    setTarget((previous) => ({ date: next, attempt: previous.attempt + 1 }))
  }, [])

  /**
   * Asks the server which day today is, rather than trusting the one cached at the last load.
   * That cached value goes stale at midnight, and the header would then assert "heute" on a
   * board showing yesterday - with this button, the only thing that could correct it.
   */
  const goToday = useCallback(() => {
    window.history.pushState(null, '', window.location.pathname)
    setTarget((previous) => ({ date: null, attempt: previous.attempt + 1 }))
  }, [])

  const reload = useCallback(() => {
    setTarget((previous) => ({ ...previous, attempt: previous.attempt + 1 }))
  }, [])

  /**
   * After any successful write. The whole day is reloaded rather than patched in place, because
   * ADR-0009 assigns colour from the whole day: booking one appointment can change the colour of
   * boxes it never touched, and a client stitching its own copy together would quietly disagree
   * with every other screen.
   */
  const saved = useCallback(() => {
    setEditor(null)
    setNotice(null)
    reload()
  }, [reload])

  /** The day underneath moved on, so what was on screen cannot be trusted against it. */
  const outOfDate = useCallback(
    (message: string) => {
      setEditor(null)
      setNotice(message)
      reload()
    },
    [reload],
  )

  /**
   * A move or a resize, once the pointer is released. The gesture is the edit: there is no form
   * and no confirmation, which is the whole point of dragging - and no undo either, which is why
   * the board refuses a drop it can already see is occupied rather than trying it.
   *
   * ADR-0003 still decides the race. The version sent is the one the entry was read at, so a box
   * somebody else has changed since is refused rather than quietly overwritten.
   *
   * `date` arrives from the caller for the same reason the editor captures it: the day on screen
   * is the day being written to, and reading it later reads whatever has arrived since.
   */
  const dragged = useCallback(
    (
      entry: Entry,
      target: { employeeId: string; startsAt: string; endsAt: string },
      date: string,
    ) => {
      void updateEntry(entry.id, entry.version, {
        employeeId: target.employeeId,
        kind: entry.kind,
        date,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
        // Everything the drag did not touch travels back unchanged. A move is a move, not an edit.
        customer: entry.customer,
        treatment: entry.treatment,
        notes: entry.notes,
        reason: entry.reason,
      }).then(saved, (error: unknown) => {
        setNotice(error instanceof Error ? error.message : String(error))
        // Reload either way: a refusal means the board's copy is not what the database holds.
        reload()
      })
    },
    [reload, saved],
  )

  /**
   * ADR-0008: blocking a whole day is one 06:00-20:00 row, so this needs no rule of its own -
   * ticking it on a column that already has bookings is refused by the same constraint that
   * refuses any other clash, and the refusal says so.
   */
  const toggleWholeDay = useCallback(
    (employeeId: string, existing: Entry | undefined, date: string) => {
      // Unticking used to be safe by construction: the tick destroyed nothing it could not recreate
      // identically, so it needed no confirmation while the modal's own Löschen did. ADR-0014 broke
      // that - a whole-day block can now carry typed text - and a review pass found one click
      // deleting it with nothing asked and nothing on screen hinting there was anything to lose.
      //
      // So a labelled block opens instead of vanishing. The form is where deleting already asks
      // first, which is the confirmation that exists rather than a second one invented here.
      if (existing !== undefined && existing.reason !== null) {
        setEditor({ date, editing: existing, draft: { employeeId, startsAt: existing.startsAt, endsAt: existing.endsAt } })
        return
      }

      const work =
        existing === undefined
          ? createEntry({
              employeeId,
              kind: 'block',
              date,
              startsAt: DAY_STARTS_AT,
              endsAt: DAY_ENDS_AT,
              customer: null,
              treatment: null,
              notes: null,
              // The column tick makes a bare whole-day block. A reason is added by opening it,
              // which is one click more than the tick and keeps the tick a single gesture.
              reason: null,
            })
          : removeEntry(existing.id, existing.version)

      void work.then(
        () => saved(),
        (error: unknown) => {
          setNotice(error instanceof Refused || error instanceof Error ? error.message : String(error))
          // Reload either way: a refusal means the board's copy is not what the database holds.
          reload()
        },
      )
    },
    [reload, saved],
  )

  // Before the board, and before anything that reads `day`: a session can end while a day is
  // on screen, and what is on screen then is a day the server would no longer answer for.
  if (needsLogin) {
    // Dropped here rather than when the day arrives, so a successful login is answered by the
    // board loading instead of by the same empty form appearing again, which reads as a
    // refusal. If the load turns out to be unauthenticated after all, this comes straight back.
    return (
      <Login
        onSignedIn={() => {
          setNeedsLogin(false)
          reload()
        }}
      />
    )
  }

  // After the login check and before anything that reads `day`: the settings screen needs a
  // session but not a board, and somebody who lands on `?settings` with no session must meet the
  // login screen rather than a PIN prompt for a salon they are not in.
  if (settings) {
    return (
      <Settings
        onClose={() => {
          // `?date=` with nothing after it is not a date. Landing straight on `?settings` before
          // any day has arrived is the case, and the bare path means "today", which is right.
          const date = day?.date ?? target.date
          window.history.pushState(null, '', date === null ? window.location.pathname : urlFor(date, false))
          setSettings(false)
          // The staff list decides the columns, so the board behind this is out of date the
          // moment anything here was changed. Reloading always beats working out whether to.
          reload()
        }}
        onSignedOut={() => {
          // Changing the salon password ends every session, this one included. ADR-0017.
          //
          // The address bar goes with it. Leaving `&settings` there meant logging back in showed
          // the board and the next refresh showed the PIN prompt - the same state-and-URL
          // divergence `urlFor` exists to prevent, running the other way. A review pass found it.
          const date = day?.date ?? target.date
          window.history.replaceState(null, '', date === null ? window.location.pathname : urlFor(date, false))
          setSettings(false)
          setNeedsLogin(true)
        }}
      />
    )
  }

  if (day === null) {
    return (
      <main className="shell">
        {failure === null ? (
          <p>Termine werden geladen …</p>
        ) : (
          <div className="shell__failure" role="alert">
            <p>Laden fehlgeschlagen: {failure.message}</p>
            <button type="button" onClick={reload}>
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
  const pending = failure !== null ? day.date : (target.date ?? day.date)
  // While a load is open the header names the day being fetched, so a click is visibly
  // acknowledged. The board is dimmed at the same time, because it still shows the old day.
  const shown = loading ? pending : day.date

  return (
    <main className="shell">
      <TopBar
        date={shown}
        isToday={shown === day.today}
        loadedAt={loadedAt}
        stale={failure !== null}
        onStep={(weeks) => goTo(addWeeks(pending, weeks))}
        onToday={goToday}
        onReload={reload}
        onSettings={() => {
          window.history.pushState(null, '', urlFor(shown, true))
          setSettings(true)
        }}
      />

      {failure !== null && (
        <div className="shell__failure" role="alert">
          <p>
            {isSalonDate(failure.date) ? shortGermanDate(failure.date) : failure.date} konnte nicht geladen
            werden. Angezeigt wird weiterhin {shortGermanDate(day.date)}.{' '}
            <span className="shell__failure-detail">({failure.message})</span>
          </p>
          <button type="button" onClick={reload}>
            Erneut versuchen
          </button>
        </div>
      )}

      {notice !== null && (
        <div className="shell__notice" role="alert">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)}>
            Verstanden
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

        <div className="shell__day">
          {/* Outside the dimmed board, and above the sticky headings. Rendered inside, it was
              painted behind the headings and dimmed to 45% itself - the one element saying why
              the board had gone faint. */}
          {loading && <p className="shell__loading">Termine werden geladen …</p>}
          {/* `inert` and not only the CSS `pointer-events: none` that was here first. That
              stopped the mouse and left the keyboard: a review pass tabbed into the dimmed board
              during a load, pressed Space on a column checkbox, and blocked the whole day that
              was leaving - the exact bug the dimming was added to close. `inert` takes the whole
              subtree out of the tab order and out of hit testing in one attribute. */}
          <div className={loading ? 'shell__fading' : undefined} inert={loading}>
            <Board
              day={day}
              onOpenEntry={(entry) =>
                setEditor({
                  date: day.date,
                  editing: entry,
                  draft: { employeeId: entry.employeeId, startsAt: entry.startsAt, endsAt: entry.endsAt },
                })
              }
              onOpenSlot={(employeeId, startsAt, endsAt) =>
                setEditor({ date: day.date, editing: null, draft: { employeeId, startsAt, endsAt } })
              }
              onToggleWholeDay={(employeeId, existing) => toggleWholeDay(employeeId, existing, day.date)}
              onDragged={(entry, target) => dragged(entry, target, day.date)}
              onRefused={setNotice}
            />
          </div>
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

      {editor !== null && (
        <EntryModal
          date={editor.date}
          employees={day.employees}
          editing={editor.editing}
          draft={editor.draft}
          onClose={() => setEditor(null)}
          onSaved={saved}
          onOutOfDate={outOfDate}
        />
      )}
    </main>
  )
}
