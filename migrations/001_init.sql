-- Employees and the single table holding both appointments and blocks.
--
-- The exclusion constraint below is the whole reason this schema looks the way it
-- does. It was read in the PostgreSQL documentation and proved against 17.10 before
-- being written here: see ADR-0001. Blocks live in this same table rather than their
-- own, because an exclusion constraint cannot span two tables and "nothing may be
-- booked over a block" is exactly the rule it has to enforce: see ADR-0008.

-- Needed for the `employee_id WITH =` half of the exclusion constraint. A GiST index
-- cannot do plain equality on a scalar without it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE employee (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Column order on the board. Not the name, so renaming somebody does not move them.
  position   integer NOT NULL,
  -- ADR-0002: staff are deactivated, never deleted. An inactive employee keeps every
  -- appointment ever booked against them, and past days still render correctly.
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE appointment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee (id),

  kind        text NOT NULL CHECK (kind IN ('appointment', 'block')),

  -- ADR-0007: salon-local wall clock, never an absolute instant. `timestamp` here is
  -- timestamp WITHOUT time zone deliberately - 10:00 means the salon's 10:00 to every
  -- client, wherever the device is and whatever the container's TZ says.
  starts_at   timestamp NOT NULL,
  ends_at     timestamp NOT NULL,

  -- Null for blocks. A block is a grey area with no text: ADR-0008.
  customer    text,
  treatment   text,
  notes       text,

  -- Without this the exclusion constraint has a hole: an empty range overlaps nothing,
  -- so a zero-length row is accepted and stored inside an occupied hour, invisible on
  -- the board. Found by testing the constraint rather than reasoning about it, and the
  -- gesture that produces it - a drag that ends where it started - is one the UI allows.
  CONSTRAINT appointment_positive_duration CHECK (ends_at > starts_at),

  -- Keeps the two kinds honest: a block cannot carry a customer, and an appointment
  -- cannot be missing one.
  --
  -- `IS NOT NULL` alone was not enough. An empty or all-space customer name passed it,
  -- and the colour rule then keys every nameless box to the same '' - so two unrelated
  -- boxes came back in one colour, which is the false-pair claim ADR-0009 exists to
  -- prevent, arriving from the other end.
  --
  -- Treatment is optional. The first version required it, which nothing in the brief or
  -- the ADRs asks for, and it would refuse the ordinary case of a receptionist with a name
  -- and not yet a decision. Blank is still refused: a column that means "not said yet"
  -- should hold NULL, not a space.
  CONSTRAINT appointment_fields_match_kind CHECK (
    (kind = 'block' AND customer IS NULL AND treatment IS NULL AND notes IS NULL)
    OR
    (kind = 'appointment'
      AND customer IS NOT NULL
      AND btrim(customer) <> ''
      AND (treatment IS NULL OR btrim(treatment) <> ''))
  ),

  -- The board draws one day. A row crossing midnight renders as a box running from 19:00
  -- to 02:00, which is not a shape the grid has, and it hides from the following day
  -- entirely because a day is selected on starts_at. The bookable window itself
  -- (06:00-20:00) is not enforced here: that constant lives in the application, and
  -- duplicating it in SQL would give one rule two homes. It belongs with the write path.
  --
  -- One consequence to know before changing the grid: a row can never end at 00:00. If the
  -- bookable window ever reaches midnight, the last slot of the day has to express its end
  -- some other way, and this constraint is what will stop it.
  CONSTRAINT appointment_within_one_day CHECK ((starts_at)::date = (ends_at)::date),

  -- The rule. Covers all four combinations without a line of application code:
  -- appointment on appointment, appointment on block, block on appointment,
  -- block on block. '[)' bounds are load-bearing: the upper end is exclusive, so
  -- 11:00-12:00 books cleanly after 10:00-11:00. A 15-minute grid is nothing but
  -- adjacent appointments, and inclusive bounds would make every one a false clash.
  EXCLUDE USING gist (
    employee_id WITH =,
    tsrange(starts_at, ends_at, '[)') WITH &&
  )
);

-- Every read is "one day, all employees", so the date is what the index has to serve.
CREATE INDEX appointment_day ON appointment (((starts_at)::date));
