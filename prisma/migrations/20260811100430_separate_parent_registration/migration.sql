-- AlterTable
ALTER TABLE "users" ADD COLUMN     "neighborhoodId" INTEGER,
ADD COLUMN     "schoolId" INTEGER;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_neighborhoodId_fkey" FOREIGN KEY ("neighborhoodId") REFERENCES "neighborhoods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
