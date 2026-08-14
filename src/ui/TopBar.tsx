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
  onSettings: () => void
}

export function TopBar({ date, isToday, loadedAt, stale, onStep, onToday, onSettings }: Props) {
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
        {/* `Aktualisieren` was here until ADR-0019 and is gone with it. It existed because nothing
            polled; now the timer never stops trying, so a board that says `nicht aktuell` comes
            back on its own within thirty seconds of the network doing the same. The owner chose
            removing it over keeping it as a way to skip that wait. */}
        {/* Last, and styled like the others rather than louder. It is the thing somebody needs
            twice a year, and the PIN behind it is what makes reaching it by accident harmless. */}
        <button type="button" className="topbar__today" onClick={onSettings}>
          Einstellungen
        </button>
      </div>
    </header>
  )
}
