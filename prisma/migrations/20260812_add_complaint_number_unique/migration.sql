-- Migration: add_complaint_number_unique
--
-- M1 fix: add a unique constraint on complaintNumber. The value is generated
-- from id inside a transaction (e.g. "#EDU-000001"), so collisions are
-- unlikely, but without a DB-level unique constraint there is no guarantee.
-- If any duplicate complaintNumber values already exist, this migration will
-- FAIL — duplicates must be resolved manually before applying.

CREATE UNIQUE INDEX "complaints_complaintNumber_key" ON "complaints"("complaintNumber");
