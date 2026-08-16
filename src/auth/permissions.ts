/**
 * Phase 1 Foundation + Phase 4 Hardening: Centralized authorization module.
 *
 * This module provides the canonical permission system for EduMuloqot.
 * All authorization checks should go through these functions rather than
 * scattering `if (user.role === ...)` checks throughout the codebase.
 *
 * Architecture:
 *   - UserRole enum defines all possible roles (from Prisma schema).
 *   - Permission enum defines all possible permissions.
 *   - ROLE_PERMISSIONS maps each role to its allowed permissions.
 *   - hasPermission() / requirePermission() are the main API.
 *   - School isolation is enforced separately via school-scoped queries.
 *
 * Security principles:
 *   1. Telegram callback data is UNTRUSTED. All authorization decisions
 *      must be based on the database-backed User/Admin record.
 *   2. Role checks are server-side only — hiding buttons is NOT sufficient.
 *   3. School isolation is enforced at the repository/query level, not
 *      just in the UI.
 *   4. Privilege escalation is impossible: a user cannot change their own
 *      role via any Telegram interaction.
 *
 * Phase 4 Hardening changes:
 *   - All permission functions now accept an optional `isActive` field on
 *     the user parameter. When `isActive === false` AND the user has a
 *     staff role, ALL staff permissions are revoked. Parent/student
 *     self-access permissions (VIEW_OWN_PROFILE, VIEW_OWN_DATA,
 *     VIEW_STUDENT for parents) are NOT affected — a deactivated staff
 *     member who still has parent/student data can still see their own
 *     profile and children.
 *   - `getEffectiveRole` consults BOTH `User.isActive` and `Admin.isActive`.
 *     If `User.isActive === false`, the effective role is downgraded to
 *     the user's "civilian" role (PARENT if they have family links,
 *     STUDENT otherwise, or PARENT as default). This prevents a
 *     deactivated staff member from inheriting privileges via the
 *     legacy Admin table.
 *   - New `requireActiveStaff()` helper for staff-only endpoints.
 *   - New `isUserActiveStaff()` predicate for finer-grained checks.
 */

import type { User, Admin } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────

/**
 * All permissions in the system. New permissions can be added here
 * without changing existing code — they simply won't be granted to any
 * role until explicitly added to ROLE_PERMISSIONS.
 */
export enum Permission {
  // Self-access
  VIEW_OWN_PROFILE = "VIEW_OWN_PROFILE",
  VIEW_OWN_DATA = "VIEW_OWN_DATA",

  // Student/parent data
  VIEW_STUDENT = "VIEW_STUDENT",
  VIEW_PARENT_DATA = "VIEW_PARENT_DATA",

  // Attendance (Phase 5)
  MANAGE_ATTENDANCE = "MANAGE_ATTENDANCE",       // record/edit attendance
  VIEW_OWN_ATTENDANCE = "VIEW_OWN_ATTENDANCE",   // student views own attendance
  VIEW_CLASS_ATTENDANCE = "VIEW_CLASS_ATTENDANCE",   // teacher/class_teacher views class
  VIEW_SCHOOL_ATTENDANCE = "VIEW_SCHOOL_ATTENDANCE", // school_admin
  VIEW_NEIGHBORHOOD_ATTENDANCE = "VIEW_NEIGHBORHOOD_ATTENDANCE", // mahalla
  VIEW_GLOBAL_ATTENDANCE = "VIEW_GLOBAL_ATTENDANCE", // admin/super_admin

  // Phase 8: Archive
  VIEW_ARCHIVE = "VIEW_ARCHIVE",           // view historical/archived data
  MANAGE_ARCHIVE = "MANAGE_ARCHIVE",       // perform archive/unarchive operations

  // School-scoped data
  VIEW_SCHOOL_DATA = "VIEW_SCHOOL_DATA",
  MANAGE_SCHOOL_DATA = "MANAGE_SCHOOL_DATA",

  // Staff management
  MANAGE_STAFF = "MANAGE_STAFF",
  MANAGE_USERS = "MANAGE_USERS",

  // System administration
  MANAGE_ROLES = "MANAGE_ROLES",
  MANAGE_SYSTEM = "MANAGE_SYSTEM",

