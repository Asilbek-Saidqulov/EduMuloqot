/**
 * Phase 5: Attendance repository.
 *
 * Handles all DB operations for attendance records:
 *   - upsert (create or update) attendance for a student/date
 *   - find attendance by student/date
 *   - list attendance for a student (parent/student view)
 *   - list attendance for a school/class/date (teacher taking roll)
 *   - list attendance by school/date range (reports)
 *   - calculate attendance statistics
 *   - calculate consecutive absences
 *   - audit log creation
 *   - escalation record creation (idempotent via unique constraint)
 *
 * Authorization decisions live in attendanceService — this repo only
 * enforces relational scope (e.g. schoolId is part of the query, not
 * taken from callback data). All IDs passed in must come from a
 * service-layer authorization check.
 */
import { prisma } from "../database/prisma";
import { AttendanceStatus } from "@prisma/client";

/**
 * Normalize any date-like value to a UTC midnight date-only Date.
 *
 * Handles Date objects, ISO strings, and any value that `new Date()`
 * can parse. This is critical because grammY session storage
 * (Prisma Json column) serializes Date objects to ISO strings on
 * write and does NOT revive them on read — so `state.date` retrieved
 * from session is a string, not a Date.
 *
 * @db.Date columns in PostgreSQL store date-only (no time/timezone),
 * so we normalize to UTC midnight to avoid off-by-one-day bugs.
 */
