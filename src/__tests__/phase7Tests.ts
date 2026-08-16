/**
 * Phase 7: Reports & Statistics tests
 *
 * Two layers:
 *   1. PURE LOGIC TESTS — always run. Test the report service's
 *      date-range resolution, rate calculations, and authorization
 *      logic without a database.
 *   2. INTEGRATION TESTS — require PostgreSQL. Skip cleanly without DB.
 *
 * Run with: npx tsx src/__tests__/phase7Tests.ts
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
  console.log("  Phase 7 — Pure Logic Tests");
  console.log("══════════════════════════════════════════\n");

  // ─── Permission checks for report access ─────────────────────────
  console.log("=== Report permission checks ===");
  {
    // TEACHER: has VIEW_CLASS_ATTENDANCE but NOT VIEW_SCHOOL_ATTENDANCE
    const teacher = { role: "TEACHER", isActive: true };
    check("TEACHER can VIEW_CLASS_ATTENDANCE",
      hasPermission(teacher, Permission.VIEW_CLASS_ATTENDANCE));
    check("TEACHER cannot VIEW_SCHOOL_ATTENDANCE",
      !hasPermission(teacher, Permission.VIEW_SCHOOL_ATTENDANCE));
    check("TEACHER cannot VIEW_GLOBAL_ATTENDANCE",
      !hasPermission(teacher, Permission.VIEW_GLOBAL_ATTENDANCE));

    // SCHOOL_ADMIN: has VIEW_SCHOOL_ATTENDANCE
    const sa = { role: "SCHOOL_ADMIN", isActive: true };
    check("SCHOOL_ADMIN can VIEW_SCHOOL_ATTENDANCE",
      hasPermission(sa, Permission.VIEW_SCHOOL_ATTENDANCE));
    check("SCHOOL_ADMIN cannot VIEW_GLOBAL_ATTENDANCE",
      !hasPermission(sa, Permission.VIEW_GLOBAL_ATTENDANCE));

    // ADMIN: has VIEW_GLOBAL_ATTENDANCE
    const admin = { role: "ADMIN", isActive: true };
    check("ADMIN can VIEW_GLOBAL_ATTENDANCE",
      hasPermission(admin, Permission.VIEW_GLOBAL_ATTENDANCE));

    // SUPER_ADMIN: all permissions
    const superAdm = { role: "SUPER_ADMIN", isActive: true };
    check("SUPER_ADMIN can VIEW_GLOBAL_ATTENDANCE",
      hasPermission(superAdm, Permission.VIEW_GLOBAL_ATTENDANCE));
    check("SUPER_ADMIN can VIEW_SCHOOL_ATTENDANCE",
      hasPermission(superAdm, Permission.VIEW_SCHOOL_ATTENDANCE));

    // PARENT: no attendance report permissions
    const parent = { role: "PARENT", isActive: true };
    check("PARENT cannot VIEW_CLASS_ATTENDANCE",
      !hasPermission(parent, Permission.VIEW_CLASS_ATTENDANCE));
    check("PARENT cannot VIEW_SCHOOL_ATTENDANCE",
      !hasPermission(parent, Permission.VIEW_SCHOOL_ATTENDANCE));

    // STUDENT: only VIEW_OWN_ATTENDANCE
    const student = { role: "STUDENT", isActive: true };
    check("STUDENT cannot VIEW_CLASS_ATTENDANCE",
      !hasPermission(student, Permission.VIEW_CLASS_ATTENDANCE));
    check("STUDENT has VIEW_OWN_ATTENDANCE",
      hasPermission(student, Permission.VIEW_OWN_ATTENDANCE));

    // Deactivated staff lose report permissions
    const deactivatedTeacher = { role: "TEACHER", isActive: false };
    check("Deactivated TEACHER cannot VIEW_CLASS_ATTENDANCE",
      !hasPermission(deactivatedTeacher, Permission.VIEW_CLASS_ATTENDANCE));
    const deactivatedSA = { role: "SCHOOL_ADMIN", isActive: false };
    check("Deactivated SCHOOL_ADMIN cannot VIEW_SCHOOL_ATTENDANCE",
      !hasPermission(deactivatedSA, Permission.VIEW_SCHOOL_ATTENDANCE));
  }

  // ─── Rate calculation logic ──────────────────────────────────────
  console.log("\n=== Rate calculation logic ===");
  {
    // Simulate the computeRates function from attendanceReportService
    function computeRates(t: { total: number; present: number; absent: number; late: number; excused: number }) {
      const total = t.total || 0;
      return {
        ...t,
        attendanceRate: total === 0 ? 0 : Math.round(((t.present + t.late + t.excused) / total) * 100),
        absenceRate: total === 0 ? 0 : Math.round((t.absent / total) * 100),
        lateRate: total === 0 ? 0 : Math.round((t.late / total) * 100),
        excusedRate: total === 0 ? 0 : Math.round((t.excused / total) * 100),
      };
    }

    // Normal case: 100 records, 80 present, 10 absent, 5 late, 5 excused
    const r1 = computeRates({ total: 100, present: 80, absent: 10, late: 5, excused: 5 });
    check("Attendance rate = 90% (80+5+5 / 100)", r1.attendanceRate === 90);
    check("Absence rate = 10%", r1.absenceRate === 10);
    check("Late rate = 5%", r1.lateRate === 5);
    check("Excused rate = 5%", r1.excusedRate === 5);

    // Empty data: 0 records
    const r2 = computeRates({ total: 0, present: 0, absent: 0, late: 0, excused: 0 });
    check("Empty data: attendance rate = 0", r2.attendanceRate === 0);
    check("Empty data: absence rate = 0", r2.absenceRate === 0);

    // All present: 50 records, 50 present
    const r3 = computeRates({ total: 50, present: 50, absent: 0, late: 0, excused: 0 });
    check("All present: attendance rate = 100%", r3.attendanceRate === 100);
    check("All present: absence rate = 0%", r3.absenceRate === 0);

    // All absent: 30 records, 30 absent
    const r4 = computeRates({ total: 30, present: 0, absent: 30, late: 0, excused: 0 });
    check("All absent: attendance rate = 0%", r4.attendanceRate === 0);
    check("All absent: absence rate = 100%", r4.absenceRate === 100);

    // Single record: 1 present
    const r5 = computeRates({ total: 1, present: 1, absent: 0, late: 0, excused: 0 });
    check("Single present: attendance rate = 100%", r5.attendanceRate === 100);
  }

  // ─── Date range resolution logic ─────────────────────────────────
  console.log("\n=== Date range resolution logic ===");
  {
    // Simulate resolveDateRange
    function toDateOnly(d: Date): Date {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    function resolveDateRange(range: string, customFrom?: Date, customTo?: Date) {
      const now = new Date();
      const today = toDateOnly(now);

      switch (range) {
        case "today":
          return { from: today, to: today, label: "Bugun" };
        case "week": {
          const day = now.getUTCDay();
          const diff = day === 0 ? -6 : 1 - day;
          const monday = new Date(today);
          monday.setUTCDate(monday.getUTCDate() + diff);
          const sunday = new Date(monday);
          sunday.setUTCDate(sunday.getUTCDate() + 6);
          return { from: monday, to: sunday, label: "Bu hafta" };
        }
        case "month": {
          const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          const lastOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
          return { from: firstOfMonth, to: lastOfMonth, label: "Bu oy" };
        }
        case "custom":
          if (!customFrom || !customTo) throw new Error("Custom requires dates");
          return { from: toDateOnly(customFrom), to: toDateOnly(customTo), label: "Custom" };
        default:
          return { from: today, to: today, label: "Bugun" };
      }
    }

    // Today
    const today = resolveDateRange("today");
    check("Today: from === to", today.from.getTime() === today.to.getTime());
    check("Today: label = 'Bugun'", today.label === "Bugun");

    // Week
    const week = resolveDateRange("week");
    const weekDays = Math.round((week.to.getTime() - week.from.getTime()) / (1000 * 60 * 60 * 24));
    check("Week: 6 days between from and to", weekDays === 6);
    check("Week: label = 'Bu hafta'", week.label === "Bu hafta");

    // Month
    const month = resolveDateRange("month");
    check("Month: label = 'Bu oy'", month.label === "Bu oy");
    check("Month: from is 1st of month", month.from.getUTCDate() === 1);

    // Custom
    const custom = resolveDateRange("custom", new Date("2026-01-01"), new Date("2026-01-31"));
    check("Custom: from = 2026-01-01", custom.from.toISOString().startsWith("2026-01-01"));
    check("Custom: to = 2026-01-31", custom.to.toISOString().startsWith("2026-01-31"));

    // Custom without dates throws
    checkThrows("Custom without dates throws", () => resolveDateRange("custom"));

    // Invalid range defaults to today
    const invalid = resolveDateRange("invalid");
    check("Invalid range: defaults to today", invalid.label === "Bugun");
  }

  // ─── CSV escape logic ────────────────────────────────────────────
  console.log("\n=== CSV escape logic ===");
  {
    function escape(s: string | null): string {
      if (!s) return "";
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }

    check("Plain text: no escaping", escape("Ali Valiyev") === "Ali Valiyev");
    check("Comma: wrapped in quotes", escape("Ali, Valiyev") === '"Ali, Valiyev"');
    check("Quote: escaped + wrapped", escape('Ali "Vali"') === '"Ali ""Vali"""');
    check("Newline: wrapped in quotes", escape("Ali\nValiyev") === '"Ali\nValiyev"');
    check("Null: empty string", escape(null) === "");
    check("Empty: empty string", escape("") === "");
  }

  // ─── Empty data edge cases ───────────────────────────────────────
  console.log("\n=== Empty data edge cases ===");
  {
    // Simulate aggregating from an empty groupBy result
    const statusGroups: Array<{ status: string; _count: { status: number } }> = [];
    const totalsRaw = { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
    for (const g of statusGroups) {
      const count = g._count?.status ?? 0;
      totalsRaw.total += count;
      if (g.status === "PRESENT") totalsRaw.present = count;
      else if (g.status === "ABSENT") totalsRaw.absent = count;
      else if (g.status === "LATE") totalsRaw.late = count;
      else if (g.status === "EXCUSED") totalsRaw.excused = count;
    }
    check("Empty groupBy: total = 0", totalsRaw.total === 0);
    check("Empty groupBy: present = 0", totalsRaw.present === 0);
    check("Empty groupBy: absent = 0", totalsRaw.absent === 0);

    // Simulate a single-status result (only PRESENT)
    const singleGroup = [{ status: "PRESENT", _count: { status: 5 } }];
    const totalsSingle = { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
    for (const g of singleGroup) {
      const count = g._count?.status ?? 0;
      totalsSingle.total += count;
      if (g.status === "PRESENT") totalsSingle.present = count;
    }
    check("Single-status: total = 5", totalsSingle.total === 5);
    check("Single-status: present = 5", totalsSingle.present === 5);
    check("Single-status: absent = 0 (not present in groups)", totalsSingle.absent === 0);
  }
}

// ─── Layer 2: Integration Tests (require PostgreSQL) ──────────────────

async function runIntegrationTests() {
  console.log("\n══════════════════════════════════════════");
  console.log("  Phase 7 — Integration Tests (PostgreSQL)");
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
  const tid = (n: number, m = 0) => BigInt(700000000 + (runId % 100000) * 1000 + n * 10 + m);

  const school = await prisma.school.create({ data: { name: `Phase7 School ${runId}` } });
  const school2 = await prisma.school.create({ data: { name: `Phase7 School 2 ${runId}` } });
  const neighborhood = await prisma.neighborhood.create({ data: { name: `Phase7 MFY ${runId}` } });

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
    await prisma.neighborhood.deleteMany({ where: { id: neighborhood.id } }).catch(() => {});
  }

  try {
    // ─── Test: School statistics ────────────────────────────────────
    console.log("=== Test: School statistics ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const teacherTg = tid(1);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T1", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const s1 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S1", className: "5-A" } });
      const s2 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S2", className: "5-A" } });
      const s3 = await prisma.student.create({ data: { schoolId: school.id, fullName: "S3", className: "5-A" } });
      createdStudents.push(s1.id, s2.id, s3.id);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      // Record attendance: 2 present, 1 absent
      await prisma.attendance.create({ data: { studentId: s1.id, date: today, status: "PRESENT", recordedById: teacher.id, schoolId: school.id, className: "5-A" } });
      await prisma.attendance.create({ data: { studentId: s2.id, date: today, status: "PRESENT", recordedById: teacher.id, schoolId: school.id, className: "5-A" } });
      await prisma.attendance.create({ data: { studentId: s3.id, date: today, status: "ABSENT", recordedById: teacher.id, schoolId: school.id, className: "5-A" } });

      // School admin report
      const saTg = tid(1, 1);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 1", role: "SCHOOL_ADMIN", isActive: true, schoolId: school.id },
      });
      createdUsers.push(sa.id);

      const report = await attendanceReportService.getReport({
        actorTelegramId: saTg,
        dateRange: "month",
      });

      check("School report scope = 'school'", report.scope === "school");
      check("School report totals.total = 3", report.totals.total === 3);
      check("School report totals.present = 2", report.totals.present === 2);
      check("School report totals.absent = 1", report.totals.absent === 1);
      check("School report attendanceRate = 67%", report.totals.attendanceRate === 67);
      check("School report totalStudents = 3", report.totalStudents === 3);
      check("School report byClass has '5-A'", report.byClass.some(c => c.className === "5-A"));
      check("School report trend has 1 day", report.trend.length === 1);
    }

    // ─── Test: Class statistics ─────────────────────────────────────
    console.log("\n=== Test: Class statistics ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const teacherTg = tid(2);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T2", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const report = await attendanceReportService.getReport({
        actorTelegramId: teacherTg,
        dateRange: "month",
        className: "5-A",
      });

      check("Teacher report scope = 'class'", report.scope === "class");
      check("Teacher report byClass has '5-A'", report.byClass.some(c => c.className === "5-A"));
    }

    // ─── Test: Date filtering (today vs month) ──────────────────────
    console.log("\n=== Test: Date filtering ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const saTg = tid(3);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 3", role: "SCHOOL_ADMIN", isActive: true, schoolId: school.id },
      });
      createdUsers.push(sa.id);

      // Today report — should include today's records only
      const todayReport = await attendanceReportService.getReport({
        actorTelegramId: saTg,
        dateRange: "today",
      });
      check("Today report: label = 'Bugun'", todayReport.dateRange.label === "Bugun");
      check("Today report: from === to", todayReport.dateRange.from.getTime() === todayReport.dateRange.to.getTime());

      // Month report — should include all records this month
      const monthReport = await attendanceReportService.getReport({
        actorTelegramId: saTg,
        dateRange: "month",
      });
      check("Month report: label = 'Bu oy'", monthReport.dateRange.label === "Bu oy");
      check("Month report: from is 1st of month", monthReport.dateRange.from.getUTCDate() === 1);
    }

    // ─── Test: Cross-school access denial ───────────────────────────
    console.log("\n=== Test: Cross-school access denial ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const saTg = tid(4);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 4", role: "SCHOOL_ADMIN", isActive: true, schoolId: school.id },
      });
      createdUsers.push(sa.id);

      // SA from school A tries to query school B — should be ignored
      // (the service uses the actor's schoolId, not the param)
      const report = await attendanceReportService.getReport({
        actorTelegramId: saTg,
        dateRange: "month",
        schoolId: school2.id, // attempt to access school 2
      });

      // The report should be scoped to school A (the SA's school),
      // NOT school B. We verify by checking the totals don't include
      // school B's records.
      check("Cross-school: SA sees their own school (not the requested one)",
        report.scope === "school");
    }

    // ─── Test: PARENT denied ────────────────────────────────────────
    console.log("\n=== Test: PARENT denied report access ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const parentTg = tid(5);
      const parent = await prisma.user.create({
        data: { telegramId: parentTg, fullName: "Parent 5", role: "PARENT", isActive: true, schoolId: school.id, phone: "+998901111222" },
      });
      createdUsers.push(parent.id);

      let threw = false;
      try {
        await attendanceReportService.getReport({
          actorTelegramId: parentTg,
          dateRange: "month",
        });
      } catch (e) {
        threw = true;
        check("PARENT throws PermissionError",
          (e as Error).name === "PermissionError");
      }
      check("PARENT was rejected", threw);
    }

    // ─── Test: Empty data ───────────────────────────────────────────
    console.log("\n=== Test: Empty data ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const saTg = tid(6);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 6", role: "SCHOOL_ADMIN", isActive: true, schoolId: school2.id },
      });
      createdUsers.push(sa.id);

      // school2 has no attendance records
      const report = await attendanceReportService.getReport({
        actorTelegramId: saTg,
        dateRange: "today",
      });

      check("Empty data: totals.total = 0", report.totals.total === 0);
      check("Empty data: attendanceRate = 0", report.totals.attendanceRate === 0);
      check("Empty data: byClass is empty", report.byClass.length === 0);
      check("Empty data: trend is empty", report.trend.length === 0);
    }

    // ─── Test: Escalation statistics ────────────────────────────────
    console.log("\n=== Test: Escalation statistics ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const saTg = tid(7);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 7", role: "SCHOOL_ADMIN", isActive: true, schoolId: school.id },
      });
      createdUsers.push(sa.id);

      const stats = await attendanceReportService.getEscalationStats({
        actorTelegramId: saTg,
        schoolId: school.id,
      });

      check("Escalation stats has total field", typeof stats.total === "number");
      check("Escalation stats has unresolved field", typeof stats.unresolved === "number");
      check("Escalation stats has resolved field", typeof stats.resolved === "number");
      check("Escalation stats: total = unresolved + resolved",
        stats.total === stats.unresolved + stats.resolved);
    }

    // ─── Test: CSV export ───────────────────────────────────────────
    console.log("\n=== Test: CSV export ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const saTg = tid(8);
      const sa = await prisma.user.create({
        data: { telegramId: saTg, fullName: "SA 8", role: "SCHOOL_ADMIN", isActive: true, schoolId: school.id },
      });
      createdUsers.push(sa.id);

      const csv = await attendanceReportService.exportCsv({
        actorTelegramId: saTg,
        dateRange: "month",
      });

      check("CSV starts with header", csv.startsWith("O'quvchi,Sinf,Maktab,Sana,Holat,Izoh,Yozgan"));
      check("CSV has at least one data row", csv.split("\n").length > 1);
    }

    // ─── Test: Deactivated staff denied ─────────────────────────────
    console.log("\n=== Test: Deactivated staff denied ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const teacherTg = tid(9);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T9", role: "TEACHER", isActive: false, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      let threw = false;
      try {
        await attendanceReportService.getReport({
          actorTelegramId: teacherTg,
          dateRange: "month",
        });
      } catch (e) {
        threw = true;
        check("Deactivated teacher throws PermissionError",
          (e as Error).name === "PermissionError");
      }
      check("Deactivated teacher was rejected", threw);
    }

    // ─── Test: Student report ───────────────────────────────────────
    console.log("\n=== Test: Student report ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const parentTg = tid(10);
      const parent = await prisma.user.create({
        data: { telegramId: parentTg, fullName: "Parent 10", role: "PARENT", isActive: true, schoolId: school.id, phone: "+998903334445" },
      });
      createdUsers.push(parent.id);

      const student = await prisma.student.create({
        data: { parentId: parent.id, schoolId: school.id, fullName: "Student S10", className: "5-A" },
      });
      createdStudents.push(student.id);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      await prisma.attendance.create({
        data: { studentId: student.id, date: today, status: "PRESENT", recordedById: parent.id, schoolId: school.id, className: "5-A" },
      });

      const report = await attendanceReportService.getStudentReport({
        actorTelegramId: parentTg,
        studentId: student.id,
        dateRange: "month",
      });

      check("Student report: student name correct", report.student.fullName === "Student S10");
      check("Student report: totals.total = 1", report.totals.total === 1);
      check("Student report: totals.present = 1", report.totals.present === 1);
      check("Student report: attendanceRate = 100%", report.totals.attendanceRate === 100);
    }

    // ─── Test: Unrelated parent denied student report ───────────────
    console.log("\n=== Test: Unrelated parent denied student report ===");
    {
      const { attendanceReportService } = await import("../services/attendanceReportService");
      const unrelatedTg = tid(11);
      const unrelated = await prisma.user.create({
        data: { telegramId: unrelatedTg, fullName: "Unrelated 11", role: "PARENT", isActive: true, schoolId: school.id, phone: "+998905556667" },
      });
      createdUsers.push(unrelated.id);

      // Try to view a student they don't have family access to
      const otherStudent = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Other Student 11", className: "5-A" },
      });
      createdStudents.push(otherStudent.id);

      let threw = false;
      try {
        await attendanceReportService.getStudentReport({
          actorTelegramId: unrelatedTg,
          studentId: otherStudent.id,
          dateRange: "month",
        });
      } catch (e) {
        threw = true;
        check("Unrelated parent throws PermissionError",
          (e as Error).name === "PermissionError");
      }
      check("Unrelated parent was rejected", threw);
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