  // Complaints (existing)
  VIEW_COMPLAINTS = "VIEW_COMPLAINTS",
  MANAGE_COMPLAINTS = "MANAGE_COMPLAINTS",
  REPLY_TO_COMPLAINTS = "REPLY_TO_COMPLAINTS",

  // Student verification (existing)
  APPROVE_STUDENTS = "APPROVE_STUDENTS",
}

/**
 * Role hierarchy level (higher = more privileged).
 * Used for hierarchical role comparisons.
 */
export const ROLE_LEVEL: Record<string, number> = {
  STUDENT: 1,
  PARENT: 1,
  TEACHER: 3,
  CLASS_TEACHER: 4,
  MAHALLA_RESPONSIBLE: 4,
  SCHOOL_ADMIN: 5,
  ADMIN: 8,
  SUPER_ADMIN: 10,
};

/**
 * Permission matrix: maps each role to its granted permissions.
 * A role automatically inherits permissions from lower levels via the
 * ROLE_LEVEL mapping — but explicit grants here are the source of truth.
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  STUDENT: [
    Permission.VIEW_OWN_PROFILE,
    Permission.VIEW_OWN_DATA,
    // Phase 5: a student may view their own attendance history.
    Permission.VIEW_OWN_ATTENDANCE,
  ],
  PARENT: [
    Permission.VIEW_OWN_PROFILE,
    Permission.VIEW_OWN_DATA,
    Permission.VIEW_STUDENT, // Can view their own children
    // Phase 5: a parent views their own children's attendance via the
    // family/student access path — this is gated by VIEW_STUDENT (own
    // children) at the service layer, NOT by VIEW_CLASS_ATTENDANCE.
    // Parents do NOT receive VIEW_CLASS_ATTENDANCE — that is a staff
    // permission.
  ],
  TEACHER: [
    Permission.VIEW_OWN_PROFILE,
    Permission.VIEW_OWN_DATA,
    Permission.VIEW_STUDENT,
    Permission.VIEW_CLASS_ATTENDANCE,
    Permission.MANAGE_ATTENDANCE,
  ],
  CLASS_TEACHER: [
    Permission.VIEW_OWN_PROFILE,
    Permission.VIEW_OWN_DATA,
    Permission.VIEW_STUDENT,
    Permission.VIEW_PARENT_DATA,
    Permission.VIEW_CLASS_ATTENDANCE,
    Permission.MANAGE_ATTENDANCE,
  ],
  MAHALLA_RESPONSIBLE: [
    Permission.VIEW_OWN_PROFILE,
    Permission.VIEW_OWN_DATA,
    Permission.VIEW_SCHOOL_DATA,
    // Phase 5: mahalla responsible can view attendance scoped to their
    // neighborhood (used for escalation visibility). They CANNOT record
    // or edit attendance.
    Permission.VIEW_NEIGHBORHOOD_ATTENDANCE,
  ],
  SCHOOL_ADMIN: [
    Permission.VIEW_OWN_PROFILE,
    Permission.VIEW_OWN_DATA,
    Permission.VIEW_STUDENT,
    Permission.VIEW_PARENT_DATA,
    Permission.VIEW_SCHOOL_DATA,
    Permission.MANAGE_SCHOOL_DATA,
    Permission.VIEW_COMPLAINTS,
    Permission.MANAGE_COMPLAINTS,
    Permission.REPLY_TO_COMPLAINTS,
    Permission.APPROVE_STUDENTS,
    Permission.MANAGE_STAFF,
    // Phase 5: school admin can view (but not record) school attendance.
    Permission.VIEW_SCHOOL_ATTENDANCE,
    // Phase 8: school admin can view archive for their own school
    Permission.VIEW_ARCHIVE,
  ],
  ADMIN: [
    Permission.VIEW_OWN_PROFILE,
    Permission.VIEW_OWN_DATA,
    Permission.VIEW_STUDENT,
    Permission.VIEW_PARENT_DATA,
    Permission.VIEW_SCHOOL_DATA,
    Permission.MANAGE_SCHOOL_DATA,
    Permission.VIEW_COMPLAINTS,
    Permission.MANAGE_COMPLAINTS,
    Permission.REPLY_TO_COMPLAINTS,
    Permission.APPROVE_STUDENTS,
    Permission.MANAGE_STAFF,
    Permission.MANAGE_USERS,
    // Phase 5: admin has global attendance visibility.
    Permission.VIEW_GLOBAL_ATTENDANCE,
    Permission.VIEW_SCHOOL_ATTENDANCE,
    Permission.VIEW_NEIGHBORHOOD_ATTENDANCE,
    Permission.VIEW_CLASS_ATTENDANCE,
    // Phase 8: admin can view + manage archive globally
    Permission.VIEW_ARCHIVE,
    Permission.MANAGE_ARCHIVE,
  ],
  SUPER_ADMIN: [
    // SuperAdmin has ALL permissions
    ...Object.values(Permission),
  ],
};

/**
 * Self-access permissions that are NOT revoked when a staff member is
 * deactivated. A deactivated TEACHER can still see their own profile,
 * their own data, and (if they have children) their own children —
 * they just can't perform staff operations. This matches the Phase 4
 * requirement: "Do not delete the user. Do not change their role when
 * deactivating. Existing family/student relationships must remain
 * untouched."
 */
