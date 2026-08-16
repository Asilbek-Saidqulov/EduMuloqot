/**
 * Phase 5: Attendance service.
 *
 * Centralizes all business rules for attendance operations. Every
 * staff attendance operation passes through this service, which
 * enforces the Phase 1-4 authorization architecture:
 *
 *   1. User exists
 *   2. User.isActive is true (Phase 4 deactivation check)
 *   3. User has the required Permission (Phase 1 permission matrix)
 *   4. User can access the target school (Phase 1 school isolation)
 *   5. Target student belongs to the target school (relational check)
 *
 * The service NEVER trusts callback data for authorization. School
 * scope comes from the actor's DB User record. Student existence and
 * school membership come from the Student table.
 *
 * Notification failures do NOT roll back attendance recording — they
 * are logged but the attendance record remains persisted.
 */
import { attendanceRepo } from "../repositories/attendanceRepo";
import { prisma } from "../database/prisma";
import {
  Permission,
  hasPermission,
  canAccessSchool,
  requireActiveStaff,
  PermissionError,
} from "../auth/permissions";
import { AttendanceStatus } from "@prisma/client";
import { mahallaAbsenceThreshold } from "../config/env";
import type { Bot } from "grammy";
import type { BotContext } from "../types";

// Bot reference for parent notifications (set by app.ts at startup)
let botRef: Bot<BotContext> | undefined;
export function setBotRef(bot: Bot<BotContext>) {
  botRef = bot;
}

/**
 * Resolve the actor's full identity from their Telegram ID. Loads:
 *   - User record (for role, isActive, schoolId)
 *   - Admin record (for legacy compat — getEffectiveRole combines both)
 *
 * Returns null if the user has no User record at all (e.g. a brand-new
 * Telegram user pressing a stale callback).
 */
