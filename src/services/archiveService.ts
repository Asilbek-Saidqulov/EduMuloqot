/**
 * Phase 8: Archive Service
 *
 * Provides lifecycle/archive management for attendance and students.
 * Uses soft-archive (archivedAt timestamp) — no data is moved or deleted.
 *
 * Archive policy:
 *   - Attendance older than 12 months → eligible for archive
 *   - Students marked archived by admin (graduated/transferred/left)
 *   - Complaints: status RESOLVED/REJECTED = historical (no archive flag needed)
 *   - Staff: User.isActive=false = historical (no archive flag needed)
 *   - Audit logs: append-only, never archived
 *
 * All operations:
 *   - Validate actor permissions (VIEW_ARCHIVE / MANAGE_ARCHIVE)
 *   - Enforce school isolation from trusted DB records
 *   - Are idempotent (archiving an already-archived record is a no-op)
 *   - Log archive actions to StaffActionLog for audit trail
 */
import { prisma } from "../database/prisma";
import {
  Permission,
  hasPermission,
  canAccessSchool,
  getEffectiveRole,
  PermissionError,
} from "../auth/permissions";

// ─── Archive policy ───────────────────────────────────────────────────

/** Attendance older than this many months is eligible for archival. */
export const ATTENDANCE_ARCHIVE_AGE_MONTHS = 12;

/**
 * Get the cutoff date for attendance archival.
 * Attendance records with date < cutoff are eligible.
 */
export function getAttendanceCutoffDate(asOf: Date = new Date()): Date {
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - ATTENDANCE_ARCHIVE_AGE_MONTHS);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

// ─── Types ────────────────────────────────────────────────────────────

export interface ArchiveStats {
  attendance: {
    total: number;
    active: number;
    archived: number;
    eligibleForArchive: number;  // active records older than cutoff
  };
  students: {
    total: number;
    active: number;
    archived: number;
  };
  complaints: {
    total: number;
    active: number;        // NEW/ASSIGNED/IN_PROGRESS
    resolved: number;      // RESOLVED/REJECTED (historical)
  };
  staff: {
    total: number;
    active: number;
    inactive: number;
  };
  auditLogs: {
    attendanceAuditLogs: number;
    staffActionLogs: number;
    adminActionLogs: number;
  };
}

export interface ArchivableAttendance {
  id: number;
  studentId: number;
  studentName: string;
  date: Date;
  status: string;
  schoolId: number;
  className: string;
}

export interface ArchivedStudent {
  id: number;
  fullName: string;
  className: string;
  schoolId: number;
  schoolName: string;
  archivedAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function resolveActor(telegramId: bigint) {
  const [user, admin] = await Promise.all([
    prisma.user.findUnique({
      where: { telegramId },
      select: {
        id: true, telegramId: true, fullName: true,
        role: true, isActive: true, schoolId: true, neighborhoodId: true,
      },
    }),
    prisma.admin.findUnique({
      where: { telegramId },
      select: { id: true, role: true, isActive: true, schoolId: true, neighborhoodId: true },
    }),
  ]);
  if (!user) return null;
  return { user, admin };
}

function getActorSchoolId(actor: {
  user: { schoolId: number | null };
  admin: { isActive: boolean; schoolId: number | null } | null;
}): number | null {
  if (actor.admin?.isActive && actor.admin.schoolId != null) {
    return actor.admin.schoolId;
  }
  return actor.user.schoolId;
}

function requireViewArchive(actor: {
  user: { role: string; isActive: boolean };
  admin: { role: string; isActive: boolean } | null;
}): void {
  if (!hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_ARCHIVE,
    actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive } : null
  )) {
    throw new PermissionError("Sizda arxiv ma'lumotlarini ko'rish huquqi yo'q.");
  }
}

function requireManageArchive(actor: {
  user: { role: string; isActive: boolean };
  admin: { role: string; isActive: boolean } | null;
}): void {
  if (!hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.MANAGE_ARCHIVE,
    actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive } : null
  )) {
    throw new PermissionError("Sizda arxiv operatsiyalarini bajarish huquqi yo'q.");
  }
}

/**
 * Log an archive action to StaffActionLog for audit trail.
 */
async function logArchiveAction(params: {
  actorUserId: number;
  action: string;          // ARCHIVE_ATTENDANCE, UNARCHIVE_STUDENT, etc.
  targetType: string;      // "Attendance", "Student"
  targetId: number;
  schoolId?: number;
  details?: Record<string, any>;
}): Promise<void> {
  try {
    await (prisma as any).staffActionLog.create({
      data: {
        actorUserId: params.actorUserId,
        targetUserId: params.actorUserId, // self-reference (archive actions don't target a User)
        action: params.action,
        details: JSON.stringify({
          targetType: params.targetType,
          targetId: params.targetId,
          schoolId: params.schoolId ?? null,
          ...params.details,
        }),
        schoolId: params.schoolId ?? null,
      },
    });
  } catch (err) {
    // Audit log failure should NOT block the archive operation
    console.error("Failed to log archive action:", (err as Error).message);
  }
}