const DEACTIVATION_PRESERVED_PERMISSIONS = new Set<Permission>([
  Permission.VIEW_OWN_PROFILE,
  Permission.VIEW_OWN_DATA,
  Permission.VIEW_STUDENT, // parent-level: view own children
  // Phase 5: a deactivated user who is also a student (rare but possible)
  // can still view their own attendance history. This does NOT include
  // VIEW_CLASS_ATTENDANCE / VIEW_SCHOOL_ATTENDANCE / etc. — those are
  // staff permissions and are revoked on deactivation.
  Permission.VIEW_OWN_ATTENDANCE,
]);

/**
 * Permissions considered "staff" permissions — these are revoked when
 * a staff user is deactivated. Anything NOT in DEACTIVATION_PRESERVED
 * is treated as a staff permission for this purpose.
 */
function isStaffPermission(perm: Permission): boolean {
  return !DEACTIVATION_PRESERVED_PERMISSIONS.has(perm);
}

// ─── Effective role resolution ────────────────────────────────────────

/**
 * Resolve the effective role for a user, considering both the User.role
 * field, User.isActive, the legacy Admin table, and Admin.isActive.
 *
 * Rules (Phase 4 Hardening):
 *   1. If `user.isActive === false`, the user is a deactivated staff
 *      member. Their effective role is downgraded to PARENT (the
 *      "civilian" default) — they retain only self-access permissions
 *      (VIEW_OWN_PROFILE, VIEW_OWN_DATA, VIEW_STUDENT for their own
 *      children). The Admin record is IGNORED in this case, so a
 *      deactivated staff member cannot bypass deactivation via a
 *      still-active Admin record.
 *   2. If the user is active AND has an active Admin record, the
 *      effective role is the higher-privilege of User.role and the
 *      (mapped) Admin role. This preserves backward compatibility:
 *      existing admins in the Admin table retain their privileges even
 *      if their User.role hasn't been migrated yet.
 *   3. If the user is active and has no Admin record (or an inactive
 *      Admin record), the effective role is User.role.
 *
 * The AdminRole enum has values {SUPER_ADMIN, SCHOOL_ADMIN,
 * NEIGHBORHOOD_ADMIN} — these map to UserRole values as follows:
 *   SUPER_ADMIN         → SUPER_ADMIN
 *   SCHOOL_ADMIN        → SCHOOL_ADMIN
 *   NEIGHBORHOOD_ADMIN  → MAHALLA_RESPONSIBLE
 *
 * @param user The User record (must include role and isActive)
 * @param admin Optional Admin record (if the user is also an admin)
 * @returns The effective role string
 */
