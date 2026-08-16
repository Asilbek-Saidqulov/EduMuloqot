-- Migration: phase2_parent_role
--
-- Phase 2: add ParentRole enum and parentRole column to users table.
--
-- This adds the parent-specific family role (FATHER/MOTHER) as a separate
-- nullable column, keeping the canonical UserRole (PARENT) as the
-- authorization role. Non-parent users have parentRole = NULL.
--
-- Legacy data preservation:
--   - Existing User records get parentRole = NULL (the default).
--   - No existing data is modified or deleted.

CREATE TYPE "ParentRole" AS ENUM ('FATHER', 'MOTHER');

ALTER TABLE "users" ADD COLUMN "parentRole" "ParentRole";
