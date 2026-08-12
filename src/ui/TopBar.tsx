import { isoWeek, longGermanDate } from '../calendar/dates'

interface Props {
  date: string
  today: string
  isToday: boolean
  onStep: (weeks: number) => void
  onToday: () => void
}

export function TopBar({ date, today, isToday, onStep, onToday }: Props) {
  const { week } = isoWeek(date)

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
          {/* Saying which day this is beats leaving it to a greyed-out button. A disabled
              control reads as broken, and it was also the only signal that you were not on
              today. */}
          {isToday ? <span className="topbar__istoday"> · heute</span> : null}
        </p>
      </div>

      <button type="button" className="topbar__step" onClick={() => onStep(1)}>
        Nächste Woche &raquo;
      </button>

      {/* Never disabled. It used to grey out when the shown day matched the day the server
          called today at the last load - so a board left open past midnight insisted that
          yesterday was today, with the one control that could fix it switched off. Clicking
          it now always re-asks the server. */}
      <button type="button" className="topbar__today" onClick={onToday} title={`Zu heute springen (${today})`}>
        Heute
      </button>
    </header>
  )
}
