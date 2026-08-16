-- CreateEnum
CREATE TYPE "StudentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "verificationStatus" "StudentVerificationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;
