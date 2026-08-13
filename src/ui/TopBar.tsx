import { isoWeek, longGermanDate } from '../calendar/dates'
import { holidayName } from '../calendar/opening'

interface Props {
  date: string
  isToday: boolean
  /** Wall clock time of the last successful load, or null before the first one. */
  loadedAt: string | null
  /** True when the last load failed, so what is on screen is not what was asked for. */
  stale: boolean
  onStep: (weeks: number) => void
  onToday: () => void
  onReload: () => void
  onSettings: () => void
}

export function TopBar({ date, isToday, loadedAt, stale, onStep, onToday, onReload, onSettings }: Props) {
  const { week } = isoWeek(date)
  const holiday = holidayName(date)

  return (
    <header className="topbar">
      <button type="button" className="topbar__step" onClick={() => onStep(-1)}>
        &laquo; Vorige Woche
      </button>

      <div className="topbar__date">
        <h1>{longGermanDate(date)}</h1>
        <p className="topbar__week">
          {/* ADR-0010: the ISO week number, whose year is not always the year in the date.
              Only the number is shown - "KW 53" on a date reading 2027 is correct, and a
              second year next to a different year confuses more than it explains. */}
          KW {week}
          {/* Saying which day this is beats leaving it to a greyed-out button. */}
          {isToday && <span className="topbar__istoday"> · heute</span>}
          {/* ADR-0016. The board is washed pink on a holiday, and without the name that is
              ambiguous between "the salon is shut" and "the software has a fault". It sits here
              rather than in the heading because the heading is the date and nothing else, and
              because this line already reads as a list of things about the day. */}
          {holiday !== null && <span className="topbar__holiday"> · {holiday}</span>}
          {/* The board loads once and nothing polls yet, so at 14:00 it looks exactly like a
              live board loaded at 09:00. The brief's whole premise is that nobody can tell how
              stale a photograph is; a screen that cannot say either has the same fault with
              better typography. */}
          {loadedAt !== null && (
            <span className={stale ? 'topbar__stand topbar__stand--stale' : 'topbar__stand'}>
              {' '}
              · Stand {loadedAt}
              {stale && ' (nicht aktualisiert)'}
            </span>
          )}
        </p>
      </div>

      <button type="button" className="topbar__step" onClick={() => onStep(1)}>
        Nächste Woche &raquo;
      </button>

      <div className="topbar__actions">
        {/* Never disabled, and it always asks the server which day today is. The cached answer
            goes stale at midnight, and a disabled button on a board insisting yesterday is
            today is the one state with no way out. */}
        <button type="button" className="topbar__today" onClick={onToday}>
          Heute
        </button>
        <button type="button" className="topbar__today" onClick={onReload}>
          Aktualisieren
        </button>
        {/* Last, and styled like the others rather than louder. It is the thing somebody needs
            twice a year, and the PIN behind it is what makes reaching it by accident harmless. */}
        <button type="button" className="topbar__today" onClick={onSettings}>
          Einstellungen
        </button>
      </div>
    </header>
  )
}