export function getEffectiveRole(
  user: { role: string; isActive?: boolean },
  admin?: { role: string; isActive: boolean } | null
): string {
  // Phase 4 Hardening: deactivated staff lose all staff privileges.
  // The user is NOT deleted — they retain their role field for audit
  // purposes — but the EFFECTIVE role for permission decisions is
  // downgraded to PARENT (the civilian default). This means a
  // deactivated TEACHER with parent data can still see their own
  // children, but cannot manage attendance, etc.
  if (user.isActive === false) {
    return "PARENT";
  }

  // If no admin record, use User.role
  if (!admin || !admin.isActive) {
    return user.role;
  }

  // Map AdminRole to UserRole for comparison
  const adminRoleMap: Record<string, string> = {
    SUPER_ADMIN: "SUPER_ADMIN",
    SCHOOL_ADMIN: "SCHOOL_ADMIN",
    NEIGHBORHOOD_ADMIN: "MAHALLA_RESPONSIBLE",
  };
  const mappedAdminRole = adminRoleMap[admin.role] || admin.role;

  // Return whichever role has higher privilege
  const userLevel = ROLE_LEVEL[user.role] || 0;
  const adminLevel = ROLE_LEVEL[mappedAdminRole] || 0;

  return adminLevel > userLevel ? mappedAdminRole : user.role;
}

// ─── Permission checks ────────────────────────────────────────────────

/**
 * Check if a role has a specific permission.
 */
export function roleHasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes(permission);
}

/**
 * Check if a user (with optional admin record) has a specific permission.
 *
 * Phase 4 Hardening: if `user.isActive === false` AND the permission is
 * a staff permission (anything beyond self-access), the check fails.
 * Self-access permissions (VIEW_OWN_PROFILE, VIEW_OWN_DATA, VIEW_STUDENT
 * for own children) are always allowed for the user themselves regardless
 * of deactivation — a deactivated TEACHER can still see their own profile
 * and (if they have children) their own children.
 */
export function hasPermission(
  user: { role: string; isActive?: boolean },
  permission: Permission,
  admin?: { role: string; isActive: boolean } | null
): boolean {
  // Phase 4 Hardening: deactivated staff lose staff permissions.
  if (user.isActive === false && isStaffPermission(permission)) {
    return false;
  }

  const effectiveRole = getEffectiveRole(user, admin);
  return roleHasPermission(effectiveRole, permission);
}

/**
 * Require a specific permission. Throws if the user doesn't have it.
 */
export function requirePermission(
  user: { role: string; isActive?: boolean },
  permission: Permission,
  admin?: { role: string; isActive: boolean } | null
): void {
  if (!hasPermission(user, permission, admin)) {
    throw new PermissionError(`Required permission: ${permission}`);
  }
}

/**
 * Check if a role meets or exceeds the specified minimum role level.
 */
export function hasRoleLevel(role: string, minLevel: number): boolean {
  return (ROLE_LEVEL[role] || 0) >= minLevel;
}

/**
 * Check if the effective role (considering admin record) meets or
 * exceeds the specified minimum role level.
 */
export function hasEffectiveRoleLevel(
  user: { role: string; isActive?: boolean },
  minLevel: number,
  admin?: { role: string; isActive: boolean } | null
): boolean {
  const effectiveRole = getEffectiveRole(user, admin);
  return hasRoleLevel(effectiveRole, minLevel);
}

/**
 * Check if a role is a staff role (not STUDENT/PARENT).
 */
export function isStaffRole(role: string): boolean {
  return !["STUDENT", "PARENT"].includes(role);
}

/**
 * Phase 4 Hardening: check if a user is currently an ACTIVE staff member.
 *
 * Returns true iff:
 *   - User.isActive is true (not false)
 *   - The user's effective role (combining User.role and any active
 *     Admin record) is a staff role.
 *
 * Use this to gate staff-only endpoints. A deactivated TEACHER, a
 * parent, or a student all return false.
 */
export function isUserActiveStaff(
  user: { role: string; isActive?: boolean },
  admin?: { role: string; isActive: boolean } | null
): boolean {
  if (user.isActive === false) return false;
  const effectiveRole = getEffectiveRole(user, admin);
  return isStaffRole(effectiveRole);
}

/**
 * Phase 4 Hardening: require that the user is an active staff member.
 * Throws PermissionError otherwise. Use this as the central gate for
 * staff-only operations (attendance, staff management, etc.).
 */
