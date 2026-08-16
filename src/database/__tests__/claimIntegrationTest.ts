/**
 * Claim flow integration tests.
 *
 * These tests require a real PostgreSQL database connection.
 * Run with: npx tsx src/database/__tests__/claimIntegrationTest.ts
 *
 * The tests create temporary test data (school, users, students), run
 * claim operations, verify results, and clean up afterwards.
 *
 * If no DATABASE_URL is configured, the tests skip with a message.
 */

import { prisma } from "../prisma";
import { studentRepo } from "../../repositories/studentRepo";
import { studentService } from "../../services/studentService";

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  if (cond) pass++; else fail++;
}

async function main() {
  // Check DB connection
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.log("⚠️  No database connection available — skipping integration tests.");
    console.log("   To run these tests, set DATABASE_URL in .env and run:");
    console.log("   npx tsx src/database/__tests__/claimIntegrationTest.ts");
    process.exit(0);
  }

  console.log("══════════════════════════════════════════");
  console.log("  Claim Flow Integration Tests");
  console.log("══════════════════════════════════════════\n");

  // Pre-cleanup: delete leftover test data from previous crashed runs.
  // The claim test uses hardcoded telegramIds 900001-900003 and test
  // schools named "Test School *". Without this, a re-run after a
  // crash would hit P2002 on the unique telegramId constraint.
  console.log("🧹 Pre-cleanup: removing leftover claim test data...");
  await prisma.student.deleteMany({
    where: { school: { name: { startsWith: "Test School" } } }
  }).catch(() => {});
  await prisma.user.deleteMany({
    where: { telegramId: { in: [BigInt(900001), BigInt(900002), BigInt(900003)] } }
  }).catch(() => {});
  await prisma.school.deleteMany({
    where: { name: { startsWith: "Test School" } }
  }).catch(() => {});
  console.log("✅ Pre-cleanup complete.\n");

  // ─── Setup: create test school, parents, students ──────────────
  const school = await prisma.school.create({ data: { name: "Test School " + Date.now() } });
  const school2 = await prisma.school.create({ data: { name: "Test School 2 " + Date.now() } });

  const parent1 = await prisma.user.create({
    data: { telegramId: BigInt(900001), fullName: "Test Parent 1", schoolId: school.id },
  });
  const parent2 = await prisma.user.create({
    data: { telegramId: BigInt(900002), fullName: "Test Parent 2", schoolId: school.id },
  });
  const parentOtherSchool = await prisma.user.create({
    data: { telegramId: BigInt(900003), fullName: "Other School Parent", schoolId: school2.id },
  });

  // ─── Test A: Successful claim ──────────────────────────────────
  console.log("=== Test A: Successful claim ===");
  {
    const student = await prisma.student.create({
      data: {
        parentId: null,
        schoolId: school.id,
        fullName: "Aliyev Muhammad Anvar o'g'li",
        className: "8-A",
        pinfl: "10000000000001",
        birthDate: new Date("2010-03-15"),
      },
    });

    const claimed = await studentRepo.claimStudent(student.id, parent1.id, school.id);

    check("Claim returns non-null result", claimed !== null);
    check("parentId is set to parent1", claimed?.parentId === parent1.id);
    check("verificationStatus is PENDING", claimed?.verificationStatus === "PENDING");
    check("fullName preserved", claimed?.fullName === "Aliyev Muhammad Anvar o'g'li");
    check("className preserved", claimed?.className === "8-A");
    check("pinfl preserved", claimed?.pinfl === "10000000000001");
    check("birthDate preserved", claimed?.birthDate?.toISOString().startsWith("2010-03-15") === true);
    check("schoolId preserved", claimed?.schoolId === school.id);

    // Cleanup
    await prisma.student.delete({ where: { id: student.id } });
  }

  // ─── Test B: Already-claimed student ───────────────────────────
  console.log("\n=== Test B: Already-claimed student ===");
  {
    const student = await prisma.student.create({
      data: {
        parentId: parent1.id,
        schoolId: school.id,
        fullName: "Aliyeva Madina",
        className: "7-B",
        verificationStatus: "VERIFIED",
      },
    });

    // Try to claim with parent2
    const claimed = await studentRepo.claimStudent(student.id, parent2.id, school.id);

    check("Claim returns null (already claimed)", claimed === null);

    // Verify original parent is unchanged
    const after = await prisma.student.findUnique({ where: { id: student.id } });
    check("parentId unchanged (still parent1)", after?.parentId === parent1.id);
    check("verificationStatus unchanged (still VERIFIED)", after?.verificationStatus === "VERIFIED");

    await prisma.student.delete({ where: { id: student.id } });
  }

  // ─── Test C: Cross-school claim ────────────────────────────────
  console.log("\n=== Test C: Cross-school claim ===");
  {
    const student = await prisma.student.create({
      data: {
        parentId: null,
        schoolId: school.id,
        fullName: "Karimov Rustam",
        className: "9-A",
        pinfl: "10000000000003",
      },
    });

    // parentOtherSchool is from school2, trying to claim a student from school
    const claimed = await studentRepo.claimStudent(student.id, parentOtherSchool.id, school2.id);

    check("Claim returns null (cross-school)", claimed === null);

    // Verify student is unchanged
    const after = await prisma.student.findUnique({ where: { id: student.id } });
    check("parentId still null", after?.parentId === null);
    check("verificationStatus still PENDING", after?.verificationStatus === "PENDING");

    await prisma.student.delete({ where: { id: student.id } });
  }

  // ─── Test D: Concurrent claim ──────────────────────────────────
  console.log("\n=== Test D: Concurrent claim ===");
  {
    const student = await prisma.student.create({
      data: {
        parentId: null,
        schoolId: school.id,
        fullName: "Yusupov Bobur",
        className: "5-V",
        pinfl: "10000000000004",
      },
    });

    // Fire two claims concurrently
    const [result1, result2] = await Promise.all([
      studentRepo.claimStudent(student.id, parent1.id, school.id),
      studentRepo.claimStudent(student.id, parent2.id, school.id),
    ]);

    const successCount = [result1, result2].filter((r) => r !== null).length;
    const failureCount = [result1, result2].filter((r) => r === null).length;

    check("Exactly 1 claim succeeds", successCount === 1);
    check("Exactly 1 claim fails", failureCount === 1);

    // Verify final state
    const after = await prisma.student.findUnique({ where: { id: student.id } });
    check("Student has exactly one parent", after?.parentId === parent1.id || after?.parentId === parent2.id);
    check("Student is not assigned to both parents", !(after?.parentId === parent1.id && after?.parentId === parent2.id));
    check("verificationStatus is PENDING", after?.verificationStatus === "PENDING");

    await prisma.student.delete({ where: { id: student.id } });
  }

  // ─── Test E: Replayed claim (idempotency) ─────────────────────
  console.log("\n=== Test E: Replayed claim ===");
  {
    const student = await prisma.student.create({
      data: {
        parentId: null,
        schoolId: school.id,
        fullName: "Saidova Dilnoza",
        className: "6-D",
        pinfl: "10000000000005",
      },
    });

    // First claim succeeds
    const first = await studentRepo.claimStudent(student.id, parent1.id, school.id);
    check("First claim succeeds", first !== null);

    // Second claim (replay) fails
    const second = await studentRepo.claimStudent(student.id, parent1.id, school.id);
    check("Second claim (replay) returns null", second === null);

    // Third claim by different parent also fails
    const third = await studentRepo.claimStudent(student.id, parent2.id, school.id);
    check("Third claim (different parent) returns null", third === null);

    // Verify no duplicate
    const after = await prisma.student.findUnique({ where: { id: student.id } });
    check("parentId is parent1 (not overwritten)", after?.parentId === parent1.id);

    await prisma.student.delete({ where: { id: student.id } });
  }

  // ─── Test F: Admin approval idempotency ────────────────────────
  console.log("\n=== Test F: Admin approval idempotency ===");
  {
    const student = await prisma.student.create({
      data: {
        parentId: parent1.id,
        schoolId: school.id,
        fullName: "Test Student Approval",
        className: "3-A",
        verificationStatus: "PENDING",
      },
    });

    // First approval
    await studentService.approveStudent(student.id, school.id);
    let after = await prisma.student.findUnique({ where: { id: student.id } });
    check("First approval: status = VERIFIED", after?.verificationStatus === "VERIFIED");

    // Second approval (replay) — should be idempotent
    await studentService.approveStudent(student.id, school.id);
    after = await prisma.student.findUnique({ where: { id: student.id } });
    check("Second approval: still VERIFIED (idempotent)", after?.verificationStatus === "VERIFIED");

    // Now reject — should change from VERIFIED to REJECTED
    await studentService.rejectStudent(student.id, school.id);
    after = await prisma.student.findUnique({ where: { id: student.id } });
    check("Reject after approve: status = REJECTED", after?.verificationStatus === "REJECTED");

    // Second reject (replay) — should be idempotent
    await studentService.rejectStudent(student.id, school.id);
    after = await prisma.student.findUnique({ where: { id: student.id } });
    check("Second reject: still REJECTED (idempotent)", after?.verificationStatus === "REJECTED");

    await prisma.student.delete({ where: { id: student.id } });
  }

  // ─── Test G: searchUnlinkedBySchool excludes linked students ───
  console.log("\n=== Test G: Search excludes linked students ===");
  {
    const unlinked = await prisma.student.create({
      data: {
        parentId: null,
        schoolId: school.id,
        fullName: "Unlinked Test Student",
        className: "4-A",
        pinfl: "10000000000007",
      },
    });

    const linked = await prisma.student.create({
      data: {
        parentId: parent1.id,
        schoolId: school.id,
        fullName: "Linked Test Student",
        className: "4-A",
        pinfl: "10000000000008",
      },
    });

    const results = await studentRepo.searchUnlinkedBySchool(school.id, ["TEST"]);
    const ids = results.map((r: any) => r.id);

    check("Unlinked student appears in search", ids.includes(unlinked.id));
    check("Linked student does NOT appear in search", !ids.includes(linked.id));

    await prisma.student.delete({ where: { id: unlinked.id } });
    await prisma.student.delete({ where: { id: linked.id } });
  }

  // ─── Test H: listPendingBySchool excludes unlinked students ────
  console.log("\n=== Test H: listPendingBySchool excludes unlinked ===");
  {
    const unlinked = await prisma.student.create({
      data: {
        parentId: null,
        schoolId: school.id,
        fullName: "Unlinked Pending Student",
        className: "2-B",
        verificationStatus: "PENDING",
      },
    });

    const linkedPending = await prisma.student.create({
      data: {
        parentId: parent1.id,
        schoolId: school.id,
        fullName: "Linked Pending Student",
        className: "2-B",
        verificationStatus: "PENDING",
      },
    });

    const pending = await studentRepo.listPendingBySchool(school.id);
    const ids = pending.map((s) => s.id);

    check("Linked pending student appears", ids.includes(linkedPending.id));
    check("Unlinked pending student does NOT appear", !ids.includes(unlinked.id));

    await prisma.student.delete({ where: { id: unlinked.id } });
    await prisma.student.delete({ where: { id: linkedPending.id } });
  }

  // ─── Cleanup ───────────────────────────────────────────────────
  await prisma.user.deleteMany({ where: { id: { in: [parent1.id, parent2.id, parentOtherSchool.id] } } });
  await prisma.school.deleteMany({ where: { id: { in: [school.id, school2.id] } } });

  console.log(`\n══════════════════════════════════════════`);
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log(`══════════════════════════════════════════`);

  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
