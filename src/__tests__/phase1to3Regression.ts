/**
 * Phase 1-3 Regression Tests
 *
 * Verifies that the Phase 4 Hardening changes (adding User.isActive
 * checks, refactoring getEffectiveRole, adding staffSyncService) did
 * NOT break Phase 1-3 functionality:
 *
 *   - Phase 1: Permission matrix, role hierarchy, school isolation
 *   - Phase 2: Self-registration role validation, parent/student
 *     role checks
 *   - Phase 3: Family system permissions (parents can view own
 *     children, students cannot, etc.)
 *
 * These tests are PURE LOGIC (no database required) so they always
 * run as part of the test suite.
 *
 * Run with: npx tsx src/__tests__/phase1to3Regression.ts
 */

import {
  Permission,
  ROLE_LEVEL,
  ROLE_PERMISSIONS,
  getEffectiveRole,
  hasPermission,
  canAccessSchool,
  isStaffRole,
  isSelfRegistrableRole,
  assertNotPrivilegeEscalation,
  SELF_REGISTRABLE_ROLES,
  PermissionError,
} from "../auth/permissions";

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  if (cond) pass++; else fail++;
}

function run() {
  console.log("══════════════════════════════════════════");
  console.log("  Phase 1-3 Regression Tests");
  console.log("══════════════════════════════════════════\n");

  // ─── Phase 1: Permission matrix ──────────────────────────────────
  console.log("=== Phase 1: Permission matrix ===");
  {
    check("PARENT has VIEW_OWN_PROFILE",
      ROLE_PERMISSIONS["PARENT"].includes(Permission.VIEW_OWN_PROFILE));
    check("PARENT has VIEW_OWN_DATA",
      ROLE_PERMISSIONS["PARENT"].includes(Permission.VIEW_OWN_DATA));
    check("PARENT has VIEW_STUDENT (for own children)",
      ROLE_PERMISSIONS["PARENT"].includes(Permission.VIEW_STUDENT));
    check("PARENT does NOT have MANAGE_STAFF",
      !ROLE_PERMISSIONS["PARENT"].includes(Permission.MANAGE_STAFF));
    check("STUDENT has VIEW_OWN_PROFILE",
      ROLE_PERMISSIONS["STUDENT"].includes(Permission.VIEW_OWN_PROFILE));
    check("STUDENT does NOT have VIEW_STUDENT",
      !ROLE_PERMISSIONS["STUDENT"].includes(Permission.VIEW_STUDENT));

    // Role hierarchy preserved
    check("STUDENT level == PARENT level (1)",
      ROLE_LEVEL["STUDENT"] === ROLE_LEVEL["PARENT"]);
    check("TEACHER > PARENT",
      ROLE_LEVEL["TEACHER"] > ROLE_LEVEL["PARENT"]);
    check("CLASS_TEACHER > TEACHER",
      ROLE_LEVEL["CLASS_TEACHER"] > ROLE_LEVEL["TEACHER"]);
    check("SCHOOL_ADMIN > CLASS_TEACHER",
      ROLE_LEVEL["SCHOOL_ADMIN"] > ROLE_LEVEL["CLASS_TEACHER"]);
    check("ADMIN > SCHOOL_ADMIN",
      ROLE_LEVEL["ADMIN"] > ROLE_LEVEL["SCHOOL_ADMIN"]);
    check("SUPER_ADMIN > ADMIN",
      ROLE_LEVEL["SUPER_ADMIN"] > ROLE_LEVEL["ADMIN"]);
    check("MAHALLA_RESPONSIBLE == CLASS_TEACHER level (4)",
      ROLE_LEVEL["MAHALLA_RESPONSIBLE"] === ROLE_LEVEL["CLASS_TEACHER"]);
  }

  // ─── Phase 1: Backward-compat effective role resolution ──────────
  console.log("\n=== Phase 1: Effective role (legacy Admin compat) ===");
  {
    // A PARENT User with active SUPER_ADMIN Admin → SUPER_ADMIN (legacy works)
    check("PARENT + active SUPER_ADMIN Admin → SUPER_ADMIN",
      getEffectiveRole(
        { role: "PARENT", isActive: true },
        { role: "SUPER_ADMIN", isActive: true }
      ) === "SUPER_ADMIN");

    // A PARENT User with NO Admin → PARENT
    check("PARENT + no Admin → PARENT",
      getEffectiveRole({ role: "PARENT", isActive: true }) === "PARENT");

    // NEIGHBORHOOD_ADMIN (legacy) maps to MAHALLA_RESPONSIBLE
    check("NEIGHBORHOOD_ADMIN Admin → MAHALLA_RESPONSIBLE effective",
      getEffectiveRole(
        { role: "PARENT", isActive: true },
        { role: "NEIGHBORHOOD_ADMIN", isActive: true }
      ) === "MAHALLA_RESPONSIBLE");
  }

  // ─── Phase 1: School isolation ───────────────────────────────────
  console.log("\n=== Phase 1: School isolation ===");
  {
    const schoolA = 1, schoolB = 2;
    check("SCHOOL_ADMIN can access own school",
      canAccessSchool({ schoolId: schoolA, role: "SCHOOL_ADMIN", isActive: true }, schoolA));
    check("SCHOOL_ADMIN cannot access other school",
      !canAccessSchool({ schoolId: schoolA, role: "SCHOOL_ADMIN", isActive: true }, schoolB));
    check("SUPER_ADMIN can access any school",
      canAccessSchool({ schoolId: null, role: "SUPER_ADMIN", isActive: true }, schoolA) &&
      canAccessSchool({ schoolId: null, role: "SUPER_ADMIN", isActive: true }, schoolB));
    check("PARENT can access own school (for own children)",
      canAccessSchool({ schoolId: schoolA, role: "PARENT", isActive: true }, schoolA));
    check("PARENT cannot access other school",
      !canAccessSchool({ schoolId: schoolA, role: "PARENT", isActive: true }, schoolB));
  }

  // ─── Phase 2: Self-registration role validation ──────────────────
  console.log("\n=== Phase 2: Self-registration validation ===");
  {
    check("STUDENT is self-registrable",
      isSelfRegistrableRole("STUDENT"));
    check("PARENT is self-registrable",
      isSelfRegistrableRole("PARENT"));
    check("TEACHER is NOT self-registrable",
      !isSelfRegistrableRole("TEACHER"));
    check("SCHOOL_ADMIN is NOT self-registrable",
      !isSelfRegistrableRole("SCHOOL_ADMIN"));
    check("ADMIN is NOT self-registrable",
      !isSelfRegistrableRole("ADMIN"));
    check("SUPER_ADMIN is NOT self-registrable",
      !isSelfRegistrableRole("SUPER_ADMIN"));
    check("SELF_REGISTRABLE_ROLES has exactly STUDENT and PARENT",
      SELF_REGISTRABLE_ROLES.length === 2 &&
      SELF_REGISTRABLE_ROLES.includes("STUDENT") &&
      SELF_REGISTRABLE_ROLES.includes("PARENT"));

    // assertNotPrivilegeEscalation throws for staff roles
    let threwForAdmin = false;
    try { assertNotPrivilegeEscalation("ADMIN"); } catch { threwForAdmin = true; }
    check("assertNotPrivilegeEscalation throws for ADMIN", threwForAdmin);

    let threwForSuperAdmin = false;
    try { assertNotPrivilegeEscalation("SUPER_ADMIN"); } catch { threwForSuperAdmin = true; }
    check("assertNotPrivilegeEscalation throws for SUPER_ADMIN", threwForSuperAdmin);

    // Does NOT throw for self-registrable
    let threwForParent = false;
    try { assertNotPrivilegeEscalation("PARENT"); } catch { threwForParent = true; }
    check("assertNotPrivilegeEscalation does NOT throw for PARENT", !threwForParent);

    let threwForStudent = false;
    try { assertNotPrivilegeEscalation("STUDENT"); } catch { threwForStudent = true; }
    check("assertNotPrivilegeEscalation does NOT throw for STUDENT", !threwForStudent);
  }

  // ─── Phase 2: isStaffRole ────────────────────────────────────────
  console.log("\n=== Phase 2: isStaffRole ===");
  {
    check("PARENT is not staff", !isStaffRole("PARENT"));
    check("STUDENT is not staff", !isStaffRole("STUDENT"));
    check("TEACHER is staff", isStaffRole("TEACHER"));
    check("CLASS_TEACHER is staff", isStaffRole("CLASS_TEACHER"));
    check("SCHOOL_ADMIN is staff", isStaffRole("SCHOOL_ADMIN"));
    check("ADMIN is staff", isStaffRole("ADMIN"));
    check("SUPER_ADMIN is staff", isStaffRole("SUPER_ADMIN"));
    check("MAHALLA_RESPONSIBLE is staff", isStaffRole("MAHALLA_RESPONSIBLE"));
  }

  // ─── Phase 3: Family system permission implications ──────────────
  console.log("\n=== Phase 3: Family system permissions ===");
  {
    // A PARENT can view their own children (VIEW_STUDENT for parent).
    const parent = { role: "PARENT", isActive: true };
    check("PARENT can VIEW_STUDENT (own children)",
      hasPermission(parent, Permission.VIEW_STUDENT));
    // A STUDENT cannot VIEW_STUDENT (they don't have children).
    const student = { role: "STUDENT", isActive: true };
    check("STUDENT cannot VIEW_STUDENT",
      !hasPermission(student, Permission.VIEW_STUDENT));
    // A deactivated PARENT (edge case) still has VIEW_STUDENT for own children.
    const inactiveParent = { role: "PARENT", isActive: false };
    check("Inactive PARENT can VIEW_STUDENT (own children preserved)",
      hasPermission(inactiveParent, Permission.VIEW_STUDENT));
  }

  // ─── Phase 4 Hardening: legacy Admin compat still works ──────────
  console.log("\n=== Phase 4 Hardening: legacy Admin compat (regression) ===");
  {
    // A legacy Admin (no User record) — represented as User=PARENT + Admin=X.
    // The effective role should be the higher of the two.
    const user = { role: "PARENT", isActive: true };
    const adminSA = { role: "SCHOOL_ADMIN", isActive: true };
    check("Legacy SCHOOL_ADMIN Admin still works (effective=SCHOOL_ADMIN)",
      getEffectiveRole(user, adminSA) === "SCHOOL_ADMIN");

    // If the Admin is inactive, fall back to User.role.
    const adminInactive = { role: "SCHOOL_ADMIN", isActive: false };
    check("Inactive Admin falls back to User.role (PARENT)",
      getEffectiveRole(user, adminInactive) === "PARENT");

    // A SUPER_ADMIN bootstrap Admin record.
    const adminSuper = { role: "SUPER_ADMIN", isActive: true };
    check("Legacy SUPER_ADMIN Admin still works",
      getEffectiveRole(user, adminSuper) === "SUPER_ADMIN");
    check("Legacy SUPER_ADMIN Admin grants MANAGE_SYSTEM",
      hasPermission(user, Permission.MANAGE_SYSTEM, adminSuper));
  }
}

run();

console.log(`\n══════════════════════════════════════════`);
console.log(`  Total: ${pass} passed, ${fail} failed`);
console.log(`══════════════════════════════════════════`);

if (fail > 0) process.exit(1);