// ─── Service ──────────────────────────────────────────────────────────

export const archiveService = {
  /**
   * Get archive statistics for the actor's scope.
   *
   * SCHOOL_ADMIN: own school only
   * ADMIN/SUPER_ADMIN: global
   * MAHALLA_RESPONSIBLE: own neighborhood (escalations only — limited stats)
   */
  async getArchiveStats(params: {
    actorTelegramId: bigint;
  }): Promise<ArchiveStats> {
    const { actorTelegramId } = params;
    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    requireViewArchive(actor);

    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );

    // Build school filter
    let schoolFilter: any = {};
    if (effectiveRole === "SCHOOL_ADMIN") {
      const schoolId = getActorSchoolId(actor);
      if (!schoolId) throw new PermissionError("Sizga maktab biriktirilmagan.");
      schoolFilter = { schoolId };
    }

    const cutoff = getAttendanceCutoffDate();

    // Attendance stats
    const [attTotal, attActive, attArchived, attEligible] = await Promise.all([
      prisma.attendance.count({ where: schoolFilter }),
      prisma.attendance.count({ where: { ...schoolFilter, archivedAt: null } }),
      prisma.attendance.count({ where: { ...schoolFilter, NOT: { archivedAt: null } } }),
      prisma.attendance.count({
        where: {
          ...schoolFilter,
          archivedAt: null,
          date: { lt: cutoff },
        },
      }),
    ]);

    // Student stats
    const [studTotal, studActive, studArchived] = await Promise.all([
      prisma.student.count({ where: schoolFilter }),
      prisma.student.count({ where: { ...schoolFilter, archivedAt: null } }),
      prisma.student.count({ where: { ...schoolFilter, NOT: { archivedAt: null } } }),
    ]);

    // Complaint stats
    const [compTotal, compActive, compResolved] = await Promise.all([
      prisma.complaint.count({ where: schoolFilter }),
      prisma.complaint.count({
        where: { ...schoolFilter, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] } },
      }),
      prisma.complaint.count({
        where: { ...schoolFilter, status: { in: ["RESOLVED", "REJECTED"] } },
      }),
    ]);

    // Staff stats
    const [staffTotal, staffActive, staffInactive] = await Promise.all([
      prisma.user.count({
        where: {
          ...schoolFilter,
          role: { in: ["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN", "MAHALLA_RESPONSIBLE", "ADMIN", "SUPER_ADMIN"] },
        },
      }),
      prisma.user.count({
        where: {
          ...schoolFilter,
          role: { in: ["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN", "MAHALLA_RESPONSIBLE", "ADMIN", "SUPER_ADMIN"] },
          isActive: true,
        },
      }),
      prisma.user.count({
        where: {
          ...schoolFilter,
          role: { in: ["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN", "MAHALLA_RESPONSIBLE", "ADMIN", "SUPER_ADMIN"] },
          isActive: false,
        },
      }),
    ]);

    // Audit log counts (global — these are system-wide audit trails)
    const [attAuditLogs, staffLogs, adminLogs] = await Promise.all([
      prisma.attendanceAuditLog.count(),
      (prisma as any).staffActionLog.count(),
      (prisma as any).adminActionLog.count(),
    ]);

    return {
      attendance: {
        total: attTotal,
        active: attActive,
        archived: attArchived,
        eligibleForArchive: attEligible,
      },
      students: {
        total: studTotal,
        active: studActive,
        archived: studArchived,
      },
      complaints: {
        total: compTotal,
        active: compActive,
        resolved: compResolved,
      },
      staff: {
        total: staffTotal,
        active: staffActive,
        inactive: staffInactive,
      },
      auditLogs: {
        attendanceAuditLogs: attAuditLogs,
        staffActionLogs: staffLogs,
        adminActionLogs: adminLogs,
      },
    };
  },

  /**
   * Find attendance records eligible for archival (older than cutoff, not yet archived).
   *
   * Authorization: VIEW_ARCHIVE + school isolation.
   */
  async findArchivableAttendance(params: {
    actorTelegramId: bigint;
    limit?: number;
  }): Promise<ArchivableAttendance[]> {
    const { actorTelegramId, limit = 100 } = params;
    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    requireViewArchive(actor);

    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );

    const cutoff = getAttendanceCutoffDate();
    const where: any = {
      archivedAt: null,
      date: { lt: cutoff },
    };

    if (effectiveRole === "SCHOOL_ADMIN") {
      const schoolId = getActorSchoolId(actor);
      if (!schoolId) throw new PermissionError("Sizga maktab biriktirilmagan.");
      where.schoolId = schoolId;
    }

    const records = await prisma.attendance.findMany({
      where,
      select: {
        id: true, studentId: true, date: true, status: true,
        schoolId: true, className: true,
        student: { select: { fullName: true } },
      },
      orderBy: { date: "asc" },
      take: limit,
    });

    return records.map(r => ({
      id: r.id,
      studentId: r.studentId,
      studentName: r.student?.fullName ?? "Noma'lum",
      date: r.date,
      status: r.status,
      schoolId: r.schoolId,
      className: r.className,
    }));
  },

  /**
   * Archive a single attendance record.
   * Idempotent: if already archived, returns { alreadyArchived: true }.
   *
   * Authorization: MANAGE_ARCHIVE + school isolation.
   */
  async archiveAttendance(params: {
    actorTelegramId: bigint;
    attendanceId: number;
  }): Promise<{ archived: boolean; alreadyArchived: boolean }> {
    const { actorTelegramId, attendanceId } = params;
    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    requireManageArchive(actor);

    const record = await prisma.attendance.findUnique({
      where: { id: attendanceId },
      select: { id: true, schoolId: true, archivedAt: true, date: true },
    });
    if (!record) throw new PermissionError("Davomat yozuvi topilmadi.");

    // Idempotency: already archived
    if (record.archivedAt) {
      return { archived: false, alreadyArchived: true };
    }

    // School isolation
    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );
    if (effectiveRole !== "SUPER_ADMIN" && effectiveRole !== "ADMIN") {
      const actorSchoolId = getActorSchoolId(actor);
      if (record.schoolId !== actorSchoolId) {
        throw new PermissionError("Sizda ushbu maktab uchun arxiv huquqi yo'q.");
      }
    }

    // Archive (soft — set archivedAt)
    await prisma.attendance.update({
      where: { id: attendanceId },
      data: { archivedAt: new Date() },
    });

    // Audit log
    await logArchiveAction({
      actorUserId: actor.user.id,
      action: "ARCHIVE_ATTENDANCE",
      targetType: "Attendance",
      targetId: attendanceId,
      schoolId: record.schoolId,
      details: { date: record.date.toISOString() },
    });

    return { archived: true, alreadyArchived: false };
  },

  /**
   * Bulk archive attendance records older than the cutoff.
   * Idempotent: already-archived records are skipped.
   *
   * Authorization: MANAGE_ARCHIVE + school isolation.
   *
   * @returns count of newly-archived records
   */
  async archiveOldAttendance(params: {
    actorTelegramId: bigint;
    limit?: number;
  }): Promise<{ archivedCount: number; alreadyArchivedCount: number }> {
    const { actorTelegramId, limit = 1000 } = params;
    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    requireManageArchive(actor);

    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );

    const cutoff = getAttendanceCutoffDate();
    const where: any = {
      archivedAt: null,
      date: { lt: cutoff },
    };

    if (effectiveRole === "SCHOOL_ADMIN") {
      const schoolId = getActorSchoolId(actor);
      if (!schoolId) throw new PermissionError("Sizga maktab biriktirilmagan.");
      where.schoolId = schoolId;
    }

    // Find eligible records
    const eligible = await prisma.attendance.findMany({
      where,
      select: { id: true, schoolId: true, date: true },
      take: limit,
    });

    if (eligible.length === 0) {
      return { archivedCount: 0, alreadyArchivedCount: 0 };
    }

    // Bulk update: set archivedAt
    const now = new Date();
    const result = await prisma.attendance.updateMany({
      where: { id: { in: eligible.map(r => r.id) } },
      data: { archivedAt: now },
    });

    // Audit log (one summary entry for the bulk operation)
    await logArchiveAction({
      actorUserId: actor.user.id,
      action: "ARCHIVE_ATTENDANCE_BULK",
      targetType: "Attendance",
      targetId: 0, // bulk — no single target
      schoolId: effectiveRole === "SCHOOL_ADMIN" ? getActorSchoolId(actor) ?? undefined : undefined,
      details: {
        count: result.count,
        cutoff: cutoff.toISOString(),
        archivedAt: now.toISOString(),
      },
    });

    return { archivedCount: result.count, alreadyArchivedCount: 0 };
  },

  /**
   * Archive a student (mark as graduated/transferred/left).
   * Idempotent: if already archived, returns { alreadyArchived: true }.
   *
   * Authorization: MANAGE_ARCHIVE + school isolation.
   */
  async archiveStudent(params: {
    actorTelegramId: bigint;
    studentId: number;
  }): Promise<{ archived: boolean; alreadyArchived: boolean }> {
    const { actorTelegramId, studentId } = params;
    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    requireManageArchive(actor);

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, schoolId: true, archivedAt: true, fullName: true },
    });
    if (!student) throw new PermissionError("O'quvchi topilmadi.");

    // Idempotency
    if (student.archivedAt) {
      return { archived: false, alreadyArchived: true };
    }

    // School isolation
    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );
    if (effectiveRole !== "SUPER_ADMIN" && effectiveRole !== "ADMIN") {
      const actorSchoolId = getActorSchoolId(actor);
      if (student.schoolId !== actorSchoolId) {
        throw new PermissionError("Sizda ushbu maktab uchun arxiv huquqi yo'q.");
      }
    }

    // Archive (soft)
    await prisma.student.update({
      where: { id: studentId },
      data: { archivedAt: new Date() },
    });

    // Audit log
    await logArchiveAction({
      actorUserId: actor.user.id,
      action: "ARCHIVE_STUDENT",
      targetType: "Student",
      targetId: studentId,
      schoolId: student.schoolId,
      details: { studentName: student.fullName },
    });

    return { archived: true, alreadyArchived: false };
  },

  /**
   * Unarchive a student (restore to active).
   * Idempotent: if already active, returns { alreadyActive: true }.
   *
   * Authorization: MANAGE_ARCHIVE + school isolation.
   */
  async unarchiveStudent(params: {
    actorTelegramId: bigint;
    studentId: number;
  }): Promise<{ unarchived: boolean; alreadyActive: boolean }> {
    const { actorTelegramId, studentId } = params;
    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    requireManageArchive(actor);

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, schoolId: true, archivedAt: true, fullName: true },
    });
    if (!student) throw new PermissionError("O'quvchi topilmadi.");

    // Idempotency
    if (!student.archivedAt) {
      return { unarchived: false, alreadyActive: true };
    }

    // School isolation
    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );
    if (effectiveRole !== "SUPER_ADMIN" && effectiveRole !== "ADMIN") {
      const actorSchoolId = getActorSchoolId(actor);
      if (student.schoolId !== actorSchoolId) {
        throw new PermissionError("Sizda ushbu maktab uchun arxiv huquqi yo'q.");
      }
    }

    // Unarchive
    await prisma.student.update({
      where: { id: studentId },
      data: { archivedAt: null },
    });

    // Audit log
    await logArchiveAction({
      actorUserId: actor.user.id,
      action: "UNARCHIVE_STUDENT",
      targetType: "Student",
      targetId: studentId,
      schoolId: student.schoolId,
      details: { studentName: student.fullName },
    });

    return { unarchived: true, alreadyActive: false };
  },

  /**
   * List archived students for the actor's scope.
   *
   * Authorization: VIEW_ARCHIVE + school isolation.
   */
  async listArchivedStudents(params: {
    actorTelegramId: bigint;
    limit?: number;
  }): Promise<ArchivedStudent[]> {
    const { actorTelegramId, limit = 50 } = params;
    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    requireViewArchive(actor);

    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );

    const where: any = { NOT: { archivedAt: null } };
    if (effectiveRole === "SCHOOL_ADMIN") {
      const schoolId = getActorSchoolId(actor);
      if (!schoolId) throw new PermissionError("Sizga maktab biriktirilmagan.");
      where.schoolId = schoolId;
    }

    const students = await prisma.student.findMany({
      where,
      select: {
        id: true, fullName: true, className: true, schoolId: true, archivedAt: true,
        school: { select: { name: true } },
      },
      orderBy: { archivedAt: "desc" },
      take: limit,
    });

    return students.map(s => ({
      id: s.id,
      fullName: s.fullName,
      className: s.className,
      schoolId: s.schoolId,
      schoolName: s.school?.name ?? "",
      archivedAt: s.archivedAt!,
    }));
  },

  /**
   * Search archived attendance records.
   *
   * Authorization: VIEW_ARCHIVE + school isolation.
   */
  async searchArchivedAttendance(params: {
    actorTelegramId: bigint;
    fromDate?: Date;
    toDate?: Date;
    schoolId?: number;
    limit?: number;
  }): Promise<any[]> {
    const { actorTelegramId, fromDate, toDate, limit = 50 } = params;
    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    requireViewArchive(actor);

    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );

    const where: any = { NOT: { archivedAt: null } };
    if (effectiveRole === "SCHOOL_ADMIN") {
      const schoolId = getActorSchoolId(actor);
      if (!schoolId) throw new PermissionError("Sizga maktab biriktirilmagan.");
      where.schoolId = schoolId;
    } else if (effectiveRole === "ADMIN" || effectiveRole === "SUPER_ADMIN") {
      if (params.schoolId) where.schoolId = params.schoolId;
    }

    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = fromDate;
      if (toDate) where.date.lte = toDate;
    }

    return prisma.attendance.findMany({
      where,
      select: {
        id: true, date: true, status: true, className: true, archivedAt: true,
        student: { select: { fullName: true } },
        school: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: limit,
    });
  },
};
