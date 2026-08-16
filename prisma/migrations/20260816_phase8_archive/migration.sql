-- Migration: phase8_archive
--
-- Phase 8: Archive lifecycle.
--
-- Adds `archivedAt` nullable timestamp to `students` and `attendances`
-- tables. This is a soft-archive flag:
--   null       = active record (default)
--   non-null   = archived (timestamp of archival)
--
-- Archived records remain in the same table — no data is moved or deleted.
-- Reports default to active data (WHERE "archivedAt" IS NULL).
--
-- No existing data is modified. All existing records get archivedAt = NULL
-- (the default for nullable columns).
--
-- Indexes added:
--   students(schoolId, archivedAt)       — for listing active students by school
--   attendances(archivedAt, date)       — for querying archived records by date

-- 1. Add archivedAt to students
ALTER TABLE "students" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 2. Add archivedAt to attendances
ALTER TABLE "attendances" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 3. Index for listing active students by school (WHERE archivedAt IS NULL)
CREATE INDEX "students_schoolId_archivedAt_idx" ON "students"("schoolId", "archivedAt");

-- 4. Index for querying archived attendance by date
CREATE INDEX "attendances_archivedAt_date_idx" ON "attendances"("archivedAt", "date");
