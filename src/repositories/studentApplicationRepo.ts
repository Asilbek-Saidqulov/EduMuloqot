/**
 * Phase 5+: Student Application repository.
 *
 * Handles DB operations for student applications:
 *   - Create application
 *   - List pending applications by school
 *   - Find by ID
 *   - Update status (approve/reject)
 */
import { prisma } from "../database/prisma";

export const studentApplicationRepo = {
  /**
   * Create a new student application.
   */
  async create(params: {
    applicantUserId: number;
    fullName: string;
    schoolId: number;
    className?: string;
    phone?: string;
    note?: string;
  }) {
    return prisma.studentApplication.create({
      data: {
        applicantUserId: params.applicantUserId,
        fullName: params.fullName,
        schoolId: params.schoolId,
        className: params.className ?? null,
        phone: params.phone ?? null,
        note: params.note ?? null,
      },
      include: { school: true, applicant: true },
    });
  },

  /**
   * Find an application by ID.
   */
  async findById(id: number) {
    return prisma.studentApplication.findUnique({
      where: { id },
      include: {
        school: true,
        applicant: { select: { id: true, fullName: true, telegramId: true, phone: true } },
        resolver: { select: { id: true, fullName: true } },
        student: { select: { id: true, fullName: true, className: true } },
      },
    });
  },

  /**
   * List pending applications for a school.
   */
  async listPendingBySchool(schoolId: number) {
    return prisma.studentApplication.findMany({
      where: { schoolId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        applicant: { select: { id: true, fullName: true, telegramId: true, phone: true } },
      },
    });
  },

  /**
   * List all applications for a school (all statuses).
   */
  async listAllBySchool(schoolId: number) {
    return prisma.studentApplication.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      include: {
        applicant: { select: { id: true, fullName: true, telegramId: true, phone: true } },
        resolver: { select: { id: true, fullName: true } },
      },
    });
  },

  /**
   * List pending applications globally (for SUPER_ADMIN / ADMIN).
   */
  async listAllPending() {
    return prisma.studentApplication.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        school: { select: { id: true, name: true } },
        applicant: { select: { id: true, fullName: true, telegramId: true, phone: true } },
      },
    });
  },

  /**
   * Approve an application: create a Student record and link it.
   * Uses a transaction to ensure atomicity.
   *
   * @returns The created Student record, or null if the application
   *          was already resolved.
   */
  async approve(
    applicationId: number,
    resolvedById: number,
    className?: string
  ): Promise<{ student: any; application: any } | null> {
    return prisma.$transaction(async (tx) => {
      // Lock the application row
      const app = await tx.studentApplication.findUnique({
        where: { id: applicationId },
      });
      if (!app) return null;
      if (app.status !== "PENDING") return null;

      // Create the Student record
      const student = await tx.student.create({
        data: {
          schoolId: app.schoolId,
          fullName: app.fullName,
          className: className || app.className || "Belgilanmagan",
          parentId: null, // No parent — this is a student-user
          verificationStatus: "VERIFIED",
        },
      });

      // Update the application
      const updated = await tx.studentApplication.update({
        where: { id: applicationId },
        data: {
          status: "APPROVED",
          resolvedById,
          resolvedAt: new Date(),
          studentId: student.id,
          className: className || app.className,
        },
      });

      return { student, application: updated };
    });
  },

  /**
   * Reject an application.
   */
  async reject(
    applicationId: number,
    resolvedById: number,
    resolutionNote?: string
  ): Promise<any | null> {
    const app = await prisma.studentApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app || app.status !== "PENDING") return null;

    return prisma.studentApplication.update({
      where: { id: applicationId },
      data: {
        status: "REJECTED",
        resolvedById,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote ?? null,
      },
    });
  },

  /**
   * Check if a user already has a pending application for a school.
   * Prevents duplicate applications.
   */
  async hasPendingApplication(applicantUserId: number, schoolId: number): Promise<boolean> {
    const count = await prisma.studentApplication.count({
      where: { applicantUserId, schoolId, status: "PENDING" },
    });
    return count > 0;
  },
};
