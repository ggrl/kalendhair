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
  onSettings: () => void
}

export function TopBar({ date, isToday, loadedAt, stale, onStep, onToday, onPick, onSettings }: Props) {
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

        {/* ADR-0020: the browser's own picker, not one of ours.
            Chrome opens the month grid this was asked for, and a phone opens the native wheel -
            neither of which we could match, and both of which arrive with the German locale, the
            keyboard and a screen reader name already working. The label is here rather than
            visible because the top bar has no room for a word and the control is self-evident.

            `value` is the day on screen, so the picker always opens on the day being looked at
            rather than on today. A cleared field moves nothing: see `onChange`. */}
        <label className="topbar__pick">
          <span className="topbar__pick-label">Datum wählen</span>
          <input
            type="date"
            value={date}
            // Every change is passed on, including the empty string a browser hands back for a
            // cleared or half-typed field. It is not checked here: `App.tsx` refuses anything
            // `isSalonDate` rejects, and an empty string is one of those. A guard here as well
            // would be a second copy of one rule, and the copy that is never the authority is the
            // one that drifts.
            onChange={(event) => onPick(event.target.value)}
          />
        </label>
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
