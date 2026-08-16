-- Migration: phase5_attendance
--
-- Phase 5: Attendance & Student Tracking.
--
-- Adds three new tables:
--   1. attendances              — one row per (studentId, date)
--   2. attendance_audit_logs    — change history for each attendance row
--   3. attendance_escalations   — mahalla escalation records
--
-- Adds one new enum:
--   AttendanceStatus (PRESENT, ABSENT, LATE, EXCUSED)
--
-- No existing data is modified or deleted. The new tables are empty
-- after migration; the new relations on User/School/Neighborhood/
-- Student are non-breaking (Prisma-only — no DB FK changes on the
-- existing tables, since the new FKs live on the new tables and
-- point to existing rows).

-- 1. Create AttendanceStatus enum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- 2. Create attendances table
CREATE TABLE "attendances" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "recordedById" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "className" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one attendance record per student per date.
-- Prevents duplicate submissions when teacher double-clicks save or
-- when a stale callback is replayed.
CREATE UNIQUE INDEX "attendances_studentId_date_key" ON "attendances"("studentId", "date");

-- Indexes for common query patterns
CREATE INDEX "attendances_studentId_date_idx" ON "attendances"("studentId", "date");
CREATE INDEX "attendances_schoolId_date_idx" ON "attendances"("schoolId", "date");
CREATE INDEX "attendances_schoolId_className_date_idx" ON "attendances"("schoolId", "className", "date");
CREATE INDEX "attendances_recordedById_idx" ON "attendances"("recordedById");

-- Foreign keys
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE;
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id");
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id");

-- 3. Create attendance_audit_logs table
CREATE TABLE "attendance_audit_logs" (
    "id" SERIAL NOT NULL,
    "attendanceId" INTEGER NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "oldStatus" "AttendanceStatus",
    "newStatus" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_audit_logs_attendanceId_idx" ON "attendance_audit_logs"("attendanceId");
CREATE INDEX "attendance_audit_logs_actorUserId_idx" ON "attendance_audit_logs"("actorUserId");

ALTER TABLE "attendance_audit_logs" ADD CONSTRAINT "attendance_audit_logs_attendanceId_fkey"
    FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE CASCADE;
ALTER TABLE "attendance_audit_logs" ADD CONSTRAINT "attendance_audit_logs_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id");

-- 4. Create attendance_escalations table
CREATE TABLE "attendance_escalations" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "neighborhoodId" INTEGER NOT NULL,
    "absenceCount" INTEGER NOT NULL,
    "thresholdDate" DATE NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_escalations_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: same student reaching threshold on same date
-- cannot trigger two escalations.
CREATE UNIQUE INDEX "attendance_escalations_studentId_thresholdDate_key"
    ON "attendance_escalations"("studentId", "thresholdDate");

CREATE INDEX "attendance_escalations_studentId_idx" ON "attendance_escalations"("studentId");
CREATE INDEX "attendance_escalations_neighborhoodId_idx" ON "attendance_escalations"("neighborhoodId");
CREATE INDEX "attendance_escalations_schoolId_idx" ON "attendance_escalations"("schoolId");

ALTER TABLE "attendance_escalations" ADD CONSTRAINT "attendance_escalations_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE;
ALTER TABLE "attendance_escalations" ADD CONSTRAINT "attendance_escalations_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id");
ALTER TABLE "attendance_escalations" ADD CONSTRAINT "attendance_escalations_neighborhoodId_fkey"
    FOREIGN KEY ("neighborhoodId") REFERENCES "neighborhoods"("id");
ALTER TABLE "attendance_escalations" ADD CONSTRAINT "attendance_escalations_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id");
