-- CreateTable
CREATE TABLE "admin_action_logs" (
    "id" SERIAL NOT NULL,
    "actorAdminId" INTEGER NOT NULL,
    "targetAdminId" INTEGER,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_action_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_targetAdminId_fkey" FOREIGN KEY ("targetAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
