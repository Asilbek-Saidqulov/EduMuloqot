/*
  Warnings:

  - Added the required column `updatedAt` to the `student_applications` table without a default value. This is not possible if the table is not empty.

*/

-- DropForeignKey
ALTER TABLE "student_applications" DROP CONSTRAINT "student_applications_applicantUserId_fkey";

-- DropForeignKey
ALTER TABLE "student_applications" DROP CONSTRAINT "student_applications_resolvedById_fkey";

-- DropForeignKey
ALTER TABLE "student_applications" DROP CONSTRAINT "student_applications_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "student_applications" DROP CONSTRAINT "student_applications_studentId_fkey";

-- DropIndex
DROP INDEX "student_applications_applicantUserId_idx";

-- DropIndex
DROP INDEX "student_applications_studentId_key";

-- AlterTable
ALTER TABLE "student_applications" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "student_applications_applicantUserId_schoolId_status_idx"
ON "student_applications"("applicantUserId", "schoolId", "status");

-- AddForeignKey
ALTER TABLE "student_applications"
ADD CONSTRAINT "student_applications_applicantUserId_fkey"
FOREIGN KEY ("applicantUserId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_applications"
ADD CONSTRAINT "student_applications_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_applications"
ADD CONSTRAINT "student_applications_resolvedById_fkey"
FOREIGN KEY ("resolvedById") REFERENCES "admins"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_applications"
ADD CONSTRAINT "student_applications_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "students"("id")
ON DELETE SET NULL ON UPDATE CASCADE;