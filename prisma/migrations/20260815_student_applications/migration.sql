-- Migration: student_applications
--
-- Phase 5+: Student Applications
--
-- Adds the StudentApplicationStatus enum and student_applications
-- table. When a student can't find themselves in the database during
-- onboarding, they can submit an application. School admins review
-- and approve/reject applications. On approval, a Student record is
-- created and linked to the application.
--
-- No existing data is modified or deleted.

-- 1. Create StudentApplicationStatus enum
CREATE TYPE "StudentApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- 2. Create student_applications table
CREATE TABLE "student_applications" (
    "id" SERIAL NOT NULL,
    "applicantUserId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "className" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "status" "StudentApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "studentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_applications_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on studentId (1:1 relation with students)
CREATE UNIQUE INDEX "student_applications_studentId_key" ON "student_applications"("studentId");

-- Indexes
CREATE INDEX "student_applications_schoolId_status_idx" ON "student_applications"("schoolId", "status");
CREATE INDEX "student_applications_applicantUserId_idx" ON "student_applications"("applicantUserId");

-- Foreign keys
ALTER TABLE "student_applications" ADD CONSTRAINT "student_applications_applicantUserId_fkey"
    FOREIGN KEY ("applicantUserId") REFERENCES "users"("id");
ALTER TABLE "student_applications" ADD CONSTRAINT "student_applications_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "users"("id");
ALTER TABLE "student_applications" ADD CONSTRAINT "student_applications_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id");
ALTER TABLE "student_applications" ADD CONSTRAINT "student_applications_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "students"("id");
