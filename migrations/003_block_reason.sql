-- A block may say why. ADR-0014 supersedes the part of ADR-0008 that gave a block no text
-- at all: the salon wants to see "Urlaub" on the grey box rather than open it to find out.
--
-- A separate column and not `notes`, deliberately. An appointment's notes are private and
-- never drawn on the board - a customer's allergy note reached the screen once and three
-- review passes caught it. A reason is the opposite: it exists to be read at a glance. One
-- column carrying both rules is how the hidden one gets shown by accident.

ALTER TABLE appointment ADD COLUMN reason text;

-- The check has to be replaced rather than added to: it names every field a kind may carry,
-- so leaving the old one would keep refusing exactly what this migration allows.
ALTER TABLE appointment DROP CONSTRAINT appointment_fields_match_kind;

ALTER TABLE appointment ADD CONSTRAINT appointment_fields_match_kind CHECK (
  (kind = 'block'
    AND customer IS NULL
    AND treatment IS NULL
    AND notes IS NULL
    -- Blank is refused for the same reason a blank customer is: "nothing said" is NULL, and
    -- a box labelled with a space would look like a bug nobody can find.
    AND (reason IS NULL OR btrim(reason) <> ''))
  OR
  (kind = 'appointment'
    AND customer IS NOT NULL
    AND btrim(customer) <> ''
    AND (treatment IS NULL OR btrim(treatment) <> '')
    -- An appointment has no reason. It has a treatment, which is the same idea in the one
    -- place it belongs, and two fields meaning "what this is" would drift apart.
    AND reason IS NULL)
);
