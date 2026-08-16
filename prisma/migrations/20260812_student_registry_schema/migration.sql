-- Migration: student_registry_schema
--
-- Phase 1 of the Student Registry architecture: make the Student model
-- support registry-imported students that have no parent linked yet.
--
-- Changes:
-- 1. Add `pinfl` column (nullable, unique) — primary student identity key
--    from the school's Excel registry. Nullable because legacy Student
--    records (created by the old parent-registration flow) don't have PINFL.
-- 2. Add `birthDate` column (nullable) — from the Excel "Tug'ilgan sana".
-- 3. Make `parentId` nullable — imported registry students initially have
--    parentId = NULL. A parent "claims" the student later by setting
--    parentId.
-- 4. Drop the old unique constraint `@@unique([parentId, fullName, className])`
--    — this belonged to the old "parent creates a Student" architecture
--    and is meaningless when parentId is NULL (PostgreSQL treats multiple
--    NULLs as distinct).
-- 5. Add a unique index on `pinfl` — the real uniqueness guarantee for
--    the registry. Safe because the column is new (all existing rows have
--    pinfl = NULL, and PostgreSQL allows multiple NULLs in a unique index).
-- 6. Add an index on `(schoolId, fullName, className)` — for fallback
--    name/class searching when PINFL is not available.
-- 7. Update the `parentId` foreign key from ON DELETE RESTRICT to
--    ON DELETE SET NULL — so deleting a parent User does not prevent
--    the Student registry record from existing. The student becomes
--    unlinked (parentId = NULL) but the registry record is preserved.
--
-- Legacy data preservation:
--   Existing Student records are NOT deleted, NOT unlinked, and NOT
--   modified. Their parentId remains set. After this migration they
--   simply have pinfl = NULL and birthDate = NULL, which is correct —
--   they were created before the registry import feature existed.

-- 1. Add pinfl column (nullable)
ALTER TABLE "students" ADD COLUMN "pinfl" TEXT;

-- 2. Add birthDate column (nullable)
ALTER TABLE "students" ADD COLUMN "birthDate" TIMESTAMP(3);

-- 3. Make parentId nullable (was NOT NULL)
ALTER TABLE "students" ALTER COLUMN "parentId" DROP NOT NULL;

-- 4. Drop the old unique constraint on (parentId, fullName, className)
DROP INDEX IF EXISTS "students_parentId_fullName_className_key";

-- 5. Add unique index on pinfl.
--    Safe: pinfl is a new column, all existing rows have pinfl = NULL,
--    and PostgreSQL allows multiple NULLs in a unique index.
CREATE UNIQUE INDEX "students_pinfl_key" ON "students"("pinfl");

-- 6. Add index on (schoolId, fullName, className) for fallback search
CREATE INDEX "students_schoolId_fullName_className_idx" ON "students"("schoolId", "fullName", "className");

-- 7. Update parentId foreign key: ON DELETE RESTRICT → ON DELETE SET NULL
ALTER TABLE "students" DROP CONSTRAINT "students_parentId_fkey";
ALTER TABLE "students" ADD CONSTRAINT "students_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
