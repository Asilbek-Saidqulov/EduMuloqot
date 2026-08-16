-- Migration: add_student_unique_constraint
--
-- H5 fix: add a unique constraint on (parentId, fullName, className) to the
-- students table. This prevents duplicate child records under race conditions
-- (e.g. a parent double-tapping the "confirm" button).
--
-- The check-then-create in studentService.registerChild is not sufficient —
-- two concurrent requests can both pass the check and create duplicates.
-- This DB-level constraint is the only way to guarantee uniqueness under
-- concurrency.
--
-- If any duplicate rows already exist in the database, this migration will
-- FAIL — which is the correct behavior. Duplicate students must be resolved
-- manually (e.g. by deleting the duplicates) before the migration can succeed.
-- This is intentional: we do NOT silently delete existing data.

CREATE UNIQUE INDEX "students_parentId_fullName_className_key" ON "students"("parentId", "fullName", "className");