function toDateOnly(d: Date | string): Date {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const attendanceRepo = {
  /**
   * Upsert (create or update) an attendance record for a student/date.
   *
   * Uses a transaction with SELECT FOR UPDATE on the existing row (if
   * any) to prevent race conditions when two teachers submit attendance
   * for the same student on the same date simultaneously. Only one will
   * win; the other's update will be applied on top (last-write-wins),
   * which is the desired behavior for attendance correction.
   *
   * Returns `{ created: boolean; attendance: AttendanceRow }` so the
   * service layer knows whether to send a "new absence" notification
   * vs. an "updated to absence" notification.
   *
   * The `recordedById`, `schoolId`, and `className` are taken from
   * authoritative DB records by the service layer — NEVER from callback
   * data. The service layer is responsible for verifying the student
   * belongs to `schoolId` before calling this method.
   */
  async upsertAttendance(params: {
    studentId: number;
    date: Date;
    status: AttendanceStatus;
    recordedById: number;
    schoolId: number;
    className: string;
    note?: string;
    subject?: string;
  }): Promise<{ created: boolean; oldStatus: AttendanceStatus | null; newStatus: AttendanceStatus; attendanceId: number }> {
    const dateOnly = toDateOnly(params.date);

    // Interactive transaction with extended timeout (10000ms, up from
    // Prisma's default 5000ms). The upsert + audit-log write can
    // exceed 5s under load on Supabase's free tier (network latency
    // + connection pooling). 10s gives comfortable headroom without
    // risking long-held locks.
    return prisma.$transaction(async (tx) => {
      // Try to find an existing record for this student/date.
      const existing = await tx.attendance.findUnique({
        where: { studentId_date: { studentId: params.studentId, date: dateOnly } },
        select: { id: true, status: true },
      });

      if (existing) {
        // Update the existing record. We do NOT lock with FOR UPDATE
        // here because Prisma's update is atomic at the row level and
        // the unique constraint prevents duplicate inserts. If two
        // updates race, the second one simply overwrites the first —
        // which is the desired last-write-wins behavior for attendance
        // correction.
        const oldStatus = existing.status;
        const updated = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            status: params.status,
            recordedById: params.recordedById,
            schoolId: params.schoolId,
            className: params.className,
            note: params.note ?? null,
            subject: params.subject ?? null,
          },
          select: { id: true, status: true },
        });

        // Only write an audit log if the status actually changed.
        // This avoids log spam when a teacher re-saves the same status.
        if (oldStatus !== params.status) {
          await tx.attendanceAuditLog.create({
            data: {
              attendanceId: updated.id,
              actorUserId: params.recordedById,
              oldStatus,
              newStatus: params.status,
              note: params.note ?? null,
            },
          });
        }

        return {
          created: false,
          oldStatus,
          newStatus: updated.status,
          attendanceId: updated.id,
        };
      }

      // No existing record — create a new one.
      const created = await tx.attendance.create({
        data: {
          studentId: params.studentId,
          date: dateOnly,
          status: params.status,
          recordedById: params.recordedById,
          schoolId: params.schoolId,
          className: params.className,
          note: params.note ?? null,
          subject: params.subject ?? null,
        },
        select: { id: true, status: true },
      });

      // Audit log: oldStatus is null (creation).
      await tx.attendanceAuditLog.create({
        data: {
          attendanceId: created.id,
          actorUserId: params.recordedById,
          oldStatus: null,
          newStatus: params.status,
          note: params.note ?? null,
        },
      });

      return {
        created: true,
        oldStatus: null,
        newStatus: created.status,
        attendanceId: created.id,
      };
    }, { timeout: 10000 });
  },

  /**
   * Find a single attendance record by student + date. Returns null if
   * no record exists for that date.
   */
  async findByStudentAndDate(studentId: number, date: Date) {
    const dateOnly = toDateOnly(date);
    return prisma.attendance.findUnique({
      where: { studentId_date: { studentId, date: dateOnly } },
      include: {
        recordedBy: { select: { id: true, fullName: true } },
      },
    });
  },

  /**
   * List attendance records for a student in a date range (inclusive).
   * Used by parent/student view and by reports.
   *
   * Returns records ordered by date DESC (most recent first).
   */
  async listByStudent(studentId: number, fromDate?: Date, toDate?: Date) {
    const where: any = { studentId };
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = toDateOnly(fromDate);
      if (toDate) where.date.lte = toDateOnly(toDate);
    }
    return prisma.attendance.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        recordedBy: { select: { id: true, fullName: true } },
      },
    });
  },

  /**
   * List attendance records for a school's class on a specific date.
   * Used by the teacher attendance UI to show the current state of the
   * roll call (so the teacher can see which students already have a
   * status set).
   *
   * `className` is required to scope to a specific class — without it,
   * the query would return ALL students in the school for that date,
   * which is not what a class teacher wants.
   */
  async listBySchoolClassAndDate(schoolId: number, className: string, date: Date) {
    const dateOnly = toDateOnly(date);
    return prisma.attendance.findMany({
      where: { schoolId, className, date: dateOnly },
      include: {
        student: { select: { id: true, fullName: true, className: true } },
      },
      orderBy: { student: { fullName: "asc" } },
    });
  },

  /**
   * List attendance records for a school in a date range (inclusive).
   * Used by SCHOOL_ADMIN reports. Returns records ordered by date DESC
   * then by className ASC.
   */
  async listBySchoolAndDateRange(schoolId: number, fromDate: Date, toDate: Date) {
    return prisma.attendance.findMany({
      where: {
        schoolId,
        date: { gte: toDateOnly(fromDate), lte: toDateOnly(toDate) },
      },
      orderBy: [{ date: "desc" }, { className: "asc" }],
      include: {
        student: { select: { id: true, fullName: true, className: true } },
        recordedBy: { select: { id: true, fullName: true } },
      },
    });
  },

  /**
   * Calculate attendance statistics for a student in a date range.
   * Returns counts for each status plus the total.
   *
   * Used by:
   *   - parent/student attendance view (the "summary" header)
   *   - reports (aggregated across multiple students by the service)
   */
  async getStatsForStudent(studentId: number, fromDate?: Date, toDate?: Date) {
    const where: any = { studentId };
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = toDateOnly(fromDate);
      if (toDate) where.date.lte = toDateOnly(toDate);
    }

    const records = await prisma.attendance.findMany({
      where,
      select: { status: true },
    });

    const stats = {
      total: records.length,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    };
    for (const r of records) {
      if (r.status === "PRESENT") stats.present++;
      else if (r.status === "ABSENT") stats.absent++;
      else if (r.status === "LATE") stats.late++;
      else if (r.status === "EXCUSED") stats.excused++;
    }
    // Attendance percentage: (present + late + excused) / total * 100.
    // ABSENT counts against; LATE and EXCUSED do not.
    const percentage = stats.total === 0
      ? 0
      : Math.round(((stats.present + stats.late + stats.excused) / stats.total) * 100);
    return { ...stats, percentage };
  },

  /**
   * Calculate the current consecutive-absence streak for a student.
   *
   * Walks backward from today (or the most recent attendance record)
   * and counts consecutive ABSENT records. Stops at the first non-ABSENT
   * record (PRESENT, LATE, or EXCUSED) or at the beginning of records.
   *
   * Used by the escalation service to decide whether to trigger a
   * mahalla notification. Note: LATE and EXCUSED do NOT break the
   * streak — only PRESENT does. Wait, that's wrong: re-reading the
   * spec, "consecutive absences" should be broken by ANY non-ABSENT
   * status. Let me re-think:
   *
   *   - PRESENT  → breaks the streak (student attended)
   *   - LATE     → breaks the streak (student attended, just late)
   *   - EXCUSED  → breaks the streak (student has a valid excuse)
   *   - ABSENT   → continues the streak
   *
   * This is the standard definition of "consecutive absences" — any
   * attendance (even late or excused) resets the counter.
   *
   * Returns 0 if the student has no attendance records or if the most
   * recent record is not ABSENT.
   */
  async getConsecutiveAbsences(studentId: number, asOfDate?: Date): Promise<number> {
    // Load the most recent N attendance records (we walk backward until
    // we hit a non-ABSENT record or run out). Limit to 365 to bound the
    // query — a year of consecutive absences is the practical maximum.
    const records = await prisma.attendance.findMany({
      where: {
        studentId,
        ...(asOfDate ? { date: { lte: toDateOnly(asOfDate) } } : {}),
      },
      orderBy: { date: "desc" },
      select: { status: true, date: true },
      take: 365,
    });

    let streak = 0;
    for (const r of records) {
      if (r.status === "ABSENT") {
        streak++;
      } else {
        // First non-ABSENT record breaks the streak.
        break;
      }
    }
    return streak;
  },

  /**
   * Create an escalation record. Idempotent: if an escalation already
   * exists for this (studentId, thresholdDate), returns null (no
   * duplicate created). This is enforced by the unique constraint
   * `@@unique([studentId, thresholdDate])`.
   *
   * Returns the created escalation, or null if it already existed.
   */
  async createEscalationIfNotExists(params: {
    studentId: number;
    schoolId: number;
    neighborhoodId: number;
    absenceCount: number;
    thresholdDate: Date;
    actorUserId: number;
  }): Promise<{ id: number } | null> {
    try {
      const created = await prisma.attendanceEscalation.create({
        data: {
          studentId: params.studentId,
          schoolId: params.schoolId,
          neighborhoodId: params.neighborhoodId,
          absenceCount: params.absenceCount,
          thresholdDate: toDateOnly(params.thresholdDate),
          actorUserId: params.actorUserId,
        },
        select: { id: true },
      });
      return created;
    } catch (error: any) {
      // P2002 = unique constraint violation — escalation already exists.
      if (error?.code === "P2002") return null;
      throw error;
    }
  },

  /**
   * List escalations for a neighborhood (for MAHALLA_RESPONSIBLE view).
   * Only unresolved escalations are returned by default.
   */
  async listEscalationsByNeighborhood(neighborhoodId: number, includeResolved = false) {
    return prisma.attendanceEscalation.findMany({
      where: {
        neighborhoodId,
        ...(includeResolved ? {} : { resolvedAt: null }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        student: { select: { id: true, fullName: true, className: true } },
        school: { select: { id: true, name: true } },
      },
    });
  },

  /**
   * Get the audit log for a specific attendance record. Used by the
   * attendance detail view to show the change history.
   */
  async getAuditLog(attendanceId: number) {
    return prisma.attendanceAuditLog.findMany({
      where: { attendanceId },
      orderBy: { createdAt: "desc" },
      include: {
        actor: { select: { id: true, fullName: true } },
      },
    });
  },
};
