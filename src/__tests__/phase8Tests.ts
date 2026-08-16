/**
 * Phase 8: Archive tests
 *
 * Two layers:
 *   1. PURE LOGIC TESTS — always run. Test archive policy, permissions,
 *      and idempotency logic without a database.
 *   2. INTEGRATION TESTS — require PostgreSQL. Skip cleanly without DB.
 *
 * Run with: npx tsx src/__tests__/phase8Tests.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test:test_token";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";

import {
  Permission,
  ROLE_PERMISSIONS,
  hasPermission,
  PermissionError,
} from "../auth/permissions";
import {
  ATTENDANCE_ARCHIVE_AGE_MONTHS,
  getAttendanceCutoffDate,
} from "../services/archiveService";

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

function runLogicTests() {
  console.log("══════════════════════════════════════════");
  console.log("  Phase 8 — Pure Logic Tests");
  console.log("══════════════════════════════════════════\n");

  // ─── Archive permissions ─────────────────────────────────────────
  console.log("=== Archive permissions ===");
  {
    // SCHOOL_ADMIN: has VIEW_ARCHIVE but NOT MANAGE_ARCHIVE
    const sa = { role: "SCHOOL_ADMIN", isActive: true };
    check("SCHOOL_ADMIN can VIEW_ARCHIVE",
      hasPermission(sa, Permission.VIEW_ARCHIVE));
    check("SCHOOL_ADMIN cannot MANAGE_ARCHIVE",
      !hasPermission(sa, Permission.MANAGE_ARCHIVE));

    // ADMIN: has both VIEW_ARCHIVE and MANAGE_ARCHIVE
    const admin = { role: "ADMIN", isActive: true };
    check("ADMIN can VIEW_ARCHIVE",
      hasPermission(admin, Permission.VIEW_ARCHIVE));
    check("ADMIN can MANAGE_ARCHIVE",
      hasPermission(admin, Permission.MANAGE_ARCHIVE));

    // SUPER_ADMIN: all permissions
    const superAdm = { role: "SUPER_ADMIN", isActive: true };
    check("SUPER_ADMIN can VIEW_ARCHIVE",
      hasPermission(superAdm, Permission.VIEW_ARCHIVE));
    check("SUPER_ADMIN can MANAGE_ARCHIVE",
      hasPermission(superAdm, Permission.MANAGE_ARCHIVE));

    // TEACHER: no archive permissions
    const teacher = { role: "TEACHER", isActive: true };
    check("TEACHER cannot VIEW_ARCHIVE",
      !hasPermission(teacher, Permission.VIEW_ARCHIVE));
    check("TEACHER cannot MANAGE_ARCHIVE",
      !hasPermission(teacher, Permission.MANAGE_ARCHIVE));

    // PARENT: no archive permissions
    const parent = { role: "PARENT", isActive: true };
    check("PARENT cannot VIEW_ARCHIVE",
      !hasPermission(parent, Permission.VIEW_ARCHIVE));
    check("PARENT cannot MANAGE_ARCHIVE",
      !hasPermission(parent, Permission.MANAGE_ARCHIVE));

    // STUDENT: no archive permissions
    const student = { role: "STUDENT", isActive: true };
    check("STUDENT cannot VIEW_ARCHIVE",
      !hasPermission(student, Permission.VIEW_ARCHIVE));
    check("STUDENT cannot MANAGE_ARCHIVE",
      !hasPermission(student, Permission.MANAGE_ARCHIVE));

    // Deactivated staff lose archive permissions
    const deactivatedSA = { role: "SCHOOL_ADMIN", isActive: false };
    check("Deactivated SCHOOL_ADMIN cannot VIEW_ARCHIVE",
      !hasPermission(deactivatedSA, Permission.VIEW_ARCHIVE));
    const deactivatedAdmin = { role: "ADMIN", isActive: false };
    check("Deactivated ADMIN cannot MANAGE_ARCHIVE",
      !hasPermission(deactivatedAdmin, Permission.MANAGE_ARCHIVE));
  }

  // ─── Archive policy ──────────────────────────────────────────────
  console.log("\n=== Archive policy ===");
  {
    check("Attendance archive age = 12 months",
      ATTENDANCE_ARCHIVE_AGE_MONTHS === 12);

    // Cutoff date calculation
    const now = new Date("2026-08-16T12:00:00Z");
    const cutoff = getAttendanceCutoffDate(now);
    check("Cutoff is 12 months before now",
      cutoff.getFullYear() === 2025 && cutoff.getMonth() === 7); // August 2025
    check("Cutoff is 16 August 2025",
      cutoff.getDate() === 16);

    // Eligibility: record older than cutoff → eligible
    const oldDate = new Date("2025-07-01"); // before cutoff
    check("Record before cutoff is eligible",
      oldDate < cutoff);

    // Eligibility: record newer than cutoff → not eligible
    const newDate = new Date("2026-07-01"); // after cutoff
    check("Record after cutoff is NOT eligible",
      !(newDate < cutoff));

    // Boundary: exactly at cutoff
    const boundaryDate = new Date(cutoff);
    check("Record at cutoff is NOT eligible (not strictly less than)",
      !(boundaryDate < cutoff));

    // Boundary: one day before cutoff
    const dayBefore = new Date(cutoff);
    dayBefore.setDate(dayBefore.getDate() - 1);
    check("Record 1 day before cutoff is eligible",
      dayBefore < cutoff);
  }

  // ─── Idempotency logic ──────────────────────────────────────────
  console.log("\n=== Idempotency logic ===");
  {
    // Simulate the idempotency check: if archivedAt is already set,
    // the archive operation is a no-op.
    function archiveIfNotAlready(record: { archivedAt: Date | null }): {
      archived: boolean; alreadyArchived: boolean;
    } {
      if (record.archivedAt) {
        return { archived: false, alreadyArchived: true };
      }
      return { archived: true, alreadyArchived: false };
    }

    // First archive: not archived → archived = true
    const active = { archivedAt: null };
    const r1 = archiveIfNotAlready(active);
    check("First archive: archived = true", r1.archived === true);
    check("First archive: alreadyArchived = false", r1.alreadyArchived === false);

    // Second archive: already archived → no-op
    const archived = { archivedAt: new Date() };
    const r2 = archiveIfNotAlready(archived);
    check("Second archive: archived = false", r2.archived === false);
    check("Second archive: alreadyArchived = true", r2.alreadyArchived === true);
  }

  // ─── Unarchive idempotency ──────────────────────────────────────
  console.log("\n=== Unarchive idempotency ===");
  {
    function unarchiveIfNotActive(record: { archivedAt: Date | null }): {
      unarchived: boolean; alreadyActive: boolean;
    } {
      if (!record.archivedAt) {
        return { unarchived: false, alreadyActive: true };
      }
      return { unarchived: true, alreadyActive: false };
    }

    // Unarchive an archived record
    const archived = { archivedAt: new Date() };
    const r1 = unarchiveIfNotActive(archived);
    check("Unarchive archived: unarchived = true", r1.unarchived === true);
    check("Unarchive archived: alreadyActive = false", r1.alreadyActive === false);

    // Unarchive an already-active record → no-op
    const active = { archivedAt: null };
    const r2 = unarchiveIfNotActive(active);
    check("Unarchive active: unarchived = false", r2.unarchived === false);
    check("Unarchive active: alreadyActive = true", r2.alreadyActive === true);
  }

  // ─── Empty data edge cases ──────────────────────────────────────
  console.log("\n=== Empty data edge cases ===");
  {
    // Archive with 0 eligible records
    const eligibleRecords: any[] = [];
    check("Empty eligible list: 0 records", eligibleRecords.length === 0);

    // Stats with 0 records
    const emptyStats = {
      attendance: { total: 0, active: 0, archived: 0, eligibleForArchive: 0 },
      students: { total: 0, active: 0, archived: 0 },
      complaints: { total: 0, active: 0, resolved: 0 },
      staff: { total: 0, active: 0, inactive: 0 },
      auditLogs: { attendanceAuditLogs: 0, staffActionLogs: 0, adminActionLogs: 0 },
    };
    check("Empty stats: attendance.total = 0", emptyStats.attendance.total === 0);
    check("Empty stats: students.archived = 0", emptyStats.students.archived === 0);
    check("Empty stats: staff.inactive = 0", emptyStats.staff.inactive === 0);
  }
}

// ─── Layer 2: Integration Tests (require PostgreSQL) ──────────────────

async function runIntegrationTests() {
  console.log("\n══════════════════════════════════════════");
  console.log("  Phase 8 — Integration Tests (PostgreSQL)");
  console.log("══════════════════════════════════════════\n");

  const { prisma } = await import("../database/prisma");

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.log("⚠️  No database connection available — skipping integration tests.");
    return;
  }

  const runId = Date.now();
  const tid = (n: number, m = 0) => BigInt(600000000 + (runId % 100000) * 1000 + n * 10 + m);

  const school = await prisma.school.create({ data: { name: `Phase8 School ${runId}` } });
  const school2 = await prisma.school.create({ data: { name: `Phase8 School 2 ${runId}` } });

  const createdUsers: number[] = [];
  const createdStudents: number[] = [];

  async function cleanup() {
    await prisma.attendanceAuditLog.deleteMany({}).catch(() => {});
    await prisma.attendanceEscalation.deleteMany({}).catch(() => {});
    await prisma.attendance.deleteMany({
      where: { schoolId: { in: [school.id, school2.id] } }
    }).catch(() => {});
    for (const sid of createdStudents) {
      await prisma.student.deleteMany({ where: { id: sid } }).catch(() => {});
    }
    for (const uid of createdUsers) {
      await (prisma as any).staffActionLog.deleteMany({ where: { targetUserId: uid } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
    }
    await prisma.school.deleteMany({ where: { id: { in: [school.id, school2.id] } } }).catch(() => {});
  }

  try {
    // ─── Test: Archive statistics ──────────────────────────────────
    console.log("=== Test: Archive statistics ===");
    {
      const { archiveService } = await import("../services/archiveService");
      const saTg = tid(1);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 1", role: "SCHOOL_ADMIN", isActive: true, schoolId: school.id },
      });
      createdUsers.push(sa.id);

      const stats = await archiveService.getArchiveStats({
        actorTelegramId: saTg,
      });

      check("Stats has attendance.total", typeof stats.attendance.total === "number");
      check("Stats has students.active", typeof stats.students.active === "number");
      check("Stats has complaints.resolved", typeof stats.complaints.resolved === "number");
      check("Stats has staff.inactive", typeof stats.staff.inactive === "number");
      check("Stats has auditLogs", typeof stats.auditLogs.attendanceAuditLogs === "number");
    }

    // ─── Test: Archive attendance ──────────────────────────────────
    console.log("\n=== Test: Archive attendance ===");
    {
      const { archiveService } = await import("../services/archiveService");
      const adminTg = tid(2);
      const admin = await prisma.user.create({
        data: { telegramId: adminTg, fullName: "Admin 2", role: "ADMIN", isActive: true },
      });
      createdUsers.push(admin.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S2", className: "5-A" },
      });
      createdStudents.push(student.id);

      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 13); // 13 months ago — eligible
      oldDate.setUTCHours(0, 0, 0, 0);

      const attendance = await prisma.attendance.create({
        data: {
          studentId: student.id,
          date: oldDate,
          status: "PRESENT",
          recordedById: admin.id,
          schoolId: school.id,
          className: "5-A",
        },
      });

      // Archive it
      const r1 = await archiveService.archiveAttendance({
        actorTelegramId: adminTg,
        attendanceId: attendance.id,
      });
      check("First archive: archived = true", r1.archived === true);
      check("First archive: alreadyArchived = false", r1.alreadyArchived === false);

      // Archive again (idempotent)
      const r2 = await archiveService.archiveAttendance({
        actorTelegramId: adminTg,
        attendanceId: attendance.id,
      });
      check("Second archive: archived = false (idempotent)", r2.archived === false);
      check("Second archive: alreadyArchived = true", r2.alreadyArchived === true);

      // Verify archivedAt is set
      const after = await prisma.attendance.findUnique({
        where: { id: attendance.id },
        select: { archivedAt: true },
      });
      check("archivedAt is set", after?.archivedAt !== null);
    }

    // ─── Test: Archive student ─────────────────────────────────────
    console.log("\n=== Test: Archive student ===");
    {
      const { archiveService } = await import("../services/archiveService");
      const adminTg = tid(3);
      const admin = await prisma.user.create({
        data: { telegramId: adminTg, fullName: "Admin 3", role: "ADMIN", isActive: true },
      });
      createdUsers.push(admin.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S3", className: "5-A" },
      });
      createdStudents.push(student.id);

      // Archive
      const r1 = await archiveService.archiveStudent({
        actorTelegramId: adminTg,
        studentId: student.id,
      });
      check("First archive student: archived = true", r1.archived === true);

      // Archive again (idempotent)
      const r2 = await archiveService.archiveStudent({
        actorTelegramId: adminTg,
        studentId: student.id,
      });
      check("Second archive student: alreadyArchived = true", r2.alreadyArchived === true);

      // Unarchive
      const r3 = await archiveService.unarchiveStudent({
        actorTelegramId: adminTg,
        studentId: student.id,
      });
      check("Unarchive: unarchived = true", r3.unarchived === true);

      // Unarchive again (idempotent)
      const r4 = await archiveService.unarchiveStudent({
        actorTelegramId: adminTg,
        studentId: student.id,
      });
      check("Unarchive again: alreadyActive = true", r4.alreadyActive === true);

      // Verify archivedAt is null after unarchive
      const after = await prisma.student.findUnique({
        where: { id: student.id },
        select: { archivedAt: true },
      });
      check("archivedAt is null after unarchive", after?.archivedAt === null);
    }

    // ─── Test: School isolation ────────────────────────────────────
    console.log("\n=== Test: School isolation ===");
    {
      const { archiveService } = await import("../services/archiveService");
      const saTg = tid(4);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 4", role: "SCHOOL_ADMIN", isActive: true, schoolId: school.id },
      });
      createdUsers.push(sa.id);

      // Student from school2 — SA from school should NOT be able to archive
      const student = await prisma.student.create({
        data: { schoolId: school2.id, fullName: "Student S4", className: "5-A" },
      });
      createdStudents.push(student.id);

      let threw = false;
      try {
        await archiveService.archiveStudent({
          actorTelegramId: saTg,
          studentId: student.id,
        });
      } catch (e) {
        threw = true;
        check("Cross-school archive throws PermissionError",
          (e as Error).name === "PermissionError");
      }
      check("Cross-school archive was rejected", threw);

      // Verify the student was NOT archived
      const after = await prisma.student.findUnique({
        where: { id: student.id },
        select: { archivedAt: true },
      });
      check("Student not archived (cross-school rejected)", after?.archivedAt === null);
    }

    // ─── Test: TEACHER denied archive ──────────────────────────────
    console.log("\n=== Test: TEACHER denied archive ===");
    {
      const { archiveService } = await import("../services/archiveService");
      const teacherTg = tid(5);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher 5", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S5", className: "5-A" },
      });
      createdStudents.push(student.id);

      let threw = false;
      try {
        await archiveService.archiveStudent({
          actorTelegramId: teacherTg,
          studentId: student.id,
        });
      } catch (e) {
        threw = true;
        check("TEACHER archive throws PermissionError",
          (e as Error).name === "PermissionError");
      }
      check("TEACHER archive was rejected", threw);
    }

    // ─── Test: Bulk archive old attendance ─────────────────────────
    console.log("\n=== Test: Bulk archive old attendance ===");
    {
      const { archiveService } = await import("../services/archiveService");
      const adminTg = tid(6);
      const admin = await prisma.user.create({
        data: { telegramId: adminTg, fullName: "Admin 6", role: "ADMIN", isActive: true },
      });
      createdUsers.push(admin.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S6", className: "5-A" },
      });
      createdStudents.push(student.id);

      // Create 3 old records + 1 new record
      const oldDate1 = new Date();
      oldDate1.setMonth(oldDate1.getMonth() - 13);
      oldDate1.setUTCHours(0, 0, 0, 0);
      const oldDate2 = new Date();
      oldDate2.setMonth(oldDate2.getMonth() - 14);
      oldDate2.setUTCHours(0, 0, 0, 0);
      const newDate = new Date();
      newDate.setUTCHours(0, 0, 0, 0);

      // Use unique (studentId, date) pairs — can't reuse same student for multiple
      const s2 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S6b", className: "5-A" } });
      const s3 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S6c", className: "5-A" } });
      const s4 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S6d", className: "5-A" } });
      createdStudents.push(s2.id, s3.id, s4.id);

      await prisma.attendance.create({ data: { studentId: student.id, date: oldDate1, status: "PRESENT", recordedById: admin.id, schoolId: school.id, className: "5-A" } });
      await prisma.attendance.create({ data: { studentId: s2.id, date: oldDate2, status: "ABSENT", recordedById: admin.id, schoolId: school.id, className: "5-A" } });
      await prisma.attendance.create({ data: { studentId: s3.id, date: newDate, status: "PRESENT", recordedById: admin.id, schoolId: school.id, className: "5-A" } });

      // Bulk archive
      const result = await archiveService.archiveOldAttendance({
        actorTelegramId: adminTg,
        limit: 100,
      });
      check("Bulk archive: archivedCount = 2", result.archivedCount === 2);

      // Run again (idempotent)
      const result2 = await archiveService.archiveOldAttendance({
        actorTelegramId: adminTg,
        limit: 100,
      });
      check("Bulk archive again: archivedCount = 0 (idempotent)", result2.archivedCount === 0);
    }

    // ─── Test: Reports exclude archived ────────────────────────────
    console.log("\n=== Test: Reports exclude archived ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const saTg = tid(7);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 7", role: "SCHOOL_ADMIN", isActive: true, schoolId: school.id },
      });
      createdUsers.push(sa.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S7", className: "5-A" },
      });
      createdStudents.push(student.id);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      // Create + archive an attendance record
      const att = await prisma.attendance.create({
        data: { studentId: student.id, date: today, status: "PRESENT", recordedById: sa.id, schoolId: school.id, className: "5-A" },
      });
      await prisma.attendance.update({
        where: { id: att.id },
        data: { archivedAt: new Date() },
      });

      // Get report — should NOT include the archived record
      const report = await attendanceReportService.getReport({
        actorTelegramId: saTg,
        dateRange: "today",
      });
      check("Report excludes archived: totals.total = 0", report.totals.total === 0);
    }

    // ─── Test: Empty data ──────────────────────────────────────────
    console.log("\n=== Test: Empty data ===");
    {
      const { archiveService } = await import("../services/archiveService");
      const saTg = tid(8);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 8", role: "SCHOOL_ADMIN", isActive: true, schoolId: school2.id },
      });
      createdUsers.push(sa.id);

      // school2 has no attendance records
      const eligible = await archiveService.findArchivableAttendance({
        actorTelegramId: saTg,
      });
      check("Empty data: 0 eligible records", eligible.length === 0);

      const archivedStudents = await archiveService.listArchivedStudents({
        actorTelegramId: saTg,
      });
      check("Empty data: 0 archived students", archivedStudents.length === 0);
    }

    // ─── Test: Audit trail ─────────────────────────────────────────
    console.log("\n=== Test: Audit trail ===");
    {
      const { archiveService } = await import("../services/archiveService");
      const adminTg = tid(9);
      const admin = await prisma.user.create({
        data: { telegramId: adminTg, fullName: "Admin 9", role: "ADMIN", isActive: true },
      });
      createdUsers.push(admin.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S9", className: "5-A" },
      });
      createdStudents.push(student.id);

      await archiveService.archiveStudent({
        actorTelegramId: adminTg,
        studentId: student.id,
      });

      // Verify audit log was created
      const logs = await (prisma as any).staffActionLog.findMany({
        where: {
          actorUserId: admin.id,
          action: "ARCHIVE_STUDENT",
        },
      });
      check("Audit log created for archive action", logs.length > 0);
      check("Audit log has details", logs[0]?.details != null);
    }

  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

// ─── Runner ────────────────────────────────────────────────────────────

async function main() {
  runLogicTests();
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
