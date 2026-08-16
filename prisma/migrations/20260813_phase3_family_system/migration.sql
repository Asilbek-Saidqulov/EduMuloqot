-- Migration: phase3_family_system
--
-- Phase 3: introduces the Family system.
--
-- New tables:
--   families — top-level family entity
--   family_members — links parents (User) to a Family with FATHER/MOTHER role
--   family_students — links students to a Family (many children per family)
--   family_invitations — secure single-use tokens for second parent to join
--
-- Legacy data: no existing data is modified. Student.parentId is preserved.
-- Existing claimed students will be linked to families via the child-claim
-- integration (when a parent claims a child, the child is also linked to
-- the parent's family). Legacy students without a family link continue to
-- work via the old Student.parentId relationship.

-- 1. Create families table
CREATE TABLE "families" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- 2. Create family_members table
CREATE TABLE "family_members" (
    "id" SERIAL NOT NULL,
    "familyId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "parentRole" "ParentRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- One active family membership per user
CREATE UNIQUE INDEX "family_members_userId_key" ON "family_members"("userId");
-- One father, one mother per family
CREATE UNIQUE INDEX "family_members_familyId_parentRole_key" ON "family_members"("familyId", "parentRole");

ALTER TABLE "family_members" ADD CONSTRAINT "family_members_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Create family_students table
CREATE TABLE "family_students" (
    "id" SERIAL NOT NULL,
    "familyId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "family_students_pkey" PRIMARY KEY ("id")
);

-- A student belongs to at most one family
CREATE UNIQUE INDEX "family_students_studentId_key" ON "family_students"("studentId");
-- No duplicate family-student pairs
CREATE UNIQUE INDEX "family_students_familyId_studentId_key" ON "family_students"("familyId", "studentId");

ALTER TABLE "family_students" ADD CONSTRAINT "family_students_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_students" ADD CONSTRAINT "family_students_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Create family_invitations table
CREATE TABLE "family_invitations" (
    "id" SERIAL NOT NULL,
    "familyId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "family_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "family_invitations_tokenHash_key" ON "family_invitations"("tokenHash");
CREATE INDEX "family_invitations_familyId_idx" ON "family_invitations"("familyId");

ALTER TABLE "family_invitations" ADD CONSTRAINT "family_invitations_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