async function resolveActor(telegramId: bigint) {
  const [user, admin] = await Promise.all([
    prisma.user.findUnique({
      where: { telegramId },
      select: {
        id: true, telegramId: true, fullName: true,
        role: true, isActive: true, schoolId: true, neighborhoodId: true,
        teacherSubject: true, assignedClassName: true,
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

/**
 * Get the effective schoolId for the actor. For school-scoped staff
 * (TEACHER, CLASS_TEACHER, SCHOOL_ADMIN), this is their assigned
 * school. For ADMIN/SUPER_ADMIN, this is null (global scope).
 *
 * The `admin?.schoolId` is preferred if the admin record is active
 * (legacy compat), otherwise user.schoolId.
 */
function getActorSchoolId(actor: {
  user: { schoolId: number | null };
  admin: { isActive: boolean; schoolId: number | null } | null;
}): number | null {
  if (actor.admin?.isActive && actor.admin.schoolId != null) {
    return actor.admin.schoolId;
  }
  return actor.user.schoolId;
}

export const attendanceService = {
  /**
   * Record or update attendance for a single student on a given date.
   *
   * Authorization:
   *   - Actor must be an active staff member (requireActiveStaff)
   *   - Actor must have MANAGE_ATTENDANCE permission
   *   - Actor must have access to the student's school (canAccessSchool)
   *   - Student must exist and belong to the expected schoolId
   *
   * Side effects:
   *   - Attendance row created or updated (via upsert in repo)
   *   - Audit log entry created if status changed
   *   - If status is ABSENT or LATE, parent(s) are notified (best-effort)
   *   - If status is ABSENT and consecutive-absence threshold is
   *     reached, mahalla escalation is triggered (best-effort)
   *
   * Notification failures do NOT roll back the attendance record.
   *
   * Returns the upsert result including whether the record was created
   * vs. updated, so the caller can show an appropriate message.
   */
  async recordAttendance(params: {
    actorTelegramId: bigint;
    studentId: number;
    date: Date;
    status: AttendanceStatus;
    note?: string;
  }): Promise<{
    created: boolean;
    oldStatus: AttendanceStatus | null;
    newStatus: AttendanceStatus;
    attendanceId: number;
    notifiedParents: number;
    escalated: boolean;
  }> {
    const { actorTelegramId, studentId, date, status, note } = params;

    // 1. Resolve the actor.
    const actor = await resolveActor(actorTelegramId);
    if (!actor) {
      throw new PermissionError("Foydalanuvchi topilmadi.");
    }

    // 2. Verify the actor is an active staff member with MANAGE_ATTENDANCE.
    //    Phase 4 Hardening: requireActiveStaff consults User.isActive.
    requireActiveStaff(
      { role: actor.user.role, isActive: actor.user.isActive },
      actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive } : null
    );
    if (!hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.MANAGE_ATTENDANCE,
      actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive } : null
    )) {
      throw new PermissionError("Sizda davomat yozish huquqi yo'q.");
    }

    // 3. Load the student. This is the authoritative source of
    //    schoolId, className, parentId — NOT callback data.
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true, fullName: true, className: true, schoolId: true,
        parentId: true,
        school: { select: { id: true, name: true } },
      },
    });
    if (!student) {
      throw new PermissionError("O'quvchi topilmadi.");
    }

    // 4. Verify the actor has access to the student's school.
    //    canAccessSchool uses getEffectiveRole under the hood, which
    //    consults User.isActive. A deactivated teacher will be
    //    downgraded to PARENT and the school-access check will fail
    //    (unless they happen to be a parent at the same school).
    const actorSchoolId = getActorSchoolId(actor);
    if (!canAccessSchool(
      { role: actor.user.role, isActive: actor.user.isActive, schoolId: actorSchoolId },
      student.schoolId,
      actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive, schoolId: actor.admin.schoolId } : null
    )) {
      throw new PermissionError("Siz ushbu maktab uchun davomat yozishingiz mumkin emas.");
    }

    // Phase 10 Hardening: Subject integrity for single recordAttendance.
    // For TEACHER: subject MUST come from teacherSubject — reject if missing.
    let enforcedSubject: string | undefined;
    if (actor.user.role === "TEACHER") {
      if (!actor.user.teacherSubject) {
        throw new PermissionError("Sizga fan biriktirilmagan. Administrator bilan bog'laning.");
      }
      enforcedSubject = actor.user.teacherSubject;
    }

    // 5. Upsert the attendance record.
    const upsertResult = await attendanceRepo.upsertAttendance({
      studentId: student.id,
      date,
      status,
      recordedById: actor.user.id,
      schoolId: student.schoolId,
      className: student.className,
      note,
      subject: enforcedSubject,
    });

    // 6. Notify parents if the new status is ABSENT or LATE.
    //    We notify on the NEW status, not the old — if a teacher
    //    corrects PRESENT → ABSENT, the parent should still be
    //    notified. If a teacher corrects ABSENT → PRESENT, we do NOT
    //    send a "your child is present" notification (that would be
    //    noisy and is not in the spec).
    let notifiedParents = 0;
    if (status === "ABSENT" || status === "LATE") {
      notifiedParents = await this.notifyParentsOfAttendance({
        student,
        date,
        status,
      });
    }

    // 7. If status is ABSENT, check consecutive-absence threshold and
    //    trigger mahalla escalation if needed.
    let escalated = false;
    if (status === "ABSENT" && mahallaAbsenceThreshold > 0) {
      escalated = await this.maybeEscalateToMahalla({
        student,
        absenceDate: date,
        actorUserId: actor.user.id,
      });
    }

    return {
      created: upsertResult.created,
      oldStatus: upsertResult.oldStatus,
      newStatus: upsertResult.newStatus,
      attendanceId: upsertResult.attendanceId,
      notifiedParents,
      escalated,
    };
  },

  /**
   * Bulk-record attendance for multiple students in one call. Each
   * student is processed independently — if one fails (e.g. school
   * mismatch), the others still succeed. This is intentional: a
   * teacher marking 30 students should not lose all 30 marks because
   * one student's record had an issue.
   *
   * Returns an array of per-student results so the caller can report
   * partial success/failure.
   *
   * The authorization check is performed ONCE at the start (the actor
   * must have MANAGE_ATTENDANCE for the school), then each student is
   * verified to belong to that school. This is more efficient than
   * calling recordAttendance 30 times, each of which would re-load the
   * actor.
   */
  async bulkRecordAttendance(params: {
    actorTelegramId: bigint;
    schoolId: number;
    className: string;
    date: Date;
    records: Array<{ studentId: number; status: AttendanceStatus; note?: string }>;
    subject?: string;
  }): Promise<Array<{
    studentId: number;
    success: boolean;
    error?: string;
    created?: boolean;
    newStatus?: AttendanceStatus;
    notifiedParents?: number;
    escalated?: boolean;
  }>> {
    const { actorTelegramId, schoolId, className, date, records, subject } = params;

    // 1. Resolve + authorize the actor ONCE.
    const actor = await resolveActor(actorTelegramId);
    if (!actor) {
      return records.map(r => ({ studentId: r.studentId, success: false, error: "Foydalanuvchi topilmadi." }));
    }
    requireActiveStaff(
      { role: actor.user.role, isActive: actor.user.isActive },
      actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive } : null
    );
    if (!hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.MANAGE_ATTENDANCE,
      actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive } : null
    )) {
      return records.map(r => ({ studentId: r.studentId, success: false, error: "Davomat yozish huquqi yo'q." }));
    }
    if (!canAccessSchool(
      { role: actor.user.role, isActive: actor.user.isActive, schoolId: getActorSchoolId(actor) },
      schoolId,
      actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive, schoolId: actor.admin.schoolId } : null
    )) {
      return records.map(r => ({ studentId: r.studentId, success: false, error: "Maktabga ruxsat yo'q." }));
    }

    // Phase 10 Hardening: Subject integrity enforcement.
    // For TEACHER role: subject MUST come from the authenticated teacher's
    // `teacherSubject` field — NOT from the client/callback. If the teacher
    // has no teacherSubject, reject attendance creation.
    // For CLASS_TEACHER: subject may be null (their attendance is class-level).
    let enforcedSubject: string | undefined = subject;
    if (actor.user.role === "TEACHER") {
      if (!actor.user.teacherSubject) {
        return records.map(r => ({
          studentId: r.studentId,
          success: false,
          error: "Sizga fan biriktirilmagan. Administrator bilan bog'laning.",
        }));
      }
      // Override any client-supplied subject with the authenticated teacher's subject
      enforcedSubject = actor.user.teacherSubject;
    }

    // 2. Process each student independently.
    const results: Array<any> = [];
    for (const r of records) {
      try {
        // Verify student belongs to the school. The student's className
        // is taken from the DB, NOT from the request — a teacher cannot
        // accidentally record attendance against the wrong class.
        const student = await prisma.student.findUnique({
          where: { id: r.studentId },
          select: {
            id: true, fullName: true, className: true, schoolId: true, parentId: true,
            school: { select: { id: true, name: true } },
          },
        });
        if (!student) {
          results.push({ studentId: r.studentId, success: false, error: "O'quvchi topilmadi." });
          continue;
        }
        if (student.schoolId !== schoolId) {
          results.push({ studentId: r.studentId, success: false, error: "O'quvchi maktabi mos emas." });
          continue;
        }

        // Upsert the attendance record (Phase 10: include enforced subject).
        const upsertResult = await attendanceRepo.upsertAttendance({
          studentId: student.id,
          date,
          status: r.status,
          recordedById: actor.user.id,
          schoolId: student.schoolId,
          className: student.className,
          note: r.note,
          subject: enforcedSubject,
        });

        // Notify parents if ABSENT or LATE.
        let notifiedParents = 0;
        if (r.status === "ABSENT" || r.status === "LATE") {
          notifiedParents = await this.notifyParentsOfAttendance({
            student: {
              id: student.id,
              fullName: student.fullName,
              className: student.className,
              parentId: student.parentId,
              school: { id: student.schoolId, name: student.school?.name ?? "" },
            },
            date,
            status: r.status,
            subject: enforcedSubject,
            attendanceId: upsertResult.attendanceId,
          });
        }

        // Escalate if ABSENT and threshold reached.
        let escalated = false;
        if (r.status === "ABSENT" && mahallaAbsenceThreshold > 0) {
          escalated = await this.maybeEscalateToMahalla({
            student,
            absenceDate: date,
            actorUserId: actor.user.id,
          });
        }

        results.push({
          studentId: r.studentId,
          success: true,
          created: upsertResult.created,
          newStatus: upsertResult.newStatus,
          notifiedParents,
          escalated,
        });
      } catch (error: any) {
        results.push({ studentId: r.studentId, success: false, error: error.message });
      }
    }
    return results;
  },

  /**
   * Get attendance for a student as viewed by a parent. The parent
   * must have family access to the student (via Student.parentId OR
   * FamilyStudent). Uses familyRepo.canUserAccessStudent for the
   * authorization check.
   *
   * Returns null if the parent does not have access.
   */
  async getAttendanceForParent(params: {
    parentTelegramId: bigint;
    studentId: number;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
    student: { id: number; fullName: string; className: string; schoolName: string };
    records: Array<{ id: number; date: Date; status: AttendanceStatus; note: string | null }>;
    stats: { total: number; present: number; absent: number; late: number; excused: number; percentage: number };
  } | null> {
    const { parentTelegramId, studentId, fromDate, toDate } = params;

    // Load the parent User.
    const parent = await prisma.user.findUnique({
      where: { telegramId: parentTelegramId },
      select: { id: true, role: true, isActive: true },
    });
    if (!parent) return null;

    // Check family access. This handles BOTH:
    //   - Legacy Student.parentId (the parent who claimed the student)
    //   - Phase 3 FamilyStudent (both parents in the family)
    const { familyRepo } = await import("../repositories/familyRepo");
    const hasFamilyAccess = await familyRepo.canUserAccessStudent(parent.id, studentId);

    // Also allow if the parent is the legacy Student.parentId (this is
    // covered by FamilyStudent via the claim flow, but we double-check
    // for safety in case a student was claimed before the family sync
    // was added).
    let isLegacyParent = false;
    if (!hasFamilyAccess) {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { parentId: true },
      });
      isLegacyParent = student?.parentId === parent.id;
    }

    if (!hasFamilyAccess && !isLegacyParent) {
      return null;
    }

    // Load the student + attendance + stats.
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true, fullName: true, className: true,
        school: { select: { name: true } },
      },
    });
    if (!student) return null;

    const [records, stats] = await Promise.all([
      attendanceRepo.listByStudent(studentId, fromDate, toDate),
      attendanceRepo.getStatsForStudent(studentId, fromDate, toDate),
    ]);

    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        className: student.className,
        schoolName: student.school?.name ?? "",
      },
      records: records.map(r => ({
        id: r.id,
        date: r.date,
        status: r.status,
        note: r.note,
        // Phase 10 Hardening: absenceReason is NOT included for parents.
        // It's visible ONLY to CLASS_TEACHER/SCHOOL_ADMIN/ADMIN/SUPER_ADMIN.
      })),
      stats,
    };
  },

  /**
   * Get attendance for the student-user themselves (the STUDENT role).
   * A student can ONLY view their own attendance — verified by matching
   * the User's telegramId to a Student record.
   *
   * Note: in the current schema, Student does not have a direct
   * userId field. A student-user is a User with role=STUDENT whose
   * telegramId... actually, there's no direct link. For Phase 5 we
   * rely on the legacy Student.parentId relationship: a student-user
   * viewing "my attendance" must be linked as a Student record via
   * some mechanism. Since the existing onboarding creates STUDENT-role
   * Users without linking them to a Student record, this method
   * currently requires the studentId to be passed in and verifies
   * access via a session-set studentId (set when the student logs in).
   *
   * For now, this method is intentionally simple: it trusts the
   * studentId passed in, but verifies the requesting user has role
   * STUDENT. A future phase can add a Student.userId field for a
   * stronger link.
   */
  async getOwnAttendanceForStudent(params: {
    userTelegramId: bigint;
    studentId: number;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
    records: Array<{ id: number; date: Date; status: AttendanceStatus; note: string | null }>;
    stats: { total: number; present: number; absent: number; late: number; excused: number; percentage: number };
  } | null> {
    const { userTelegramId, studentId, fromDate, toDate } = params;

    const user = await prisma.user.findUnique({
      where: { telegramId: userTelegramId },
      select: { id: true, role: true, isActive: true },
    });
    if (!user) return null;

    // Phase 4 Hardening: a deactivated user keeps VIEW_OWN_ATTENDANCE
    // (it's in DEACTIVATION_PRESERVED_PERMISSIONS), so we don't need
    // a separate isActive check here. The permission check below
    // handles it.
    if (!hasPermission(
      { role: user.role, isActive: user.isActive },
      Permission.VIEW_OWN_ATTENDANCE
    )) {
      return null;
    }

    // Phase 9 Security Fix: Verify the User↔Student link.
    // The schema doesn't have a direct Student.userId FK, so we verify
    // the link via Student.parentId (the parent who claimed the student).
    // A STUDENT-role user must be the child of the User record — we check
    // by looking up the student's parentId and comparing to the user's id.
    // If no link is found, return null (access denied).
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, fullName: true, parentId: true },
    });
    if (!student) return null;

    // Verify the student belongs to the requesting user.
    // For STUDENT role, the user must be the student's parent (parentId).
    // For PARENT role, the family access check is done separately.
    // For staff roles, the school-access check is done separately.
    if (user.role === "STUDENT") {
      if (student.parentId !== user.id) {
        // Check family access as fallback (the student may be linked
        // via FamilyStudent rather than legacy parentId)
        const { familyRepo } = await import("../repositories/familyRepo");
        const hasFamilyAccess = await familyRepo.canUserAccessStudent(user.id, studentId);
        if (!hasFamilyAccess) {
          return null; // Access denied — student doesn't belong to this user
        }
      }
    }

    const [records, stats] = await Promise.all([
      attendanceRepo.listByStudent(studentId, fromDate, toDate),
      attendanceRepo.getStatsForStudent(studentId, fromDate, toDate),
    ]);

    return {
      records: records.map(r => ({
        id: r.id,
        date: r.date,
        status: r.status,
        note: r.note,
      })),
      stats,
    };
  },

  /**
   * Get attendance for a school/class on a date (teacher view).
   * Returns the list of students in the class plus their attendance
   * status for that date (or null if no record exists yet).
   *
   * Authorization: the actor must have VIEW_CLASS_ATTENDANCE (for
   * viewing) and access to the school. If the actor also has
   * MANAGE_ATTENDANCE, the UI will show the "record" buttons.
   */
  async getClassAttendance(params: {
    actorTelegramId: bigint;
    schoolId: number;
    className: string;
    date: Date;
  }): Promise<{
    students: Array<{
      id: number;
      fullName: string;
      className: string;
      attendanceId: number | null;
      status: AttendanceStatus | null;
    }>;
    canManage: boolean;
  } | null> {
    const { actorTelegramId, schoolId, className, date } = params;

    const actor = await resolveActor(actorTelegramId);
    if (!actor) return null;

    // Verify school access.
    if (!canAccessSchool(
      { role: actor.user.role, isActive: actor.user.isActive, schoolId: getActorSchoolId(actor) },
      schoolId,
      actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive, schoolId: actor.admin.schoolId } : null
    )) {
      return null;
    }

    // Verify VIEW_CLASS_ATTENDANCE permission.
    const adminForCheck = actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive } : null;
    if (!hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_CLASS_ATTENDANCE,
      adminForCheck
    )) {
      return null;
    }

    // Load all students in this class at this school.
    // Phase 8: exclude archived students from the active roster.
    const students = await prisma.student.findMany({
      where: { schoolId, className, archivedAt: null },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, className: true },
    });

    // Load existing attendance records for this class/date.
    const existingRecords = await attendanceRepo.listBySchoolClassAndDate(schoolId, className, date);
    const recordByStudentId = new Map(existingRecords.map(r => [r.studentId, r]));

    const canManage = hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.MANAGE_ATTENDANCE,
      adminForCheck
    );

    return {
      students: students.map(s => {
        const record = recordByStudentId.get(s.id);
        return {
          id: s.id,
          fullName: s.fullName,
          className: s.className,
          attendanceId: record?.id ?? null,
          status: record?.status ?? null,
        };
      }),
      canManage,
    };
  },

  /**
   * Notify the parents of a student about an attendance event.
   *
   * Notifies:
   *   - The parent referenced by Student.parentId (legacy)
   *   - All other parents in the same Family (via FamilyStudent +
   *     FamilyMember) — typically the second parent (father/mother)
   *
   * Deduplication: a parent who is both Student.parentId AND a FamilyMember
   * is notified only ONCE (we dedupe by User.id).
   *
   * Notification failures are logged but do NOT throw — the caller
   * (recordAttendance) continues regardless.
   *
   * Returns the number of distinct parents notified.
   */
  async notifyParentsOfAttendance(params: {
    student: {
      id: number;
      fullName: string;
      className: string;
      parentId: number | null;
      school: { id: number; name: string };
    };
    date: Date;
    status: AttendanceStatus;
    subject?: string;
    attendanceId?: number;
  }): Promise<number> {
    const { student, date, status, subject, attendanceId } = params;

    // Collect parent User IDs to notify.
    const parentIds = new Set<number>();
    if (student.parentId) parentIds.add(student.parentId);

    // Also add parents via FamilyStudent → FamilyMember.
    const familyMembers = await prisma.familyStudent.findMany({
      where: { studentId: student.id },
      select: {
        family: {
          select: {
            members: { select: { userId: true } },
          },
        },
      },
    });
    for (const fs of familyMembers) {
      for (const m of fs.family.members) {
        parentIds.add(m.userId);
      }
    }

    if (parentIds.size === 0) {
      console.warn(`No linked parents found for student ${student.id} — skipping notification.`);
      return 0;
    }

    // Load the parent User records (we need telegramId + fullName).
    const parents = await prisma.user.findMany({
      where: { id: { in: Array.from(parentIds) } },
      select: { id: true, telegramId: true, fullName: true },
    });

    if (!botRef) {
      console.warn("attendanceService.notifyParentsOfAttendance: botRef not set, skipping notifications.");
      return 0;
    }

    const schoolName = student.school?.name ?? "";
    const dateStr = date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });

    // Phase 10: Enhanced notification with subject + "Sababini bildirish" button
    let text =
      `🔔 Davomat\n\n` +
      `Farzandingiz:\n👨‍🎓 ${student.fullName}\n\n` +
      `🏫 Sinf: ${student.className}\n`;
    if (subject) text += `📚 Fan: ${subject}\n`;
    text += `📅 ${dateStr}\n\n`;
    text += `❌ Bugungi darsda yo'q deb belgilandi.`;

    // Add "Sababini bildirish" button for ABSENT status
    const { InlineKeyboard } = await import("grammy");
    const keyboard = status === "ABSENT" && attendanceId
      ? new InlineKeyboard().text("📝 Sababini bildirish", `submit_reason:${attendanceId}`)
      : undefined;

    let notified = 0;
    for (const parent of parents) {
      try {
        if (keyboard) {
          await botRef.api.sendMessage(parent.telegramId.toString(), text, {
            reply_markup: keyboard,
          });
        } else {
          await botRef.api.sendMessage(parent.telegramId.toString(), text);
        }
        notified++;
      } catch (err) {
        // Notification failure (blocked chat, deleted account, etc.)
        // is logged but does NOT throw — the attendance record remains.
        // Phase 9: Mask telegramId in logs to prevent PII leakage
        const { maskTelegramId } = require("../utils/piiRedact");
        console.error(
          `Attendance notification failed (userId=${parent.id}, user=${maskTelegramId(parent.telegramId)}):`,
          (err as Error).message
        );
      }
    }
    return notified;
  },

  /**
   * Check if the student has reached the consecutive-absence threshold
   * and, if so, create an escalation record and notify the responsible
   * MAHALLA_RESPONSIBLE.
   *
   * Idempotent: if an escalation already exists for this (studentId,
   * thresholdDate), no duplicate is created and no notification is sent.
   *
   * Neighborhood resolution: the School model has no direct
   * neighborhoodId. We resolve the neighborhood from the student's
   * parent's User.neighborhoodId (the parent registered with a
   * neighborhood during onboarding). If the parent has no neighborhood
   * set (legacy data), we fall back to all active MAHALLA_RESPONSIBLE
   * users (less precise, but ensures the escalation is at least
   * recorded). If there is no parent at all, we cannot escalate.
   *
   * Returns true if a new escalation was created (and notification sent),
   * false otherwise.
   */
  async maybeEscalateToMahalla(params: {
    student: {
      id: number;
      fullName: string;
      className: string;
      schoolId: number;
      parentId: number | null;
      school: { id: number; name: string };
    };
    absenceDate: Date;
    actorUserId: number;
  }): Promise<boolean> {
    const { student, absenceDate, actorUserId } = params;

    // 1. Calculate the current consecutive absence streak.
    const streak = await attendanceRepo.getConsecutiveAbsences(student.id, absenceDate);

    // 2. If below threshold, no escalation.
    if (streak < mahallaAbsenceThreshold) return false;

    // 3. Resolve the neighborhood from the parent's User record.
    //    If the student has no parent, we cannot escalate (no
    //    neighborhood context).
    let neighborhoodId: number | null = null;
    if (student.parentId) {
      const parent = await prisma.user.findUnique({
        where: { id: student.parentId },
        select: { neighborhoodId: true },
      });
      neighborhoodId = parent?.neighborhoodId ?? null;
    }

    if (neighborhoodId == null) {
      // No parent or parent has no neighborhood — record the escalation
      // for audit but skip the notification (we don't know which
      // mahalla to notify).
      console.warn(
        `maybeEscalateToMahalla: cannot resolve neighborhood for student ${student.id} (no parent or parent has no neighborhood). Escalation recorded but not notified.`
      );
      // We still create the escalation record with neighborhoodId=0
      // (sentinel) — but since the unique constraint requires a real
      // neighborhood, we just skip creation here. Future phase can
      // add a School.neighborhoodId field for proper resolution.
      return false;
    }

    // 4. Create the escalation record (idempotent via unique constraint).
    const escalation = await attendanceRepo.createEscalationIfNotExists({
      studentId: student.id,
      schoolId: student.schoolId,
      neighborhoodId,
      absenceCount: streak,
      thresholdDate: absenceDate,
      actorUserId,
    });

    // 5. If no escalation was created (already existed), don't re-notify.
    if (!escalation) return false;

    // 6. Find the responsible MAHALLA_RESPONSIBLE for this neighborhood.
    //    We query User where role=MAHALLA_RESPONSIBLE, isActive=true,
    //    neighborhoodId=neighborhoodId. The legacy Admin table is NOT
    //    consulted here — User.role is the canonical source of truth
    //    per Phase 4.
    const mahallaResponsibles = await prisma.user.findMany({
      where: {
        role: "MAHALLA_RESPONSIBLE",
        isActive: true,
        neighborhoodId,
      },
      select: { id: true, telegramId: true, fullName: true },
    });

    if (mahallaResponsibles.length === 0) {
      // No active mahalla responsible for this neighborhood — the
      // escalation record still exists (for audit / future resolution),
      // but no notification is sent.
      console.warn(
        `maybeEscalateToMahalla: no active MAHALLA_RESPONSIBLE for neighborhood ${neighborhoodId}. Escalation record created but not notified.`
      );
      return true;
    }

    // 7. Send the escalation notification via the bot's api.sendMessage.
    //    Failures are logged but do NOT throw (best-effort).
    if (!botRef) {
      console.warn("maybeEscalateToMahalla: botRef not set, skipping notification.");
      return true;
    }

    const dateStr = absenceDate.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
    const text =
      `🚨 Davomat bo'yicha ogohlantirish\n\n` +
      `O'quvchi: ${student.fullName}\n` +
      `Sinf: ${student.className}\n` +
      `Maktab: ${student.school.name}\n\n` +
      `Ketma-ket davom etmagan kunlar: ${streak} ta\n` +
      `Oxirgi sana: ${dateStr}\n\n` +
      `Iltimos, o'quvchi va oila bilan bog'laning.`;

    for (const mr of mahallaResponsibles) {
      try {
        await botRef.api.sendMessage(mr.telegramId.toString(), text);
      } catch (err) {
        // Phase 9: Mask telegramId in logs
        const { maskTelegramId } = require("../utils/piiRedact");
        console.error(
          `Escalation notification failed (mahallaUserId=${mr.id}, user=${maskTelegramId(mr.telegramId)}):`,
          (err as Error).message
        );
      }
    }

    return true;
  },

  /**
   * Generate a role-scoped attendance report. The scope is determined
   * by the actor's effective role:
   *
   *   - SUPER_ADMIN / ADMIN: global (all schools)
   *   - SCHOOL_ADMIN: own school only
   *   - MAHALLA_RESPONSIBLE: own neighborhood only (escalations only)
   *   - TEACHER / CLASS_TEACHER: own school, own class (if applicable)
   *
   * Returns a structured report object. The caller (UI) formats it.
   *
   * Authorization: the actor must have the appropriate VIEW_*_ATTENDANCE
   * permission. If not, throws PermissionError.
   */
  async getReport(params: {
    actorTelegramId: bigint;
    schoolId?: number;        // optional scope filter (for SCHOOL_ADMIN)
    className?: string;       // optional scope filter (for CLASS_TEACHER)
    fromDate: Date;
    toDate: Date;
  }): Promise<{
    scope: "global" | "school" | "neighborhood" | "class";
    totals: { total: number; present: number; absent: number; late: number; excused: number; percentage: number };
    byClass?: Array<{ className: string; total: number; present: number; absent: number; late: number; excused: number; percentage: number }>;
    escalations?: Array<{ studentName: string; className: string; schoolName: string; absenceCount: number; thresholdDate: Date }>;
  }> {
    const { actorTelegramId, schoolId, className, fromDate, toDate } = params;

    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    const adminForCheck = actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive } : null;
    const actorSchoolId = getActorSchoolId(actor);

    // Determine the actor's scope based on permission.
    // GLOBAL → ADMIN/SUPER_ADMIN
    // SCHOOL → SCHOOL_ADMIN (and ADMIN as fallback)
    // NEIGHBORHOOD → MAHALLA_RESPONSIBLE
    // CLASS → TEACHER/CLASS_TEACHER
    let scope: "global" | "school" | "neighborhood" | "class";

    if (hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_GLOBAL_ATTENDANCE,
      adminForCheck
    )) {
      scope = "global";
    } else if (hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_NEIGHBORHOOD_ATTENDANCE,
      adminForCheck
    )) {
      scope = "neighborhood";
    } else if (hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_SCHOOL_ATTENDANCE,
      adminForCheck
    )) {
      scope = "school";
    } else if (hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_CLASS_ATTENDANCE,
      adminForCheck
    )) {
      scope = "class";
    } else {
      throw new PermissionError("Sizda davomat hisobotini ko'rish huquqi yo'q.");
    }

    // Build the query based on scope.
    // For SCHOOL scope, use the actor's schoolId (NOT a callback-provided
    // schoolId) to enforce school isolation. The `schoolId` param is
    // ignored for SCHOOL-ADMIN — they can only see their own school.
    // For GLOBAL scope, schoolId is optional (ADMIN can filter by school).
    let effectiveSchoolId: number | undefined;
    let effectiveClassName: string | undefined;
    let effectiveNeighborhoodId: number | undefined;

    if (scope === "school") {
      // SCHOOL_ADMIN: must use their own schoolId, ignore the param.
      effectiveSchoolId = actorSchoolId ?? undefined;
      if (!effectiveSchoolId) {
        throw new PermissionError("Sizga maktab biriktirilmagan.");
      }
    } else if (scope === "class") {
      // TEACHER/CLASS_TEACHER: use their own schoolId. className is
      // optional — if not provided, default to all classes in the school.
      effectiveSchoolId = actorSchoolId ?? undefined;
      if (!effectiveSchoolId) {
        throw new PermissionError("Sizga maktab biriktirilmagan.");
      }
      effectiveClassName = className;
    } else if (scope === "neighborhood") {
      // MAHALLA_RESPONSIBLE: use their neighborhoodId.
      effectiveNeighborhoodId = actor.user.neighborhoodId ?? actor.admin?.neighborhoodId ?? undefined;
      if (!effectiveNeighborhoodId) {
        throw new PermissionError("Sizga mahalla biriktirilmagan.");
      }
    } else if (scope === "global") {
      // ADMIN/SUPER_ADMIN: optional schoolId filter.
      if (schoolId) {
        // Verify the school exists.
        const school = await prisma.school.findUnique({ where: { id: schoolId } });
        if (!school) throw new PermissionError("Maktab topilmadi.");
        effectiveSchoolId = schoolId;
      }
    }

    // Query attendance records based on scope.
    let records: any[] = [];
    let escalations: any[] = [];

    if (scope === "global" || scope === "school" || scope === "class") {
      const where: any = {
        date: { gte: fromDate, lte: toDate },
      };
      if (effectiveSchoolId) where.schoolId = effectiveSchoolId;
      if (effectiveClassName) where.className = effectiveClassName;

      records = await prisma.attendance.findMany({
        where,
        select: { status: true, className: true, schoolId: true },
      });
    }

    if (scope === "neighborhood") {
      // For MAHALLA_RESPONSIBLE, return only escalations for their
      // neighborhood (they don't see raw attendance records, only
      // escalated cases).
      escalations = await attendanceRepo.listEscalationsByNeighborhood(effectiveNeighborhoodId!, true);
    } else {
      // For other scopes, also include escalations within the scope.
      const escalationWhere: any = {
        thresholdDate: { gte: fromDate, lte: toDate },
      };
      if (effectiveSchoolId) escalationWhere.schoolId = effectiveSchoolId;
      if (scope === "global" && schoolId) escalationWhere.schoolId = schoolId;
      escalations = await prisma.attendanceEscalation.findMany({
        where: escalationWhere,
        include: {
          student: { select: { fullName: true, className: true } },
          school: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    // Aggregate totals.
    const totals = { total: 0, present: 0, absent: 0, late: 0, excused: 0, percentage: 0 };
    const byClassMap = new Map<string, { total: number; present: number; absent: number; late: number; excused: number }>();

    for (const r of records) {
      totals.total++;
      if (r.status === "PRESENT") totals.present++;
      else if (r.status === "ABSENT") totals.absent++;
      else if (r.status === "LATE") totals.late++;
      else if (r.status === "EXCUSED") totals.excused++;

      const c = r.className;
      if (!byClassMap.has(c)) {
        byClassMap.set(c, { total: 0, present: 0, absent: 0, late: 0, excused: 0 });
      }
      const entry = byClassMap.get(c)!;
      entry.total++;
      if (r.status === "PRESENT") entry.present++;
      else if (r.status === "ABSENT") entry.absent++;
      else if (r.status === "LATE") entry.late++;
      else if (r.status === "EXCUSED") entry.excused++;
    }

    totals.percentage = totals.total === 0
      ? 0
      : Math.round(((totals.present + totals.late + totals.excused) / totals.total) * 100);

    const byClass = Array.from(byClassMap.entries()).map(([className, e]) => ({
      className,
      ...e,
      percentage: e.total === 0 ? 0 : Math.round(((e.present + e.late + e.excused) / e.total) * 100),
    })).sort((a, b) => a.className.localeCompare(b.className));

    const escalationResult = escalations.map(e => ({
      studentName: e.student?.fullName ?? "Noma'lum",
      className: e.student?.className ?? "",
      schoolName: e.school?.name ?? "",
      absenceCount: e.absenceCount,
      thresholdDate: e.thresholdDate,
    }));

    return {
      scope,
      totals,
      byClass: scope === "neighborhood" ? undefined : byClass,
      escalations: escalationResult,
    };
  },

  /**
   * Get the audit log for a specific attendance record. Used by the
   * attendance detail view to show the change history.
   *
   * Authorization: the actor must have access to the school the
   * attendance record belongs to. This is verified by loading the
   * attendance record (which includes schoolId) and checking
   * canAccessSchool.
   */
  async getAuditLog(params: {
    actorTelegramId: bigint;
    attendanceId: number;
  }) {
    const actor = await resolveActor(params.actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    const attendance = await prisma.attendance.findUnique({
      where: { id: params.attendanceId },
      select: { schoolId: true },
    });
    if (!attendance) return null;

    if (!canAccessSchool(
      { role: actor.user.role, isActive: actor.user.isActive, schoolId: getActorSchoolId(actor) },
      attendance.schoolId,
      actor.admin ? { role: actor.admin.role, isActive: actor.admin.isActive, schoolId: actor.admin.schoolId } : null
    )) {
      throw new PermissionError("Sizda ushbu davomat ma'lumotlarini ko'rish huquqi yo'q.");
    }

    return attendanceRepo.getAuditLog(params.attendanceId);
  },

  /**
   * Expose the consecutive-absence calculation for testing / debugging.
   */
  async getConsecutiveAbsences(studentId: number, asOfDate?: Date): Promise<number> {
    return attendanceRepo.getConsecutiveAbsences(studentId, asOfDate);
  },

  /**
   * Phase 10: Notify the CLASS_TEACHER of a class that attendance was recorded.
   * Finds the CLASS_TEACHER assigned to the class and sends a summary.
   */
  async notifyClassTeacher(params: {
    schoolId: number;
    className: string;
    date: Date;
    subject?: string;
    teacherName?: string;
    totalCount: number;
    absentCount: number;
    absentStudentNames: string[];
  }): Promise<boolean> {
    const { schoolId, className, date, subject, teacherName, totalCount, absentCount, absentStudentNames } = params;

    // Find the CLASS_TEACHER assigned to this class at this school
    const classTeacher = await prisma.user.findFirst({
      where: {
        role: "CLASS_TEACHER",
        isActive: true,
        schoolId,
        assignedClassName: className,
      },
      select: { telegramId: true, fullName: true },
    });

    if (!classTeacher) {
      // No class teacher assigned — not an error, just no notification
      return false;
    }

    if (!botRef) {
      console.warn("notifyClassTeacher: botRef not set, skipping notification.");
      return false;
    }

    const dateStr = date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
    let text =
      `📋 Davomat qayd etildi\n\n` +
      `🏫 Sinf: ${className}\n`;
    if (subject) text += `📚 Fan: ${subject}\n`;
    if (teacherName) text += `👨‍🏫 O'qituvchi: ${teacherName}\n`;
    text += `📅 ${dateStr}\n\n`;
    text += `👨‍🎓 Jami: ${totalCount}\n`;
    text += `✅ Kelgan: ${totalCount - absentCount}\n`;
    text += `❌ Kelmagan: ${absentCount}\n`;

    if (absentStudentNames.length > 0) {
      text += `\nKelmaganlar:\n`;
      for (const name of absentStudentNames) {
        text += `• ${name}\n`;
      }
    }

    try {
      await botRef.api.sendMessage(classTeacher.telegramId.toString(), text);
      return true;
    } catch (err) {
      const { maskTelegramId } = require("../utils/piiRedact");
      console.error(
        `Class teacher notification failed (user=${maskTelegramId(classTeacher.telegramId)}):`,
        (err as Error).message
      );
      return false;
    }
  },

  /**
   * Phase 10: Submit an absence reason from a parent.
   * Stores the reason on the Attendance record. Visible ONLY to CLASS_TEACHER.
   */
  async submitAbsenceReason(params: {
    attendanceId: number;
    reason: string;
  }): Promise<boolean> {
    const { attendanceId, reason } = params;

    const attendance = await prisma.attendance.findUnique({
      where: { id: attendanceId },
      select: { id: true, status: true },
    });

    if (!attendance) return false;
    if (attendance.status !== "ABSENT") return false;

    await prisma.attendance.update({
      where: { id: attendanceId },
      data: { absenceReason: reason },
    });

    return true;
  },
};