export function requireActiveStaff(
  user: { role: string; isActive?: boolean },
  admin?: { role: string; isActive: boolean } | null
): void {
  if (!isUserActiveStaff(user, admin)) {
    throw new PermissionError("Faol xodim sifatida tizimga kirishingiz kerak.");
  }
}

/**
 * Check if a user can manage other users (assign roles, provision staff).
 */
export function canManageUsers(
  user: { role: string; isActive?: boolean },
  admin?: { role: string; isActive: boolean } | null
): boolean {
  return hasPermission(user, Permission.MANAGE_USERS, admin);
}

/**
 * Check if a user is a super admin.
 */
export function isSuperAdmin(
  user: { role: string; isActive?: boolean },
  admin?: { role: string; isActive: boolean } | null
): boolean {
  const effectiveRole = getEffectiveRole(user, admin);
  return effectiveRole === "SUPER_ADMIN";
}

// ─── School isolation ─────────────────────────────────────────────────

/**
 * Verify that a user has access to a specific school.
 *
 * SUPER_ADMIN and ADMIN have global access (no school restriction).
 * All other roles are restricted to their own school (user.schoolId).
 *
 * Phase 4 Hardening: if the user is inactive (deactivated staff), they
 * have NO school access for staff operations — they're treated as a
 * civilian PARENT, and a parent's school access is their own
 * (user.schoolId). The function still works correctly because a
 * deactivated staff member's effective role is PARENT (via
 * getEffectiveRole), so the global-access branch is not taken.
 *
 * @param user The user record (must include schoolId, role, isActive)
 * @param targetSchoolId The school being accessed
 * @param admin Optional admin record
 * @returns true if access is allowed
 */
export function canAccessSchool(
  user: { schoolId: number | null; role: string; isActive?: boolean },
  targetSchoolId: number,
  admin?: { schoolId: number | null; role: string; isActive: boolean } | null
): boolean {
  const effectiveRole = getEffectiveRole(user, admin);

  // SUPER_ADMIN and ADMIN have global access
  if (effectiveRole === "SUPER_ADMIN" || effectiveRole === "ADMIN") {
    return true;
  }

  // All other roles are restricted to their own school.
  // Check both User.schoolId and Admin.schoolId — but only the active
  // admin's schoolId is authoritative (an inactive admin's schoolId
  // is ignored because getEffectiveRole already downgraded the role
  // to PARENT in that case).
  const userSchoolId = user.schoolId;
  const adminSchoolId = admin?.isActive ? admin.schoolId : null;
  const effectiveSchoolId = adminSchoolId ?? userSchoolId;

  return effectiveSchoolId === targetSchoolId;
}

/**
 * Require school access. Throws if denied.
 */
export function requireSchoolAccess(
  user: { schoolId: number | null; role: string; isActive?: boolean },
  targetSchoolId: number,
  admin?: { schoolId: number | null; role: string; isActive: boolean } | null
): void {
  if (!canAccessSchool(user, targetSchoolId, admin)) {
    throw new PermissionError(`Access denied to school ${targetSchoolId}`);
  }
}

// ─── Self-registration role validation ────────────────────────────────

/**
 * Roles that users can self-select during registration.
 * Staff/system roles MUST NOT be in this list.
 */
export const SELF_REGISTRABLE_ROLES: string[] = ["STUDENT", "PARENT"];

/**
 * Check if a role can be self-selected by a user.
 * Staff roles (TEACHER, CLASS_TEACHER, SCHOOL_ADMIN, etc.) are NOT
 * self-selectable — they must be provisioned by an authorized admin.
 */
export function isSelfRegistrableRole(role: string): boolean {
  return SELF_REGISTRABLE_ROLES.includes(role);
}

/**
 * Validate that a role cannot be obtained through user input.
 * This is the defense against privilege escalation: even if a malicious
 * user crafts a callback with role=ADMIN, the system will reject it.
 */
export function assertNotPrivilegeEscalation(role: string): void {
  if (!isSelfRegistrableRole(role)) {
    throw new PermissionError(`Role '${role}' cannot be self-selected. Privilege escalation attempt blocked.`);
  }
}

// ─── Error class ──────────────────────────────────────────────────────

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}
