-- CreateEnum
CREATE TYPE "Responsibility" AS ENUM ('COMPLAINT_MANAGER', 'PSYCHOLOGIST', 'SOCIAL_WORKER', 'EDUCATION', 'DISCIPLINE', 'STUDENT_AFFAIRS');

-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'SUPER_ADMIN';

-- AlterEnum
ALTER TYPE "ComplaintStatus" ADD VALUE 'ASSIGNED';

-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "complaints" ADD COLUMN     "assignedToAdminId" INTEGER;

-- CreateTable
CREATE TABLE "admin_responsibilities" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "responsibility" "Responsibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_responsibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_assignments" (
    "id" SERIAL NOT NULL,
    "complaintId" INTEGER NOT NULL,
    "fromAdminId" INTEGER,
    "toAdminId" INTEGER NOT NULL,
    "note" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_responsibilities_adminId_responsibility_key" ON "admin_responsibilities"("adminId", "responsibility");

-- CreateIndex
CREATE INDEX "complaints_assignedToAdminId_idx" ON "complaints"("assignedToAdminId");

-- AddForeignKey
ALTER TABLE "admin_responsibilities" ADD CONSTRAINT "admin_responsibilities_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_assignedToAdminId_fkey" FOREIGN KEY ("assignedToAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_assignments" ADD CONSTRAINT "complaint_assignments_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_assignments" ADD CONSTRAINT "complaint_assignments_fromAdminId_fkey" FOREIGN KEY ("fromAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_assignments" ADD CONSTRAINT "complaint_assignments_toAdminId_fkey" FOREIGN KEY ("toAdminId") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
