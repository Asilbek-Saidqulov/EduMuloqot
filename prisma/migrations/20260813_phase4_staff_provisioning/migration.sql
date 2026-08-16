-- Migration: phase4_staff_provisioning
--
-- Phase 4: adds isActive field to users table and creates staff_action_logs
-- table for audit trail of staff provisioning actions.
--
-- Legacy data: all existing users get isActive = true (the default).
-- No existing data is modified or deleted.

-- 1. Add isActive column to users table
ALTER TABLE "users" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- 2. Create staff_action_logs table
CREATE TABLE "staff_action_logs" (
    "id" SERIAL NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "oldRole" TEXT,
    "newRole" TEXT,
    "schoolId" INTEGER,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_action_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_action_logs_targetUserId_idx" ON "staff_action_logs"("targetUserId");
CREATE INDEX "staff_action_logs_actorUserId_idx" ON "staff_action_logs"("actorUserId");
