-- Runs once, the first time the Postgres volume is created.
-- The test suite truncates tables, so it gets its own database and can never empty the
-- one somebody is developing against.
CREATE DATABASE salon_test;
