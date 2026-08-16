-- Migration: phase10_teacher_subject
--
-- Phase 10: Teacher subject + class teacher assignment + attendance subject + absence reason
--
-- Adds 4 nullable fields:
--   users.teacherSubject      — TEACHER's subject (free text, assigned by admin)
--   users.assignedClassName   — CLASS_TEACHER's assigned class (e.g. "11-A")
--   attendances.subject       — Subject under which attendance was recorded (historical)
--   attendances.absenceReason — Parent-submitted absence reason (visible ONLY to CLASS_TEACHER)
--
-- All fields are nullable — existing records get NULL (no data loss).
-- No existing data is modified or deleted.

-- 1. Add teacherSubject to users
ALTER TABLE "users" ADD COLUMN "teacherSubject" TEXT;

-- 2. Add assignedClassName to users
ALTER TABLE "users" ADD COLUMN "assignedClassName" TEXT;

-- 3. Add subject to attendances
ALTER TABLE "attendances" ADD COLUMN "subject" TEXT;

-- 4. Add absenceReason to attendances
ALTER TABLE "attendances" ADD COLUMN "absenceReason" TEXT;
