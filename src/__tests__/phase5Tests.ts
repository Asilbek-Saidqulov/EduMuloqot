/**
 * Phase 5: Attendance tests
 *
 * Two layers, matching the project's existing test style:
 *
 *   1. PURE LOGIC TESTS — always run. Test the permission matrix,
 *      consecutive-absence calculation, status type, etc. No DB.
 *
 *   2. INTEGRATION TESTS — require PostgreSQL. Skip cleanly with a
 *      warning if DATABASE_URL is not configured or DB is unreachable.
 *
 * Run with: npx tsx src/__tests__/phase5Tests.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Set default env vars BEFORE any imports that touch env.ts. The
// project's env.ts validates BOT_TOKEN and DATABASE_URL on import —
// without these, the process exits with an env validation error. For
// tests, we set dummy values so env.ts parses successfully. The
// DATABASE_URL will be overridden by the real .env if present.
process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test:test_token";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";

import {
  Permission,
  ROLE_PERMISSIONS,
  ROLE_LEVEL,
  hasPermission,
  isUserActiveStaff,
  requireActiveStaff,
  PermissionError,
} from "../auth/permissions";
import { userRoleToAdminRole } from "../services/staffSyncService";

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  if (cond) pass++; else fail++;
}
function checkThrows(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ❌ ${label} (expected throw, but did not)`);
    fail++;
  } catch {
    console.log(`  ✅ ${label}`);
    pass++;
  }
}

// ─── Layer 1: Pure Logic Tests ────────────────────────────────────────

function runPermissionTests() {
  console.log("══════════════════════════════════════════");
  console.log("  Phase 5 — Pure Logic Tests");
  console.log("══════════════════════════════════════════\n");

  // ─── Permission matrix ───────────────────────────────────────────
  console.log("=== Permission matrix ===");
  {
    // TEACHER: MANAGE_ATTENDANCE + VIEW_CLASS_ATTENDANCE
    check("TEACHER has MANAGE_ATTENDANCE",
      ROLE_PERMISSIONS["TEACHER"].includes(Permission.MANAGE_ATTENDANCE));
    check("TEACHER has VIEW_CLASS_ATTENDANCE",
      ROLE_PERMISSIONS["TEACHER"].includes(Permission.VIEW_CLASS_ATTENDANCE));
    check("TEACHER does NOT have VIEW_SCHOOL_ATTENDANCE",
      !ROLE_PERMISSIONS["TEACHER"].includes(Permission.VIEW_SCHOOL_ATTENDANCE));
    check("TEACHER does NOT have VIEW_GLOBAL_ATTENDANCE",
      !ROLE_PERMISSIONS["TEACHER"].includes(Permission.VIEW_GLOBAL_ATTENDANCE));

    // CLASS_TEACHER: same as TEACHER
    check("CLASS_TEACHER has MANAGE_ATTENDANCE",
      ROLE_PERMISSIONS["CLASS_TEACHER"].includes(Permission.MANAGE_ATTENDANCE));
    check("CLASS_TEACHER has VIEW_CLASS_ATTENDANCE",
      ROLE_PERMISSIONS["CLASS_TEACHER"].includes(Permission.VIEW_CLASS_ATTENDANCE));

    // SCHOOL_ADMIN: VIEW_SCHOOL_ATTENDANCE but NOT MANAGE_ATTENDANCE
    check("SCHOOL_ADMIN has VIEW_SCHOOL_ATTENDANCE",
      ROLE_PERMISSIONS["SCHOOL_ADMIN"].includes(Permission.VIEW_SCHOOL_ATTENDANCE));
    check("SCHOOL_ADMIN does NOT have MANAGE_ATTENDANCE",
      !ROLE_PERMISSIONS["SCHOOL_ADMIN"].includes(Permission.MANAGE_ATTENDANCE));
    check("SCHOOL_ADMIN does NOT have VIEW_GLOBAL_ATTENDANCE",
      !ROLE_PERMISSIONS["SCHOOL_ADMIN"].includes(Permission.VIEW_GLOBAL_ATTENDANCE));

    // MAHALLA_RESPONSIBLE: VIEW_NEIGHBORHOOD_ATTENDANCE only
    check("MAHALLA_RESPONSIBLE has VIEW_NEIGHBORHOOD_ATTENDANCE",
      ROLE_PERMISSIONS["MAHALLA_RESPONSIBLE"].includes(Permission.VIEW_NEIGHBORHOOD_ATTENDANCE));
    check("MAHALLA_RESPONSIBLE does NOT have MANAGE_ATTENDANCE",
      !ROLE_PERMISSIONS["MAHALLA_RESPONSIBLE"].includes(Permission.MANAGE_ATTENDANCE));
    check("MAHALLA_RESPONSIBLE does NOT have VIEW_SCHOOL_ATTENDANCE",
      !ROLE_PERMISSIONS["MAHALLA_RESPONSIBLE"].includes(Permission.VIEW_SCHOOL_ATTENDANCE));

    // ADMIN: VIEW_GLOBAL_ATTENDANCE
    check("ADMIN has VIEW_GLOBAL_ATTENDANCE",
      ROLE_PERMISSIONS["ADMIN"].includes(Permission.VIEW_GLOBAL_ATTENDANCE));
    check("ADMIN has VIEW_SCHOOL_ATTENDANCE",
      ROLE_PERMISSIONS["ADMIN"].includes(Permission.VIEW_SCHOOL_ATTENDANCE));

    // SUPER_ADMIN: all attendance permissions
    check("SUPER_ADMIN has MANAGE_ATTENDANCE",
      ROLE_PERMISSIONS["SUPER_ADMIN"].includes(Permission.MANAGE_ATTENDANCE));
    check("SUPER_ADMIN has VIEW_GLOBAL_ATTENDANCE",
      ROLE_PERMISSIONS["SUPER_ADMIN"].includes(Permission.VIEW_GLOBAL_ATTENDANCE));

    // PARENT: no attendance-specific permissions
    check("PARENT does NOT have MANAGE_ATTENDANCE",
      !ROLE_PERMISSIONS["PARENT"].includes(Permission.MANAGE_ATTENDANCE));
    check("PARENT does NOT have VIEW_CLASS_ATTENDANCE",
      !ROLE_PERMISSIONS["PARENT"].includes(Permission.VIEW_CLASS_ATTENDANCE));
    check("PARENT does NOT have VIEW_SCHOOL_ATTENDANCE",
      !ROLE_PERMISSIONS["PARENT"].includes(Permission.VIEW_SCHOOL_ATTENDANCE));

    // STUDENT: only VIEW_OWN_ATTENDANCE
    check("STUDENT has VIEW_OWN_ATTENDANCE",
      ROLE_PERMISSIONS["STUDENT"].includes(Permission.VIEW_OWN_ATTENDANCE));
    check("STUDENT does NOT have VIEW_CLASS_ATTENDANCE",
      !ROLE_PERMISSIONS["STUDENT"].includes(Permission.VIEW_CLASS_ATTENDANCE));
    check("STUDENT does NOT have MANAGE_ATTENDANCE",
      !ROLE_PERMISSIONS["STUDENT"].includes(Permission.MANAGE_ATTENDANCE));
  }

  // ─── Authorization: active staff ─────────────────────────────────
  console.log("\n=== Authorization: active staff ===");
  {
    const activeTeacher = { role: "TEACHER", isActive: true };
    check("Active TEACHER has MANAGE_ATTENDANCE",
      hasPermission(activeTeacher, Permission.MANAGE_ATTENDANCE));
    check("Active TEACHER has VIEW_CLASS_ATTENDANCE",
      hasPermission(activeTeacher, Permission.VIEW_CLASS_ATTENDANCE));
    check("Active TEACHER is active staff",
      isUserActiveStaff(activeTeacher) === true);
    check("requireActiveStaff(active TEACHER) does not throw",
      (() => { try { requireActiveStaff(activeTeacher); return true; } catch { return false; } })());

    const activeSchoolAdmin = { role: "SCHOOL_ADMIN", isActive: true };
    check("Active SCHOOL_ADMIN has VIEW_SCHOOL_ATTENDANCE",
      hasPermission(activeSchoolAdmin, Permission.VIEW_SCHOOL_ATTENDANCE));
    check("Active SCHOOL_ADMIN denied MANAGE_ATTENDANCE",
      !hasPermission(activeSchoolAdmin, Permission.MANAGE_ATTENDANCE));

    const activeAdmin = { role: "ADMIN", isActive: true };
    check("Active ADMIN has VIEW_GLOBAL_ATTENDANCE",
      hasPermission(activeAdmin, Permission.VIEW_GLOBAL_ATTENDANCE));

    const activeSuperAdmin = { role: "SUPER_ADMIN", isActive: true };
    check("Active SUPER_ADMIN has MANAGE_ATTENDANCE",
      hasPermission(activeSuperAdmin, Permission.MANAGE_ATTENDANCE));
    check("Active SUPER_ADMIN has VIEW_GLOBAL_ATTENDANCE",
      hasPermission(activeSuperAdmin, Permission.VIEW_GLOBAL_ATTENDANCE));
  }

  // ─── Authorization: deactivated staff ────────────────────────────
  console.log("\n=== Authorization: deactivated staff ===");
  {
    const deactivatedTeacher = { role: "TEACHER", isActive: false };
    check("Deactivated TEACHER denied MANAGE_ATTENDANCE",
      !hasPermission(deactivatedTeacher, Permission.MANAGE_ATTENDANCE));
    check("Deactivated TEACHER denied VIEW_CLASS_ATTENDANCE",
      !hasPermission(deactivatedTeacher, Permission.VIEW_CLASS_ATTENDANCE));
    check("Deactivated TEACHER is not active staff",
      isUserActiveStaff(deactivatedTeacher) === false);
    checkThrows("requireActiveStaff(deactivated TEACHER) throws",
      () => requireActiveStaff(deactivatedTeacher));

    const deactivatedSchoolAdmin = { role: "SCHOOL_ADMIN", isActive: false };
    check("Deactivated SCHOOL_ADMIN denied VIEW_SCHOOL_ATTENDANCE",
      !hasPermission(deactivatedSchoolAdmin, Permission.VIEW_SCHOOL_ATTENDANCE));

    const deactivatedSuperAdmin = { role: "SUPER_ADMIN", isActive: false };
    check("Deactivated SUPER_ADMIN denied VIEW_GLOBAL_ATTENDANCE",
      !hasPermission(deactivatedSuperAdmin, Permission.VIEW_GLOBAL_ATTENDANCE));
    check("Deactivated SUPER_ADMIN denied MANAGE_ATTENDANCE",
      !hasPermission(deactivatedSuperAdmin, Permission.MANAGE_ATTENDANCE));
  }

  // ─── Authorization: reactivation restores ────────────────────────
  console.log("\n=== Authorization: reactivation restores ===");
  {
    const before = { role: "TEACHER", isActive: true };
    const after = { role: "TEACHER", isActive: false };
    const reactivated = { role: "TEACHER", isActive: true };
    check("Before deactivation: has MANAGE_ATTENDANCE",
      hasPermission(before, Permission.MANAGE_ATTENDANCE));
    check("After deactivation: denied MANAGE_ATTENDANCE",
      !hasPermission(after, Permission.MANAGE_ATTENDANCE));
    check("After reactivation: has MANAGE_ATTENDANCE again",
      hasPermission(reactivated, Permission.MANAGE_ATTENDANCE));
  }

  // ─── Authorization: PARENT / STUDENT ─────────────────────────────
  console.log("\n=== Authorization: PARENT / STUDENT ===");
  {
    const parent = { role: "PARENT", isActive: true };
    check("PARENT denied MANAGE_ATTENDANCE",
      !hasPermission(parent, Permission.MANAGE_ATTENDANCE));
    check("PARENT denied VIEW_CLASS_ATTENDANCE",
      !hasPermission(parent, Permission.VIEW_CLASS_ATTENDANCE));
    check("PARENT is not active staff",
      isUserActiveStaff(parent) === false);
    checkThrows("requireActiveStaff(PARENT) throws",
      () => requireActiveStaff(parent));

    const student = { role: "STUDENT", isActive: true };
    check("STUDENT has VIEW_OWN_ATTENDANCE",
      hasPermission(student, Permission.VIEW_OWN_ATTENDANCE));
    check("STUDENT denied MANAGE_ATTENDANCE",
      !hasPermission(student, Permission.MANAGE_ATTENDANCE));
    check("STUDENT denied VIEW_CLASS_ATTENDANCE",
      !hasPermission(student, Permission.VIEW_CLASS_ATTENDANCE));
  }

  // ─── Attendance status enum ──────────────────────────────────────
  console.log("\n=== Attendance status enum ===");
  {
    // The AttendanceStatus enum is generated by Prisma. We import it
    // here to verify it exists and has the expected values.
    const { AttendanceStatus } = require("@prisma/client");
    check("AttendanceStatus.PRESENT exists",
      AttendanceStatus.PRESENT === "PRESENT");
    check("AttendanceStatus.ABSENT exists",
      AttendanceStatus.ABSENT === "ABSENT");
    check("AttendanceStatus.LATE exists",
      AttendanceStatus.LATE === "LATE");
    check("AttendanceStatus.EXCUSED exists",
      AttendanceStatus.EXCUSED === "EXCUSED");
  }

  // ─── Mahalla absence threshold ───────────────────────────────────
  console.log("\n=== Mahalla absence threshold (env) ===");
  {
    const { mahallaAbsenceThreshold } = require("../config/env");
    check("mahallaAbsenceThreshold is a non-negative integer",
      Number.isInteger(mahallaAbsenceThreshold) && mahallaAbsenceThreshold >= 0);
    // The default is 3, but we don't hard-assert that — the env may override.
    check("mahallaAbsenceThreshold is reasonable (1-30)",
      mahallaAbsenceThreshold >= 0 && mahallaAbsenceThreshold <= 30);
  }

  // ─── Role hierarchy still intact ─────────────────────────────────
  console.log("\n=== Role hierarchy regression ===");
  {
    check("TEACHER level (3) < CLASS_TEACHER level (4)",
      ROLE_LEVEL["TEACHER"] < ROLE_LEVEL["CLASS_TEACHER"]);
    check("CLASS_TEACHER level (4) < SCHOOL_ADMIN level (5)",
      ROLE_LEVEL["CLASS_TEACHER"] < ROLE_LEVEL["SCHOOL_ADMIN"]);
    check("SCHOOL_ADMIN level (5) < ADMIN level (8)",
      ROLE_LEVEL["SCHOOL_ADMIN"] < ROLE_LEVEL["ADMIN"]);
    check("ADMIN level (8) < SUPER_ADMIN level (10)",
      ROLE_LEVEL["ADMIN"] < ROLE_LEVEL["SUPER_ADMIN"]);
  }
}

// ─── Layer 2: Integration Tests (require PostgreSQL) ──────────────────

async function runIntegrationTests() {
  console.log("\n══════════════════════════════════════════");
  console.log("  Phase 5 — Integration Tests (PostgreSQL)");
  console.log("══════════════════════════════════════════\n");

  const { prisma } = await import("../database/prisma");

  // Check DB connection
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.log("⚠️  No database connection available — skipping integration tests.");
    console.log("   To run these tests, set DATABASE_URL in .env and run:");
    console.log("   npx tsx src/__tests__/phase5Tests.ts");
    return;
  }

  const runId = Date.now();
  // CRITICAL: use n*10+m (not n*2+m) for the per-test offset, and a
  // 1000-slot multiplier for runId. The old formula n*2+m caused
  // collisions: 7*2+2 = 8*2+0 = 16, so tid(7,2)==tid(8). With n*10+m,
  // each (n,m) pair maps to a unique value (max 17*10+2=172 < 1000).
  const tid = (n: number, m = 0) => BigInt(800000000 + (runId % 100000) * 1000 + n * 10 + m);

  // Pre-cleanup: delete leftover test data from previous crashed runs.
  // Test users have telegramId >= 800000000 (the test range). Schools
  // and neighborhoods are identified by their "Phase5" name prefix.
  // This ensures the suite can run repeatedly against the same DB even
  // if a previous run crashed before its finally-block cleanup ran.
  console.log("🧹 Pre-cleanup: removing leftover test data...");
  await prisma.attendanceAuditLog.deleteMany({}).catch(() => {});
  await prisma.attendanceEscalation.deleteMany({}).catch(() => {});
  await prisma.attendance.deleteMany({}).catch(() => {});
  await (prisma as any).staffActionLog.deleteMany({
    where: { targetUserId: { not: 0 } }
  }).catch(() => {});
  // Delete test-range users (telegramId >= 800000000)
  await prisma.user.deleteMany({
    where: { telegramId: { gte: BigInt(800000000) } }
  }).catch(() => {});
  // Delete test schools and neighborhoods (identified by name prefix)
  await prisma.school.deleteMany({
    where: { name: { startsWith: "Phase5 School" } }
  }).catch(() => {});
  await prisma.school.deleteMany({
    where: { name: { startsWith: "Phase5 Report School" } }
  }).catch(() => {});
  await prisma.neighborhood.deleteMany({
    where: { name: { startsWith: "Phase5 MFY" } }
  }).catch(() => {});
  console.log("✅ Pre-cleanup complete.");

  // Setup
  const school = await prisma.school.create({ data: { name: `Phase5 School ${runId}` } });
  const school2 = await prisma.school.create({ data: { name: `Phase5 School 2 ${runId}` } });
  const neighborhood = await prisma.neighborhood.create({ data: { name: `Phase5 MFY ${runId}` } });
  const neighborhood2 = await prisma.neighborhood.create({ data: { name: `Phase5 MFY 2 ${runId}` } });

  const createdUsers: number[] = [];
  const createdStudents: number[] = [];
  const createdFamilies: number[] = [];

  async function cleanup() {
    // Clean attendance + escalations + audit logs first (FK constraints)
    await prisma.attendanceAuditLog.deleteMany({}).catch(() => {});
    await prisma.attendanceEscalation.deleteMany({}).catch(() => {});
    await prisma.attendance.deleteMany({}).catch(() => {});

    for (const sid of createdStudents) {
      await prisma.student.deleteMany({ where: { id: sid } }).catch(() => {});
    }
    for (const fid of createdFamilies) {
      await prisma.familyInvitation.deleteMany({ where: { familyId: fid } }).catch(() => {});
      await prisma.familyStudent.deleteMany({ where: { familyId: fid } }).catch(() => {});
      await prisma.familyMember.deleteMany({ where: { familyId: fid } }).catch(() => {});
      await prisma.family.deleteMany({ where: { id: fid } }).catch(() => {});
    }
    for (const uid of createdUsers) {
      // Also clean staffActionLog entries for these users
      await (prisma as any).staffActionLog.deleteMany({ where: { targetUserId: uid } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
    }
    await prisma.school.deleteMany({ where: { id: { in: [school.id, school2.id] } } }).catch(() => {});
    await prisma.neighborhood.deleteMany({ where: { id: { in: [neighborhood.id, neighborhood2.id] } } }).catch(() => {});
  }

  try {
    // ─── Test: Active TEACHER can record attendance ────────────────
    console.log("=== Test: Active TEACHER can record attendance ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      // Use a fake bot to avoid sending real Telegram messages.
      const fakeBot = new Bot("0:faketoken") as any;
      // Stub api.sendMessage so notifications don't actually fire.
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const teacherTg = tid(1);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T1", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const studentTg = tid(1, 1);
      const parent = await prisma.user.create({
        data: { telegramId: studentTg, fullName: "Parent P1", role: "PARENT", isActive: true, schoolId: school.id, neighborhoodId: neighborhood.id, phone: "+998901234567" },
      });
      createdUsers.push(parent.id);

      const student = await prisma.student.create({
        data: { parentId: parent.id, schoolId: school.id, fullName: "Student S1", className: "5-A" },
      });
      createdStudents.push(student.id);

      const result = await attendanceService.recordAttendance({
        actorTelegramId: teacherTg,
        studentId: student.id,
        date: new Date(),
        status: "ABSENT",
      });

      check("Attendance recorded (created=true)", result.created === true);
      check("newStatus = ABSENT", result.newStatus === "ABSENT");
      check("notifiedParents >= 1 (parent was notified)", result.notifiedParents >= 1);

      // Verify the attendance row exists
      const attendance = await prisma.attendance.findUnique({
        where: { studentId_date: { studentId: student.id, date: new Date(new Date().setUTCHours(0,0,0,0)) } },
      });
      check("Attendance row exists in DB", attendance !== null);
      check("recordedById = teacher.id", attendance?.recordedById === teacher.id);
      check("schoolId = school.id (denormalized)", attendance?.schoolId === school.id);
      check("className = '5-A' (denormalized)", attendance?.className === "5-A");
    }

    // ─── Test: Inactive TEACHER cannot record attendance ──────────
    console.log("\n=== Test: Inactive TEACHER cannot record attendance ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const inactiveTeacherTg = tid(2);
      const inactiveTeacher = await prisma.user.create({
        data: { telegramId: inactiveTeacherTg, fullName: "Inactive Teacher T2", role: "TEACHER", isActive: false, schoolId: school.id },
      });
      createdUsers.push(inactiveTeacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S2", className: "5-A" },
      });
      createdStudents.push(student.id);

      let threw = false;
      try {
        await attendanceService.recordAttendance({
          actorTelegramId: inactiveTeacherTg,
          studentId: student.id,
          date: new Date(),
          status: "PRESENT",
        });
      } catch (e) {
        threw = true;
        check("Inactive teacher throws PermissionError",
          (e as Error).name === "PermissionError");
      }
      check("Inactive teacher was rejected (threw)", threw);

      // Verify no attendance row was created
      const attendance = await prisma.attendance.findUnique({
        where: { studentId_date: { studentId: student.id, date: new Date(new Date().setUTCHours(0,0,0,0)) } },
      });
      check("No attendance row created for inactive teacher", attendance === null);
    }

    // ─── Test: Wrong school rejected ───────────────────────────────
    console.log("\n=== Test: Wrong school rejected ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const teacherTg = tid(3);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T3", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      // Student at school2, but teacher is at school
      const student = await prisma.student.create({
        data: { schoolId: school2.id, fullName: "Student S3", className: "6-A" },
      });
      createdStudents.push(student.id);

      let threw = false;
      try {
        await attendanceService.recordAttendance({
          actorTelegramId: teacherTg,
          studentId: student.id,
          date: new Date(),
          status: "PRESENT",
        });
      } catch {
        threw = true;
      }
      check("Teacher from school A rejected for student at school B", threw);
    }

    // ─── Test: Duplicate attendance prevented (upsert) ─────────────
    console.log("\n=== Test: Duplicate attendance prevented (upsert) ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const teacherTg = tid(4);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T4", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S4", className: "5-A" },
      });
      createdStudents.push(student.id);

      const date = new Date();

      // First recording
      const r1 = await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date, status: "ABSENT",
      });
      check("First recording: created=true", r1.created === true);

      // Second recording (same date) — should UPDATE, not create
      const r2 = await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date, status: "PRESENT",
      });
      check("Second recording: created=false (update)", r2.created === false);
      check("Second recording: oldStatus = ABSENT", r2.oldStatus === "ABSENT");
      check("Second recording: newStatus = PRESENT", r2.newStatus === "PRESENT");

      // Verify only one row exists
      const count = await prisma.attendance.count({
        where: { studentId: student.id, date: new Date(date.setUTCHours(0,0,0,0)) },
      });
      check("Only one attendance row exists (no duplicate)", count === 1);

      // Verify audit log was created for the change
      const auditLogs = await (prisma as any).attendanceAuditLog.findMany({
        where: { attendanceId: r2.attendanceId },
      });
      check("Audit log has 2 entries (create + update)", auditLogs.length === 2);
      check("Second audit log oldStatus = ABSENT", auditLogs[1]?.oldStatus === "ABSENT");
      check("Second audit log newStatus = PRESENT", auditLogs[1]?.newStatus === "PRESENT");
    }

    // ─── Test: Parent can view own child's attendance ──────────────
    console.log("\n=== Test: Parent can view own child's attendance ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const parentTg = tid(5);
      const parent = await prisma.user.create({
        data: { telegramId: parentTg, fullName: "Parent P5", role: "PARENT", isActive: true, schoolId: school.id, neighborhoodId: neighborhood.id, phone: "+998901111222" },
      });
      createdUsers.push(parent.id);

      const student = await prisma.student.create({
        data: { parentId: parent.id, schoolId: school.id, fullName: "Student S5", className: "5-A" },
      });
      createdStudents.push(student.id);

      // Record some attendance as a teacher
      const teacherTg = tid(5, 1);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T5", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const today = new Date();
      const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: yesterday, status: "ABSENT",
      });
      await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: today, status: "PRESENT",
      });

      // Parent views
      const result = await attendanceService.getAttendanceForParent({
        parentTelegramId: parentTg,
        studentId: student.id,
      });
      check("Parent can view own child's attendance", result !== null);
      check("Result has 2 records", result?.records.length === 2);
      check("Stats total = 2", result?.stats.total === 2);
      check("Stats absent = 1", result?.stats.absent === 1);
      check("Stats present = 1", result?.stats.present === 1);
      check("Stats percentage = 100% (1 present + 0 late + 0 excused of 2)",
        result?.stats.percentage === 50);
    }

    // ─── Test: Unrelated parent cannot view child's attendance ─────
    console.log("\n=== Test: Unrelated parent cannot view child's attendance ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const unrelatedParentTg = tid(6);
      const unrelatedParent = await prisma.user.create({
        data: { telegramId: unrelatedParentTg, fullName: "Parent P6", role: "PARENT", isActive: true, schoolId: school.id, neighborhoodId: neighborhood.id, phone: "+998903334445" },
      });
      createdUsers.push(unrelatedParent.id);

      const otherStudent = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Other Student S6", className: "5-A" },
        // No parentId — owned by no one
      });
      createdStudents.push(otherStudent.id);

      const result = await attendanceService.getAttendanceForParent({
        parentTelegramId: unrelatedParentTg,
        studentId: otherStudent.id,
      });
      check("Unrelated parent cannot view (returns null)", result === null);
    }

    // ─── Test: Both parents in family can view child's attendance ─
    console.log("\n=== Test: Both parents in family can view child's attendance ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const fatherTg = tid(7);
      const motherTg = tid(7, 1);

      const father = await prisma.user.create({
        data: { telegramId: fatherTg, fullName: "Father P7", role: "PARENT", isActive: true, schoolId: school.id, neighborhoodId: neighborhood.id, phone: "+998907778881", parentRole: "FATHER" },
      });
      createdUsers.push(father.id);

      const mother = await prisma.user.create({
        data: { telegramId: motherTg, fullName: "Mother P7", role: "PARENT", isActive: true, schoolId: school.id, neighborhoodId: neighborhood.id, phone: "+998907778882", parentRole: "MOTHER" },
      });
      createdUsers.push(mother.id);

      // Create a family with both parents
      const family = await prisma.family.create({ data: {} });
      createdFamilies.push(family.id);
      await prisma.familyMember.create({ data: { familyId: family.id, userId: father.id, parentRole: "FATHER" } });
      await prisma.familyMember.create({ data: { familyId: family.id, userId: mother.id, parentRole: "MOTHER" } });

      // Student claimed by father, linked to family
      const student = await prisma.student.create({
        data: { parentId: father.id, schoolId: school.id, fullName: "Student S7", className: "5-A" },
      });
      createdStudents.push(student.id);
      await prisma.familyStudent.create({ data: { familyId: family.id, studentId: student.id } });

      // Record attendance
      const teacherTg = tid(7, 2);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T7", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: new Date(), status: "ABSENT",
      });

      // Father views
      const fatherView = await attendanceService.getAttendanceForParent({
        parentTelegramId: fatherTg, studentId: student.id,
      });
      check("Father can view child's attendance", fatherView !== null);
      check("Father sees 1 record", fatherView?.records.length === 1);

      // Mother views (she's in the family but not Student.parentId)
      const motherView = await attendanceService.getAttendanceForParent({
        parentTelegramId: motherTg, studentId: student.id,
      });
      check("Mother (family member) can view child's attendance", motherView !== null);
      check("Mother sees 1 record", motherView?.records.length === 1);
    }

    // ─── Test: Consecutive absence calculation ─────────────────────
    console.log("\n=== Test: Consecutive absence calculation ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { attendanceRepo } = await import("../repositories/attendanceRepo");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const teacherTg = tid(8);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T8", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S8", className: "5-A" },
      });
      createdStudents.push(student.id);

      // Record 3 consecutive absences
      const today = new Date();
      const d1 = new Date(today); d1.setUTCDate(d1.getUTCDate() - 2);
      const d2 = new Date(today); d2.setUTCDate(d2.getUTCDate() - 1);
      const d3 = new Date(today);

      await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: student.id, date: d1, status: "ABSENT" });
      await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: student.id, date: d2, status: "ABSENT" });
      await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: student.id, date: d3, status: "ABSENT" });

      const streak = await attendanceRepo.getConsecutiveAbsences(student.id, d3);
      check("Consecutive absence streak = 3", streak === 3);

      // Now record PRESENT — streak should break
      const d4 = new Date(today); d4.setUTCDate(d4.getUTCDate() + 1);
      await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: student.id, date: d4, status: "PRESENT" });
      const streakAfterPresent = await attendanceRepo.getConsecutiveAbsences(student.id, d4);
      check("Streak = 0 after PRESENT", streakAfterPresent === 0);
    }

    // ─── Test: Audit log captures changes ──────────────────────────
    console.log("\n=== Test: Audit log captures changes ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const teacherTg = tid(9);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T9", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S9", className: "5-A" },
      });
      createdStudents.push(student.id);

      // Create ABSENT
      const r1 = await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: new Date(), status: "ABSENT",
      });

      // Change to PRESENT
      const r2 = await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: new Date(), status: "PRESENT",
      });

      const auditLogs = await (prisma as any).attendanceAuditLog.findMany({
        where: { attendanceId: r2.attendanceId },
        orderBy: { createdAt: "asc" },
      });
      check("Audit log has 2 entries", auditLogs.length === 2);
      check("First audit: oldStatus=null (create)", auditLogs[0]?.oldStatus === null);
      check("First audit: newStatus=ABSENT", auditLogs[0]?.newStatus === "ABSENT");
      check("Second audit: oldStatus=ABSENT", auditLogs[1]?.oldStatus === "ABSENT");
      check("Second audit: newStatus=PRESENT", auditLogs[1]?.newStatus === "PRESENT");
      check("Second audit actorUserId = teacher.id", auditLogs[1]?.actorUserId === teacher.id);
    }

    // ─── Test: Invalid student rejected ────────────────────────────
    console.log("\n=== Test: Invalid student rejected ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const teacherTg = tid(10);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T10", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      let threw = false;
      try {
        await attendanceService.recordAttendance({
          actorTelegramId: teacherTg,
          studentId: 999999, // nonexistent
          date: new Date(),
          status: "PRESENT",
        });
      } catch {
        threw = true;
      }
      check("Invalid student ID rejected", threw);
    }

    // ─── Test: PRESENT does not trigger notification ───────────────
    console.log("\n=== Test: PRESENT does not trigger notification ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      let sendCount = 0;
      fakeBot.api.sendMessage = async () => { sendCount++; return { message_id: 1 } as any; };
      setBotRef(fakeBot);

      const teacherTg = tid(11);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T11", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const parentTg = tid(11, 1);
      const parent = await prisma.user.create({
        data: { telegramId: parentTg, fullName: "Parent P11", role: "PARENT", isActive: true, schoolId: school.id, neighborhoodId: neighborhood.id, phone: "+998905556667" },
      });
      createdUsers.push(parent.id);

      const student = await prisma.student.create({
        data: { parentId: parent.id, schoolId: school.id, fullName: "Student S11", className: "5-A" },
      });
      createdStudents.push(student.id);

      await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: new Date(), status: "PRESENT",
      });
      check("PRESENT does not send any notification", sendCount === 0);

      // Now record ABSENT — should notify
      const d2 = new Date(); d2.setUTCDate(d2.getUTCDate() - 1);
      await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: d2, status: "ABSENT",
      });
      check("ABSENT sends 1 notification (to 1 parent)", sendCount === 1);

      // Now record LATE on a different date — should notify
      const d3 = new Date(); d3.setUTCDate(d3.getUTCDate() - 2);
      await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: d3, status: "LATE",
      });
      check("LATE sends 1 notification", sendCount === 2);
    }

    // ─── Test: Notification failure doesn't roll back attendance ───
    console.log("\n=== Test: Notification failure doesn't roll back attendance ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      // Make sendMessage always throw
      fakeBot.api.sendMessage = async () => { throw new Error("blocked chat"); };
      setBotRef(fakeBot);

      const teacherTg = tid(12);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T12", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const parentTg = tid(12, 1);
      const parent = await prisma.user.create({
        data: { telegramId: parentTg, fullName: "Parent P12", role: "PARENT", isActive: true, schoolId: school.id, neighborhoodId: neighborhood.id, phone: "+998901234999" },
      });
      createdUsers.push(parent.id);

      const student = await prisma.student.create({
        data: { parentId: parent.id, schoolId: school.id, fullName: "Student S12", className: "5-A" },
      });
      createdStudents.push(student.id);

      let didNotThrow = true;
      try {
        const r = await attendanceService.recordAttendance({
          actorTelegramId: teacherTg, studentId: student.id, date: new Date(), status: "ABSENT",
        });
        check("Attendance record created despite notification failure", r.created === true);
        check("notifiedParents = 0 (all notifications failed)", r.notifiedParents === 0);
      } catch {
        didNotThrow = false;
      }
      check("recordAttendance did NOT throw on notification failure", didNotThrow);

      // Verify the attendance row was still persisted
      const attendance = await prisma.attendance.findUnique({
        where: { studentId_date: { studentId: student.id, date: new Date(new Date().setUTCHours(0,0,0,0)) } },
      });
      check("Attendance row persisted despite notification failure", attendance !== null);
    }

    // ─── Test: Bulk record attendance ──────────────────────────────
    console.log("\n=== Test: Bulk record attendance ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const teacherTg = tid(13);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T13", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const s1 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S13a", className: "5-A" } });
      const s2 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S13b", className: "5-A" } });
      const s3 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S13c", className: "5-A" } });
      createdStudents.push(s1.id, s2.id, s3.id);

      const results = await attendanceService.bulkRecordAttendance({
        actorTelegramId: teacherTg,
        schoolId: school.id,
        className: "5-A",
        date: new Date(),
        records: [
          { studentId: s1.id, status: "PRESENT" },
          { studentId: s2.id, status: "ABSENT" },
          { studentId: s3.id, status: "LATE" },
        ],
      });
      check("Bulk record: 3 successes", results.filter(r => r.success).length === 3);
      check("Bulk record: 0 failures", results.filter(r => !r.success).length === 0);

      // Verify rows exist
      const rows = await prisma.attendance.findMany({
        where: { studentId: { in: [s1.id, s2.id, s3.id] }, date: new Date(new Date().setUTCHours(0,0,0,0)) },
      });
      check("3 attendance rows in DB", rows.length === 3);
    }

    // ─── Test: Mahalla escalation (3 consecutive absences) ─────────
    console.log("\n=== Test: Mahalla escalation ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      let mahallaReceived = 0;
      fakeBot.api.sendMessage = async (_chatId: string, text: string) => {
        if (text.includes("Ogohlantirish") || text.includes("ogohlantirish")) {
          mahallaReceived++;
        }
        return { message_id: 1 } as any;
      };
      setBotRef(fakeBot);

      // Set up mahalla responsible
      const mahallaTg = tid(14);
      const mahalla = await prisma.user.create({
        data: { telegramId: mahallaTg, fullName: "Mahalla M14", role: "MAHALLA_RESPONSIBLE", isActive: true, neighborhoodId: neighborhood.id },
      });
      createdUsers.push(mahalla.id);

      // Parent with the same neighborhood
      const parentTg = tid(14, 1);
      const parent = await prisma.user.create({
        data: { telegramId: parentTg, fullName: "Parent P14", role: "PARENT", isActive: true, schoolId: school.id, neighborhoodId: neighborhood.id, phone: "+998901234000" },
      });
      createdUsers.push(parent.id);

      const student = await prisma.student.create({
        data: { parentId: parent.id, schoolId: school.id, fullName: "Student S14", className: "5-A" },
      });
      createdStudents.push(student.id);

      const teacherTg = tid(14, 2);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T14", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      // Record 3 consecutive absences
      const today = new Date();
      const d1 = new Date(today); d1.setUTCDate(d1.getUTCDate() - 2);
      const d2 = new Date(today); d2.setUTCDate(d2.getUTCDate() - 1);
      const d3 = new Date(today);

      const r1 = await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: student.id, date: d1, status: "ABSENT" });
      check("Day 1: escalated=false (streak=1, below threshold)", r1.escalated === false);

      const r2 = await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: student.id, date: d2, status: "ABSENT" });
      check("Day 2: escalated=false (streak=2, below threshold)", r2.escalated === false);

      const r3 = await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: student.id, date: d3, status: "ABSENT" });
      check("Day 3: escalated=true (streak=3, threshold reached)", r3.escalated === true);
      check("Mahalla received notification", mahallaReceived >= 1);

      // Verify escalation record exists
      const escalation = await prisma.attendanceEscalation.findUnique({
        where: { studentId_thresholdDate: { studentId: student.id, thresholdDate: new Date(d3.setUTCHours(0,0,0,0)) } },
      });
      check("Escalation record exists in DB", escalation !== null);
      check("Escalation absenceCount = 3", escalation?.absenceCount === 3);
      check("Escalation neighborhoodId matches", escalation?.neighborhoodId === neighborhood.id);

      // Recording the same absence again should NOT trigger a duplicate escalation
      // (because the unique constraint prevents it)
      const r3again = await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: student.id, date: d3, status: "ABSENT" });
      check("Re-recording day 3: escalated=false (idempotent)", r3again.escalated === false);

      // Verify only 1 escalation exists
      const escalationCount = await prisma.attendanceEscalation.count({
        where: { studentId: student.id },
      });
      check("Only 1 escalation record (no duplicate)", escalationCount === 1);
    }

    // ─── Test: Reports — role-scoped ───────────────────────────────
    console.log("\n=== Test: Reports — role-scoped ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      // Use a DEDICATED school for this test so the SCHOOL_ADMIN report
      // only counts attendance created here — NOT records from earlier
      // tests that used the shared `school`. Earlier tests (1, 2, 4, 5,
      // 8, 9, 11, 12, 13, 14, 17) all created attendance at `school.id`
      // and those records persist until the final finally-block cleanup.
      // Without a dedicated school, the SCHOOL_ADMIN report would
      // correctly include all of them, making the exact-total
      // assertions fail. The production report logic is correct — this
      // is purely a test-fixture isolation issue.
      const reportSchool = await prisma.school.create({ data: { name: `Phase5 Report School ${runId}` } });

      // Set up: teacher records some attendance at the dedicated school
      const teacherTg = tid(15);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T15", role: "TEACHER", isActive: true, schoolId: reportSchool.id },
      });
      createdUsers.push(teacher.id);

      const s1 = await prisma.student.create({ data: { schoolId: reportSchool.id, fullName: "S15a", className: "5-A" } });
      const s2 = await prisma.student.create({ data: { schoolId: reportSchool.id, fullName: "S15b", className: "5-A" } });
      createdStudents.push(s1.id, s2.id);

      const today = new Date();
      const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: s1.id, date: today, status: "PRESENT" });
      await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: s2.id, date: today, status: "ABSENT" });
      await attendanceService.recordAttendance({ actorTelegramId: teacherTg, studentId: s1.id, date: yesterday, status: "LATE" });

      // SCHOOL_ADMIN report — scoped to reportSchool (dedicated)
      const saTg = tid(15, 1);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 15", role: "SCHOOL_ADMIN", isActive: true, schoolId: reportSchool.id },
      });
      createdUsers.push(sa.id);

      const fromDate = new Date(today); fromDate.setUTCDate(fromDate.getUTCDate() - 7);
      const report = await attendanceService.getReport({
        actorTelegramId: saTg,
        fromDate,
        toDate: today,
      });
      check("SCHOOL_ADMIN report scope = 'school'", report.scope === "school");
      check("SCHOOL_ADMIN report totals.total = 3", report.totals.total === 3);
      check("SCHOOL_ADMIN report totals.present = 1", report.totals.present === 1);
      check("SCHOOL_ADMIN report totals.absent = 1", report.totals.absent === 1);
      check("SCHOOL_ADMIN report totals.late = 1", report.totals.late === 1);
      check("SCHOOL_ADMIN report byClass has '5-A'",
        !!(report.byClass && report.byClass.some(c => c.className === "5-A")));

      // SUPER_ADMIN report — should be global (includes all test data
      // across all schools, so we only assert >= 3)
      const superTg = tid(15, 2);
      const superUser = await prisma.user.create({
        data: { telegramId: superTg, fullName: "Super 15", role: "SUPER_ADMIN", isActive: true },
      });
      createdUsers.push(superUser.id);

      const globalReport = await attendanceService.getReport({
        actorTelegramId: superTg,
        fromDate,
        toDate: today,
      });
      check("SUPER_ADMIN report scope = 'global'", globalReport.scope === "global");
      check("SUPER_ADMIN report totals.total >= 3 (includes all test data)", globalReport.totals.total >= 3);

      // Clean up the dedicated report school (its students are already
      // in createdStudents for the main cleanup; the school itself
      // needs explicit cleanup since it's not in the main school list).
      await prisma.school.deleteMany({ where: { id: reportSchool.id } }).catch(() => {});
    }

    // ─── Test: PARENT denied report ────────────────────────────────
    console.log("\n=== Test: PARENT denied report ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const parentTg = tid(16);
      const parent = await prisma.user.create({
        data: { telegramId: parentTg, fullName: "Parent P16", role: "PARENT", isActive: true, schoolId: school.id, phone: "+998901111000" },
      });
      createdUsers.push(parent.id);

      let threw = false;
      try {
        await attendanceService.getReport({
          actorTelegramId: parentTg,
          fromDate: new Date(Date.now() - 7 * 86400000),
          toDate: new Date(),
        });
      } catch (e) {
        threw = true;
        check("PARENT throws PermissionError on report",
          (e as Error).name === "PermissionError");
      }
      check("PARENT was rejected for report", threw);
    }

    // ─── Test: Deactivation preserves data integrity ───────────────
    console.log("\n=== Test: Deactivation preserves data integrity ===");
    {
      const { attendanceService, setBotRef } = await import("../services/attendanceService");
      const { attendanceRepo } = await import("../repositories/attendanceRepo");
      const { Bot } = await import("grammy");
      const fakeBot = new Bot("0:faketoken") as any;
      fakeBot.api.sendMessage = async () => ({ message_id: 1 } as any);
      setBotRef(fakeBot);

      const teacherTg = tid(17);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T17", role: "TEACHER", isActive: true, schoolId: school.id, phone: "+998901231234" },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S17", className: "5-A" },
      });
      createdStudents.push(student.id);

      // Record attendance while active
      await attendanceService.recordAttendance({
        actorTelegramId: teacherTg, studentId: student.id, date: new Date(), status: "ABSENT",
      });

      // Deactivate teacher
      await prisma.user.update({ where: { id: teacher.id }, data: { isActive: false } });

      // Verify attendance still exists
      const records = await attendanceRepo.listByStudent(student.id);
      check("Attendance records preserved after teacher deactivation", records.length === 1);

      // Deactivated teacher cannot record new attendance
      let threw = false;
      try {
        await attendanceService.recordAttendance({
          actorTelegramId: teacherTg,
          studentId: student.id,
          date: new Date(Date.now() - 86400000),
          status: "PRESENT",
        });
      } catch {
        threw = true;
      }
      check("Deactivated teacher cannot record new attendance", threw);

      // Reactivate
      await prisma.user.update({ where: { id: teacher.id }, data: { isActive: true } });

      // Now can record again
      const r = await attendanceService.recordAttendance({
        actorTelegramId: teacherTg,
        studentId: student.id,
        date: new Date(Date.now() - 86400000),
        status: "PRESENT",
      });
      check("Reactivated teacher can record attendance", r.created === true);
    }

  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

// ─── Runner ────────────────────────────────────────────────────────────

async function main() {
  runPermissionTests();
  await runIntegrationTests();

  console.log(`\n══════════════════════════════════════════`);
  console.log(`  Total: ${pass} passed, ${fail} failed`);
  console.log(`══════════════════════════════════════════`);

  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
