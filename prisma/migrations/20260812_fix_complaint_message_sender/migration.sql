-- Migration: fix_complaint_message_sender
--
-- Root cause: ComplaintMessage.senderId was a non-nullable FK to users.id.
-- The adminReply conversation obtained a User.id for the admin via
-- userRepo.findOrCreateByTelegramId(adminTelegramId), which either:
--   (a) collided with an existing parent's User row (same Telegram ID), or
--   (b) created a fake User row for the admin.
-- In both cases the admin's reply was stored as if sent by a User, making
-- it impossible to distinguish parent messages from admin replies and
-- risking identity collision.
--
-- Fix: model the sender as a discriminated union.
--   - senderType PARENT  -> senderId (User.id) set, senderAdminId null
--   - senderType ADMIN   -> senderAdminId (Admin.id) set, senderId null
--
-- Backward compatibility:
--   - Existing rows have senderId set (to a User.id) and no senderType.
--     The ALTER adds senderType with DEFAULT 'PARENT', so all existing
--     rows are treated as parent messages. This is correct for genuine
--     parent messages. For rows that were actually admin replies stored
--     via the old buggy flow, senderId points to either a parent's User.id
--     (collision) or a fake User row. These rows remain as they were —
--     we do NOT delete or rewrite them. Going forward, NEW admin replies
--     use senderType=ADMIN with senderAdminId.
--   - senderId is now nullable (was NOT NULL). Existing rows keep their
--     value; only future admin-reply rows will have senderId=null.
--   - No data is lost. The CHECK constraint allows the PARENT rows
--     (senderId set, senderAdminId null) that already exist.

-- 1. Add senderType enum type.
CREATE TYPE "ComplaintMessageSenderType" AS ENUM ('PARENT', 'ADMIN');

-- 2. Add senderType column with default 'PARENT' so existing rows are
--    treated as parent messages.
ALTER TABLE "complaint_messages" ADD COLUMN "senderType" "ComplaintMessageSenderType" NOT NULL DEFAULT 'PARENT';

-- 3. Add senderAdminId column (nullable, FK to admins.id) for admin replies.
ALTER TABLE "complaint_messages" ADD COLUMN "senderAdminId" INTEGER;

-- 4. Make senderId nullable (was NOT NULL) so admin-reply rows can have
--    senderId = null.
ALTER TABLE "complaint_messages" ALTER COLUMN "senderId" DROP NOT NULL;

-- 5. Add FK for senderAdminId -> admins.id.
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_senderAdminId_fkey" FOREIGN KEY ("senderAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Add CHECK constraint: exactly one sender must be set, matching senderType.
--    - PARENT  => senderId IS NOT NULL AND senderAdminId IS NULL
--    - ADMIN   => senderId IS NULL     AND senderAdminId IS NOT NULL
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_sender_check" CHECK (
  ("senderType" = 'PARENT' AND "senderId" IS NOT NULL AND "senderAdminId" IS NULL)
  OR
  ("senderType" = 'ADMIN'  AND "senderId" IS NULL     AND "senderAdminId" IS NOT NULL)
);

-- 7. Index senderAdminId for efficient "all messages from this admin" queries.
CREATE INDEX "complaint_messages_senderAdminId_idx" ON "complaint_messages"("senderAdminId");
