import { useRef } from 'react'
import { isoWeek, longGermanDate } from '../calendar/dates'
import { holidayName } from '../calendar/opening'

interface Props {
  date: string
  isToday: boolean
  /** Wall clock time of the last successful load, or null before the first one. */
  loadedAt: string | null
  /**
   * True when what is on screen is not current: either the day somebody asked for never arrived,
   * or the poll has failed twice running. ADR-0019 makes those one idea deliberately - they mean
   * the same thing to the person reading the board, and only the wording of the cause differs.
   */
  stale: boolean
  onStep: (weeks: number) => void
  onToday: () => void
  /** A date chosen outright rather than stepped to. ADR-0020. */
  onPick: (date: string) => void
  /**
   * Open an empty form for a new appointment on the day being shown. ADR-0021.
   *
   * Null when there is nobody to book, and while a day is loading - the two states where the
   * button would open a form that cannot name a person, or would name the wrong day.
   */
  onAdd: (() => void) | null
  onSettings: () => void
}

export function TopBar({
  date,
  isToday,
  loadedAt,
  stale,
  onStep,
  onToday,
  onPick,
  onAdd,
  onSettings,
}: Props) {
  const { week } = isoWeek(date)
  const holiday = holidayName(date)

  /**
   * The date input, which is in the page but never seen. ADR-0020 keeps the browser's own picker;
   * what changed is only how it is opened - a glyph beside the date rather than a second copy of
   * the date in a field.
   *
   * It has to stay *rendered*: `showPicker()` throws on a `display: none` element. It is therefore
   * transparent and sits exactly under the button, which is also what makes the popup appear under
   * the button rather than somewhere else on the page.
   */
  const picker = useRef<HTMLInputElement>(null)

  function openPicker(): void {
    const input = picker.current
    if (input === null) return
    // `showPicker` needs a user gesture, which a click is. Older browsers without it fall back to
    // focusing the field - which is worse than a picker and better than a control that does
    // nothing when pressed.
    if (typeof input.showPicker === 'function') input.showPicker()
    else input.focus()
  }

  return (
    <header className="topbar">
      {/* The words are hidden on a narrow screen, where five controls do not fit one row - so the
          name is an `aria-label` rather than the text inside. Without it the button would announce
          itself as "«" on a phone, which is not a thing anybody can act on. */}
      <button type="button" className="topbar__step" onClick={() => onStep(-1)} aria-label="Vorige Woche">
        <span aria-hidden="true">&laquo;</span>
        <span className="topbar__step-words"> Vorige Woche</span>
      </button>

      {/* Settings, today, add - in that order, with the day you are on in the middle and the two
          things that leave it either side. The icons carry an `aria-label` because an icon has no
          text to be named by, and a button a screen reader announces as "Schaltfläche" is a button
          nobody can use.

          Between the two week steps in the markup because that is where it is on the screen: one
          row of controls, read left to right. The grid alone could place them that way and leave
          the markup in any order at all - and then Tab would walk the row in an order nobody can
          see. Tab follows the markup, not the grid, which is also why the date block is last. */}
      <div className="topbar__actions">
        {/* A cog rather than three dots. Three dots promise a menu that opens under the finger,
            and this opens a whole screen - a small promise the button would not keep. The PIN
            behind it is what makes reaching it by accident harmless. */}
        <button
          type="button"
          className="topbar__icon"
          onClick={onSettings}
          aria-label="Einstellungen"
          title="Einstellungen"
        >
          {/* A cog needs a body with teeth outside it. The first attempt drew spokes radiating
              from the centre with no ring, which at 18px is a sun - and a sun is not a promise
              about settings. The hub, the ring, then eight teeth standing off it. */}
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M10 2.4v1.7M10 15.9v1.7M2.4 10h1.7M15.9 10h1.7M4.6 4.6l1.2 1.2M14.2 14.2l1.2 1.2M15.4 4.6l-1.2 1.2M5.8 14.2l-1.2 1.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Never disabled, and it always asks the server which day today is. The cached answer
            goes stale at midnight, and a disabled button on a board insisting yesterday is
            today is the one state with no way out.

            The one word left in this row: it is the thing pressed most often, and a house symbol
            or an arrow would both be guesses about which day it means. */}
        <button type="button" className="topbar__today" onClick={onToday}>
          Heute
        </button>

        {/* `Aktualisieren` was here until ADR-0019 and is gone with it. It existed because nothing
            polled; now the timer never stops trying, so a board that says `nicht aktuell` comes
            back on its own within thirty seconds of the network doing the same. The owner chose
            removing it over keeping it as a way to skip that wait. */}
        {/* ADR-0021. Put here for a phone, where there is no dragging - and it closes a gap that
            has nothing to do with phones: ADR-0013 records that there is deliberately no keyboard
            gesture for creating an appointment, so until now somebody who cannot use a mouse could
            not make one at all. This is their first way in, on every screen.

            Absent rather than disabled when nobody is on the board: the form's first field is the
            person, and there is nothing to put in it. The board already says so in words.

            Named `Neuer Termin` and not `+ Termin`: the label is what a screen reader reads out,
            and "plus Termin" is not a thing anybody says. */}
        {onAdd !== null && (
          <button
            type="button"
            className="topbar__icon topbar__icon--add"
            onClick={onAdd}
            aria-label="Neuer Termin"
            title="Neuer Termin"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <button type="button" className="topbar__step" onClick={() => onStep(1)} aria-label="Nächste Woche">
        <span className="topbar__step-words">Nächste Woche </span>
        <span aria-hidden="true">&raquo;</span>
      </button>

      <div className="topbar__date">
        <div className="topbar__heading">
          <h1>{longGermanDate(date)}</h1>

          {/* ADR-0020, moved here from the button row. The field beside `Heute` said the date a
              second time, two inches from the heading that already said it; this is the same
              control with the duplicate removed. */}
          <button type="button" className="topbar__pick" onClick={openPicker} aria-label="Datum wählen">
            {/* Drawn rather than an emoji: `AGENTS.md` forbids one, and a glyph that renders as a
                different picture on every platform is not a control anybody learns. */}
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
              <rect x="1.5" y="3" width="13" height="11.5" rx="1.5" fill="none" stroke="currentColor" />
              <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" fill="none" stroke="currentColor" />
            </svg>
          </button>

          <input
            ref={picker}
            type="date"
            className="topbar__pick-input"
            value={date}
            // Out of the tab order and out of the accessibility tree: the button above is the one
            // control, and two stops for one thing is clutter a keyboard user has to walk through.
            tabIndex={-1}
            aria-hidden="true"
            // Every change is passed on, including the empty string a browser hands back for a
            // cleared or half-typed field. It is not checked here: `App.tsx` refuses anything
            // `isSalonDate` rejects, and an empty string is one of those. A guard here as well
            // would be a second copy of one rule, and the copy that is never the authority is the
            // one that drifts.
            onChange={(event) => onPick(event.target.value)}
          />
        </div>
        <p className="topbar__week">
          {/* ADR-0010: the ISO week number, whose year is not always the year in the date.
              Only the number is shown - "KW 53" on a date reading 2027 is correct, and a
              second year next to a different year confuses more than it explains. */}
          KW {week}
          {/* Saying which day this is beats leaving it to a greyed-out button. */}
          {isToday && <span className="topbar__istoday"> · heute</span>}
          {/* ADR-0016. The board is shaded top to bottom on a holiday, and without the name that is
              ambiguous between "the salon is shut" and "the software has a fault". It sits here
              rather than in the heading because the heading is the date and nothing else, and
              because this line already reads as a list of things about the day. */}
          {holiday !== null && <span className="topbar__holiday"> · {holiday}</span>}
          {/* The board polls, so this normally moves on its own every half minute. It stays
              because polling can stop: the brief's whole premise is that nobody can tell how stale
              a photograph is, and a board that silently stopped updating would be exactly that
              with better typography. `nicht aktuell` is the board declining to claim otherwise. */}
          {loadedAt !== null && (
            <span className={stale ? 'topbar__stand topbar__stand--stale' : 'topbar__stand'}>
              {' '}
              · Stand {loadedAt}
              {stale && ' · nicht aktuell'}
            </span>
          )}
        </p>
      </div>

    </header>
  )
}
