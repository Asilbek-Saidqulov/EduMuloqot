/**
 * Phase 10 Hardening Tests
 *
 * Tests for:
 *   - absenceReason authorization (Risk 1)
 *   - Subject integrity enforcement (Risk 2)
 *
 * Run with: npx tsx src/__tests__/phase10HardeningTests.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test:test_token";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";

import {
  canSeeAbsenceReason,
  filterAttendanceForActor,
} from "../utils/attendanceDto";

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  if (cond) pass++; else fail++;
}

// ─── Layer 1: Pure Logic Tests ────────────────────────────────────────

function runLogicTests() {
  console.log("══════════════════════════════════════════");
  console.log("  Phase 10 Hardening — Logic Tests");
  console.log("══════════════════════════════════════════\n");

  // ─── absenceReason authorization ────────────────────────────────
  console.log("=== absenceReason authorization ===");
  {
    const record = { schoolId: 1, className: "11-A" };

    // CLASS_TEACHER assigned to 11-A at school 1 → YES
    check("CLASS_TEACHER (11-A, school 1) can see reason",
      canSeeAbsenceReason({ role: "CLASS_TEACHER", schoolId: 1, assignedClassName: "11-A" }, record));

    // CLASS_TEACHER assigned to 11-B → NO
    check("CLASS_TEACHER (11-B) cannot see reason for 11-A",
      !canSeeAbsenceReason({ role: "CLASS_TEACHER", schoolId: 1, assignedClassName: "11-B" }, record));

    // CLASS_TEACHER from another school → NO
    check("CLASS_TEACHER (school 2) cannot see reason for school 1",
      !canSeeAbsenceReason({ role: "CLASS_TEACHER", schoolId: 2, assignedClassName: "11-A" }, record));

    // SUBJECT_TEACHER → NO
    check("TEACHER cannot see reason",
      !canSeeAbsenceReason({ role: "TEACHER", schoolId: 1 }, record));

    // PARENT → NO
    check("PARENT cannot see reason",
      !canSeeAbsenceReason({ role: "PARENT", schoolId: 1 }, record));

    // STUDENT → NO
    check("STUDENT cannot see reason",
      !canSeeAbsenceReason({ role: "STUDENT", schoolId: 1 }, record));

    // SCHOOL_ADMIN → YES (own school)
    check("SCHOOL_ADMIN (school 1) can see reason",
      canSeeAbsenceReason({ role: "SCHOOL_ADMIN", schoolId: 1 }, record));

    // SCHOOL_ADMIN from another school → NO
    check("SCHOOL_ADMIN (school 2) cannot see reason for school 1",
      !canSeeAbsenceReason({ role: "SCHOOL_ADMIN", schoolId: 2 }, record));

    // ADMIN → YES (global)
    check("ADMIN can see reason",
      canSeeAbsenceReason({ role: "ADMIN", schoolId: null }, record));

    // SUPER_ADMIN → YES (global)
    check("SUPER_ADMIN can see reason",
      canSeeAbsenceReason({ role: "SUPER_ADMIN", schoolId: null }, record));

    // MAHALLA_RESPONSIBLE → NO
    check("MAHALLA_RESPONSIBLE cannot see reason",
      !canSeeAbsenceReason({ role: "MAHALLA_RESPONSIBLE", schoolId: 1 }, record));
  }

  // ─── filterAttendanceForActor ──────────────────────────────────
  console.log("\n=== filterAttendanceForActor ===");
  {
    const rawRecord = {
      id: 1,
      date: new Date("2026-08-16"),
      status: "ABSENT",
      note: null,
      subject: "Matematika",
      schoolId: 1,
      className: "11-A",
      studentId: 100,
      recordedById: 200,
      absenceReason: "Kasal",
    };

    // CLASS_TEACHER authorized → reason present
    const classTeacherResult = filterAttendanceForActor(rawRecord, {
      role: "CLASS_TEACHER", schoolId: 1, assignedClassName: "11-A",
    });
    check("CLASS_TEACHER gets absenceReason",
      classTeacherResult.absenceReason === "Kasal");
    check("CLASS_TEACHER gets subject",
      classTeacherResult.subject === "Matematika");

    // TEACHER unauthorized → reason omitted
    const teacherResult = filterAttendanceForActor(rawRecord, {
      role: "TEACHER", schoolId: 1,
    });
    check("TEACHER does NOT get absenceReason (undefined)",
      classTeacherResult.absenceReason === "Kasal" && teacherResult.absenceReason === undefined);

    // PARENT unauthorized → reason omitted
    const parentResult = filterAttendanceForActor(rawRecord, {
      role: "PARENT", schoolId: 1,
    });
    check("PARENT does NOT get absenceReason (undefined)",
      parentResult.absenceReason === undefined);

    // CLASS_TEACHER different class → reason omitted
    const otherClassResult = filterAttendanceForActor(rawRecord, {
      role: "CLASS_TEACHER", schoolId: 1, assignedClassName: "11-B",
    });
    check("CLASS_TEACHER (11-B) does NOT get reason for 11-A",
      otherClassResult.absenceReason === undefined);

    // Historical record with subject=null → subject preserved as null
    const historicalRecord = { ...rawRecord, subject: null, absenceReason: null };
    const historicalResult = filterAttendanceForActor(historicalRecord, {
      role: "SUPER_ADMIN", schoolId: null,
    });
    check("Historical record: subject = null preserved",
      historicalResult.subject === null);
    check("Historical record: absenceReason = null → not included",
      historicalResult.absenceReason === undefined);
  }

  // ─── Subject integrity enforcement (logic) ─────────────────────
  console.log("\n=== Subject integrity enforcement ===");
  {
    // Simulate the enforcement logic
    function enforceSubject(role: string, teacherSubject: string | null, clientSubject?: string): string | undefined {
      if (role === "TEACHER") {
        if (!teacherSubject) throw new Error("No subject");
        return teacherSubject; // Override client subject
      }
      return clientSubject;
    }

    // TEACHER with subject → subject = teacherSubject (not client)
    check("TEACHER subject = teacherSubject (not client)",
      enforceSubject("TEACHER", "Matematika", "Informatika") === "Matematika");

    // TEACHER with subject, no client subject → subject = teacherSubject
    check("TEACHER subject = teacherSubject (no client)",
      enforceSubject("TEACHER", "Matematika") === "Matematika");

    // TEACHER without subject → throws
    let threw = false;
    try { enforceSubject("TEACHER", null); } catch { threw = true; }
    check("TEACHER without teacherSubject throws", threw);

    // CLASS_TEACHER → subject = clientSubject (may be null)
    check("CLASS_TEACHER subject = undefined (no client)",
      enforceSubject("CLASS_TEACHER", null) === undefined);

    check("CLASS_TEACHER subject = clientSubject",
      enforceSubject("CLASS_TEACHER", null, "Ona tili") === "Ona tili");
  }
}

// ─── Layer 2: Integration Tests (require PostgreSQL) ──────────────────

async function runIntegrationTests() {
  console.log("\n══════════════════════════════════════════");
  console.log("  Phase 10 Hardening — Integration Tests");
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
  const tid = (n: number, m = 0) => BigInt(400000000 + (runId % 100000) * 1000 + n * 10 + m);

  const school = await prisma.school.create({ data: { name: `P10H School ${runId}` } });
  const school2 = await prisma.school.create({ data: { name: `P10H School 2 ${runId}` } });

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
    // ─── Test: TEACHER with subject creates attendance with correct subject ──
    console.log("=== Test: TEACHER subject enforcement ===");
    {
      const { attendanceService } = await import("../services/attendanceService");
      const teacherTg = tid(1);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T1", role: "TEACHER", isActive: true, schoolId: school.id, teacherSubject: "Matematika" },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S1", className: "11-A" },
      });
      createdStudents.push(student.id);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const result = await attendanceService.recordAttendance({
        actorTelegramId: teacherTg,
        studentId: student.id,
        date: today,
        status: "ABSENT",
      });

      check("Attendance created", result.created === true);

      // Verify subject = "Matematika" (from teacher, not from client)
      const att = await prisma.attendance.findUnique({
        where: { studentId_date: { studentId: student.id, date: today } },
        select: { subject: true },
      });
      check("Attendance subject = Matematika (from teacher profile)", att?.subject === "Matematika");
    }

    // ─── Test: TEACHER without subject rejected ===
    console.log("\n=== Test: TEACHER without subject rejected ===");
    {
      const { attendanceService } = await import("../services/attendanceService");
      const teacherTg = tid(2);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T2", role: "TEACHER", isActive: true, schoolId: school.id },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S2", className: "11-A" },
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
      } catch (e) {
        threw = true;
        check("TEACHER without subject throws PermissionError",
          (e as Error).name === "PermissionError");
      }
      check("TEACHER without subject was rejected", threw);
    }

    // ─── Test: Subject override protection ===
    console.log("\n=== Test: Subject override protection ===");
    {
      const { attendanceService } = await import("../services/attendanceService");
      const teacherTg = tid(3);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T3", role: "TEACHER", isActive: true, schoolId: school.id, teacherSubject: "Fizika" },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S3", className: "11-A" },
      });
      createdStudents.push(student.id);

      // Try to pass a different subject via the service param
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      await attendanceService.bulkRecordAttendance({
        actorTelegramId: teacherTg,
        schoolId: school.id,
        className: "11-A",
        date: today,
        records: [{ studentId: student.id, status: "PRESENT" }],
        subject: "Informatika", // attempt to override
      });

      const att = await prisma.attendance.findUnique({
        where: { studentId_date: { studentId: student.id, date: today } },
        select: { subject: true },
      });
      check("Subject override blocked: stored = Fizika (not Informatika)",
        att?.subject === "Fizika");
    }

    // ─── Test: Historical NULL subject untouched ===
    console.log("\n=== Test: Historical NULL subject untouched ===");
    {
      const student = await prisma.student.create({
        data: { schoolId: school.id, fullName: "Student S4", className: "11-A" },
      });
      createdStudents.push(student.id);

      // Create a record with subject = null (simulating historical data)
      const oldDate = new Date("2025-01-01");
      await prisma.attendance.create({
        data: {
          studentId: student.id,
          date: oldDate,
          status: "PRESENT",
          recordedById: 1, // dummy
          schoolId: school.id,
          className: "11-A",
          subject: null,
        },
      });

      const att = await prisma.attendance.findUnique({
        where: { studentId_date: { studentId: student.id, date: oldDate } },
        select: { subject: true },
      });
      check("Historical record subject = null preserved", att?.subject === null);
    }

    // ─── Test: Cross-school attendance rejected ===
    console.log("\n=== Test: Cross-school attendance rejected ===");
    {
      const { attendanceService } = await import("../services/attendanceService");
      const teacherTg = tid(5);
      const teacher = await prisma.user.create({
        data: { telegramId: teacherTg, fullName: "Teacher T5", role: "TEACHER", isActive: true, schoolId: school.id, teacherSubject: "Matematika" },
      });
      createdUsers.push(teacher.id);

      const student = await prisma.student.create({
        data: { schoolId: school2.id, fullName: "Student S5", className: "11-A" },
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
      } catch (e) {
        threw = true;
        check("Cross-school attendance throws PermissionError",
          (e as Error).name === "PermissionError");
      }
      check("Cross-school attendance rejected", threw);
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
