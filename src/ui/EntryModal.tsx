import { useEffect, useId, useRef, useState } from 'react'
import type { Employee, Entry } from '../calendar/types'
import { whyNotBookable } from '../calendar/grid'
import { Refused, createEntry, fetchSuggestions, removeEntry, updateEntry } from './api'
import type { EntryDraft } from './api'

interface Props {
  date: string
  employees: Employee[]
  /** The entry being changed, or a draft for a slot that is not booked yet. */
  editing: Entry | null
  draft: { employeeId: string; startsAt: string; endsAt: string }
  onClose: () => void
  /** Called after any successful write. The day is reloaded rather than patched: ADR-0009. */
  onSaved: () => void
  /** Called when the day underneath has moved on and what is on screen cannot be trusted. */
  onOutOfDate: (message: string) => void
}

export function EntryModal({ date, employees, editing, draft, onClose, onSaved, onOutOfDate }: Props) {
  const [employeeId, setEmployeeId] = useState(editing?.employeeId ?? draft.employeeId)
  const [isBlock, setIsBlock] = useState(editing?.kind === 'block')
  const [startsAt, setStartsAt] = useState(editing?.startsAt ?? draft.startsAt)
  const [endsAt, setEndsAt] = useState(editing?.endsAt ?? draft.endsAt)
  const [customer, setCustomer] = useState(editing?.customer ?? '')
  const [treatment, setTreatment] = useState(editing?.treatment ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')

  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const [customerOptions, setCustomerOptions] = useState<string[]>([])
  const [treatmentOptions, setTreatmentOptions] = useState<string[]>([])

  const dialog = useRef<HTMLDivElement>(null)
  const ids = useId()

  useEffect(() => {
    // Escape closes, like the notes panel it replaces. A form with no visible way out is the
    // complaint people have about dialogues, and this one covers the board.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    // Focus lands inside the dialogue, or a keyboard user is left on the board behind it.
    dialog.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }, [])

  useEffect(() => {
    let current = true
    void fetchSuggestions('customer', customer).then((found) => {
      if (current) setCustomerOptions(found)
    })
    return () => {
      current = false
    }
  }, [customer])

  useEffect(() => {
    let current = true
    void fetchSuggestions('treatment', treatment).then((found) => {
      if (current) setTreatmentOptions(found)
    })
    return () => {
      current = false
    }
  }, [treatment])

  function draftFrom(): EntryDraft {
    return {
      employeeId,
      kind: isBlock ? 'block' : 'appointment',
      date,
      startsAt,
      endsAt,
      // A block carries no text at all: ADR-0008. Sending what is in the fields would be
      // refused by the server, which is correct but a worse message than not sending it.
      customer: isBlock ? null : customer.trim() || null,
      treatment: isBlock ? null : treatment.trim() || null,
      notes: isBlock ? null : notes.trim() || null,
    }
  }

  async function save(): Promise<void> {
    // Refuse here what the server would refuse anyway, using the same function it uses, so the
    // common mistakes never cost a round trip. The server checks again regardless: a rule
    // enforced only in the browser is not enforced.
    const unbookable = whyNotBookable(startsAt, endsAt)
    if (unbookable !== null) {
      setProblem(unbookable)
      return
    }
    if (!isBlock && customer.trim() === '') {
      setProblem('Ohne Namen lässt sich der Termin nicht speichern.')
      return
    }

    setSaving(true)
    setProblem(null)
    try {
      if (editing === null) await createEntry(draftFrom())
      else await updateEntry(editing.id, editing.version, draftFrom())
      onSaved()
    } catch (error) {
      setSaving(false)
      handle(error)
    }
  }

  async function destroy(): Promise<void> {
    if (editing === null) return
    setSaving(true)
    try {
      await removeEntry(editing.id, editing.version)
      onSaved()
    } catch (error) {
      setSaving(false)
      handle(error)
    }
  }

  function handle(error: unknown): void {
    if (error instanceof Refused && (error.code === 'stale' || error.code === 'gone')) {
      // The day underneath has moved on, so nothing in this form can be trusted against it.
      // ADR-0003's own answer, chosen deliberately over keeping the typing: reload and look.
      onOutOfDate(error.message)
      return
    }
    setProblem(error instanceof Error ? error.message : String(error))
  }

  return (
    <div className="modal__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} ref={dialog}>
        <h2 id={`${ids}-title`}>{editing === null ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}</h2>

        <label className="modal__row modal__row--check">
          <input type="checkbox" checked={isBlock} onChange={(event) => setIsBlock(event.target.checked)} />
          Sperrzeit (keine Kundin, nur blockierte Zeit)
        </label>

        <label className="modal__row">
          Person
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>

        <div className="modal__times">
          <label className="modal__row">
            Von
            <input type="time" step={900} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </label>
          <label className="modal__row">
            Bis
            <input type="time" step={900} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </label>
        </div>

        {!isBlock && (
          <>
            <label className="modal__row">
              Kundin / Kunde
              <input
                list={`${ids}-customers`}
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
                autoComplete="off"
              />
              <datalist id={`${ids}-customers`}>
                {customerOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>

            <label className="modal__row">
              Behandlung
              <input
                list={`${ids}-treatments`}
                value={treatment}
                onChange={(event) => setTreatment(event.target.value)}
                autoComplete="off"
              />
              <datalist id={`${ids}-treatments`}>
                {treatmentOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>

            <label className="modal__row">
              Notizen
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </>
        )}

        {problem !== null && (
          <p className="modal__problem" role="alert">
            {problem}
          </p>
        )}

        {/* While the deletion is being confirmed, the question and its two answers are the only
            controls. Adding them next to Abbrechen and Speichern made the row wider than the
            dialogue and pushed Speichern off the edge - and disabling those two would not have
            helped, because a disabled button still takes the width that caused it. There is
            also only one decision to make at that moment, so showing two others invites a
            mis-click on the one action that cannot be undone. */}
        {confirmingDelete ? (
          <div className="modal__actions modal__actions--confirm">
            <span className="modal__confirm">Wirklich löschen?</span>
            <span className="modal__spacer" />
            {/* The destructive answer is NOT in the bottom-right corner, where Speichern sits on
                every other view of this dialogue. A hand that has learned "the button in that
                corner saves" would otherwise land on the one action with no undo. The safe
                answer keeps the position muscle memory reaches for. */}
            <button type="button" className="modal__danger" onClick={() => void destroy()} disabled={saving}>
              {saving ? 'Löscht …' : 'Ja, löschen'}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={saving} autoFocus>
              Nein
            </button>
          </div>
        ) : (
          <div className="modal__actions">
            {editing !== null && (
              <button type="button" className="modal__danger" onClick={() => setConfirmingDelete(true)}>
                Löschen
              </button>
            )}

            <span className="modal__spacer" />
            <button type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="modal__save" onClick={() => void save()} disabled={saving}>
              {saving ? 'Speichert …' : 'Speichern'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
