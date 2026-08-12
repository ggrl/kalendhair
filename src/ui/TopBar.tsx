import { isoWeek, longGermanDate } from '../calendar/dates'

interface Props {
  date: string
  today: string
  onStep: (weeks: number) => void
  onToday: () => void
}

export function TopBar({ date, today, onStep, onToday }: Props) {
  const { week } = isoWeek(date)

  return (
    <header className="topbar">
      <button type="button" className="topbar__step" onClick={() => onStep(-1)} aria-label="Vorherige Woche">
        &laquo; Woche
      </button>

      <div className="topbar__date">
        <h1>{longGermanDate(date)}</h1>
        {/* ADR-0010: the ISO week number, whose year is not always the year in the date.
            Only the number is shown - "KW 53" on a date reading 2027 is correct, and adding
            a second year next to a different year confuses more than it explains. */}
        <p className="topbar__week">KW {week}</p>
      </div>

      <button type="button" className="topbar__step" onClick={() => onStep(1)} aria-label="Nächste Woche">
        Woche &raquo;
      </button>

      <button
        type="button"
        className="topbar__today"
        onClick={onToday}
        disabled={date === today}
        aria-label="Zu heute springen"
      >
        Heute
      </button>
    </header>
  )
}
