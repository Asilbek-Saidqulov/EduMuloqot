-- Migration: foundation_role_permissions
--
-- Phase 1 Foundation: add UserRole enum and role column to users table.
--
-- This establishes the canonical role model for the unified identity
-- architecture. The existing Admin table (AdminRole enum) is preserved
-- for backward compatibility — the new User.role field is the canonical
-- role for future phases, while the Admin table continues to serve
-- existing admin operations.
--
-- Legacy data preservation:
--   - Existing User records get role = 'PARENT' (the default).
--   - No existing data is modified or deleted.
--   - The Admin table and its AdminRole enum are untouched.

-- 1. Create UserRole enum type
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'PARENT', 'TEACHER', 'CLASS_TEACHER', 'SCHOOL_ADMIN', 'MAHALLA_RESPONSIBLE', 'ADMIN', 'SUPER_ADMIN');

-- 2. Add role column to users table with default 'PARENT'
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'PARENT';
