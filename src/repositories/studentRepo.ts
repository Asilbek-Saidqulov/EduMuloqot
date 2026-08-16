import { StudentVerificationStatus } from "@prisma/client";
import { prisma } from "../database/prisma";

export const studentRepo = {
  async create(params: { parentId: number; schoolId: number; fullName: string; className: string }) {
    return prisma.student.create({ data: params });
  },

  /** Parent's own students only - privacy enforcement */
  async listByParent(parentId: number) {
    return prisma.student.findMany({
      where: { parentId },
      include: { school: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Find student by ID, ensuring it belongs to the parent */
  async findByIdForParent(id: number, parentId: number) {
    return prisma.student.findFirst({
      where: { id, parentId },
      include: { school: true },
    });
  },

  /** Find student by ID, ensuring it belongs to the school */
  async findByIdForSchool(id: number, schoolId: number) {
    return prisma.student.findFirst({
      where: { id, schoolId },
      include: { parent: true, school: true },
    });
  },

  /**
   * List pending students for a specific school — ONLY claimed students
   * (parentId IS NOT NULL). Unlinked registry students (parentId = null)
   * must NOT appear in the admin approval queue.
   */
  async listPendingBySchool(schoolId: number) {
    return prisma.student.findMany({
      where: {
        schoolId,
        verificationStatus: StudentVerificationStatus.PENDING,
        parentId: { not: null },
      },
      include: { parent: true, school: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Update verification status */
  async updateVerificationStatus(id: number, status: StudentVerificationStatus) {
    return prisma.student.update({
      where: { id },
      data: { verificationStatus: status },
    });
  },

  /**
   * Update only the student's full name. Preserves id, schoolId, parentId,
   * className, verificationStatus, and createdAt. Used by the Child Edit
   * conversation.
   */
  async updateFullName(id: number, fullName: string) {
    return prisma.student.update({
      where: { id },
      data: { fullName },
    });
  },

  /**
   * Update only the student's class. Preserves id, schoolId, parentId,
   * fullName, verificationStatus, and createdAt. Used by the Child Edit
   * conversation.
   */
  async updateClassName(id: number, className: string) {
    return prisma.student.update({
      where: { id },
      data: { className },
    });
  },

  /** Check if student exists with same name and class for same parent (duplicate check) */
  async findByParentAndNameAndClass(parentId: number, fullName: string, className: string) {
    return prisma.student.findFirst({
      where: { parentId, fullName, className },
    });
  },

  // ─── Registry search & claim methods ──────────────────────────────

  /**
   * Search for unlinked students (parentId = null) in a specific school
   * whose fullName contains any of the provided tokens (case-insensitive).
   *
   * This returns a candidate set for fuzzy matching. The caller should
   * then run the name matcher on each candidate to score and rank them.
   *
   * Uses ILIKE for initial DB-level filtering to avoid loading the entire
   * school's registry into memory. Each token is searched separately,
   * and results are deduplicated.
   */
  async searchUnlinkedBySchool(schoolId: number, tokens: string[]): Promise<any[]> {
    if (tokens.length === 0) return [];

    // Build OR conditions for each token — ILIKE %token%
    const conditions = tokens.map((t) => ({
      fullName: { contains: t, mode: "insensitive" as const },
    }));

    return prisma.student.findMany({
      where: {
        schoolId,
        parentId: null,
        OR: conditions,
      },
      select: {
        id: true,
        fullName: true,
        className: true,
        birthDate: true,
        pinfl: true,
        schoolId: true,
      },
      take: 50, // Limit to 50 candidates to avoid excessive processing
    });
  },

  /**
   * Find an unlinked student by PINFL in a specific school.
   * Returns null if not found or if the student is already linked.
   */
  async findUnlinkedByPinfl(pinfl: string, schoolId: number) {
    return prisma.student.findFirst({
      where: { pinfl, schoolId, parentId: null },
      select: {
        id: true,
        fullName: true,
        className: true,
        birthDate: true,
        pinfl: true,
        schoolId: true,
      },
    });
  },

  /**
   * Find a student by PINFL in a specific school (regardless of link status).
   * Used to check if a student with this PINFL is already claimed.
   */
  async findByPinflAndSchool(pinfl: string, schoolId: number) {
    return prisma.student.findFirst({
      where: { pinfl, schoolId },
      select: {
        id: true,
        fullName: true,
        className: true,
        birthDate: true,
        pinfl: true,
        parentId: true,
      },
    });
  },

  /**
   * Atomically claim a student for a parent.
   *
   * Uses a database transaction with row-level locking (SELECT FOR UPDATE)
   * to prevent race conditions: if two parents try to claim the same
   * student simultaneously, only one will succeed.
   *
   * Defense-in-depth: also verifies the student belongs to the specified
   * school — so even if a parent somehow obtains a student ID from another
   * school, the claim is rejected.
   *
   * Returns the updated student if the claim succeeded, or null if the
   * student was already claimed by someone else, doesn't exist, or
   * doesn't belong to the specified school.
   */
  async claimStudent(studentId: number, parentId: number, schoolId: number): Promise<any | null> {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the row and check parentId is still null AND schoolId matches
      const student = await tx.$queryRaw<any[]>`
        SELECT id, "parentId", "schoolId" FROM "students"
        WHERE id = ${studentId}
        FOR UPDATE
      `;

      if (student.length === 0) return null;
      if (student[0].parentId !== null) return null;
      if (student[0].schoolId !== schoolId) return null;

      // Atomically set parentId and verificationStatus.
      // Phase 5+: Auto-verify (VERIFIED) instead of PENDING. Students
      // in the database are pre-validated via Excel import — if a
      // parent successfully claims a student (the student exists in
      // the school's registry and wasn't already claimed), the claim
      // is trusted. Manual school-admin approval is no longer required.
      const updated = await tx.student.update({
        where: { id: studentId },
        data: {
          parentId,
          verificationStatus: StudentVerificationStatus.VERIFIED,
        },
        include: { school: true },
      });

      return updated;
    });

    return result;
  },
};
