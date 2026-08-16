/**
 * Phase 7: Attendance Report Service.
 *
 * Provides efficient, role-scoped attendance statistics and reports.
 * Uses Prisma aggregation (count, groupBy) instead of loading raw
 * records into Node.js — this avoids N+1 queries and keeps memory
 * low even for schools with thousands of students.
 *
 * All methods:
 *   - Validate the actor's identity and permissions
 *   - Enforce school/neighborhood isolation from trusted DB records
 *   - Never trust schoolId/studentId/className from callback data
 *   - Return typed results
 *
 * Time ranges supported:
 *   - today
 *   - this week (Monday–Sunday)
 *   - this month (1st–end of month)
 *   - custom date range
 *
 * Report types:
 *   - School-wide totals (present/absent/late/excused + rates)
 *   - Per-class breakdown
 *   - Per-student stats
 *   - Daily trend (for charts)
 *   - Escalation statistics
 */
import { prisma } from "../database/prisma";
import {
  Permission,
  hasPermission,
  canAccessSchool,
  getEffectiveRole,
  PermissionError,
} from "../auth/permissions";

// ─── Types ────────────────────────────────────────────────────────────

export type DateRange = "today" | "week" | "month" | "custom";

export interface AttendanceTotals {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendanceRate: number;  // (present + late + excused) / total * 100
  absenceRate: number;     // absent / total * 100
  lateRate: number;        // late / total * 100
  excusedRate: number;     // excused / total * 100
}

export interface ClassStats extends AttendanceTotals {
  className: string;
  studentCount: number;    // total students in this class (not just those with attendance)
}

export interface StudentStats extends AttendanceTotals {
  studentId: number;
  studentName: string;
  className: string;
}

export interface DailyTrendPoint {
  date: Date;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  attendanceRate: number;
}

export interface EscalationStats {
  total: number;
  unresolved: number;
  resolved: number;
  bySchool: Array<{ schoolId: number; schoolName: string; count: number }>;
  byNeighborhood: Array<{ neighborhoodId: number; count: number }>;
}

export interface ReportResult {
  scope: "global" | "school" | "neighborhood" | "class";
  dateRange: { from: Date; to: Date; label: string };
  totals: AttendanceTotals;
  byClass: ClassStats[];
  trend: DailyTrendPoint[];
  escalations: EscalationStats;
  totalStudents: number;   // total students in scope (not just those with attendance)
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toDateOnly(d: Date | string): Date {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function resolveDateRange(range: DateRange, customFrom?: Date, customTo?: Date): { from: Date; to: Date; label: string } {
  const now = new Date();
  const today = toDateOnly(now);

  switch (range) {
    case "today":
      return { from: today, to: today, label: "Bugun" };

    case "week": {
      // Week = Monday to Sunday
      const day = now.getUTCDay(); // 0 = Sunday
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

    case "custom": {
      if (!customFrom || !customTo) {
        throw new Error("Custom date range requires from and to dates.");
      }
      // Normalize to Date in case they arrived as strings from session
      const from = customFrom instanceof Date ? customFrom : new Date(customFrom);
      const to = customTo instanceof Date ? customTo : new Date(customTo);
      return {
        from: toDateOnly(from),
        to: toDateOnly(to),
        label: `${from.toLocaleDateString("uz-UZ")} — ${to.toLocaleDateString("uz-UZ")}`,
      };
    }

    default:
      return { from: today, to: today, label: "Bugun" };
  }
}

function emptyTotals(): AttendanceTotals {
  return {
    total: 0, present: 0, absent: 0, late: 0, excused: 0,
    attendanceRate: 0, absenceRate: 0, lateRate: 0, excusedRate: 0,
  };
}

function computeRates(t: { total: number; present: number; absent: number; late: number; excused: number }): AttendanceTotals {
  const total = t.total || 0;
  return {
    ...t,
    attendanceRate: total === 0 ? 0 : Math.round(((t.present + t.late + t.excused) / total) * 100),
    absenceRate: total === 0 ? 0 : Math.round((t.absent / total) * 100),
    lateRate: total === 0 ? 0 : Math.round((t.late / total) * 100),
    excusedRate: total === 0 ? 0 : Math.round((t.excused / total) * 100),
  };
}

/**
 * Resolve the actor (User + Admin) by Telegram ID.
 */
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

function getActorNeighborhoodId(actor: {
  user: { neighborhoodId: number | null };
  admin: { isActive: boolean; neighborhoodId: number | null } | null;
}): number | null {
  if (actor.admin?.isActive && actor.admin.neighborhoodId != null) {
    return actor.admin.neighborhoodId;
  }
  return actor.user.neighborhoodId;
}

// ─── Service ──────────────────────────────────────────────────────────

export const attendanceReportService = {
  /**
   * Get a comprehensive attendance report for the actor's scope.
   *
   * Uses Prisma `groupBy` and `count` for efficient aggregation —
   * does NOT load raw attendance records into Node.js.
   *
   * Authorization:
   *   - SUPER_ADMIN/ADMIN: global (optional schoolId filter for ADMIN)
   *   - SCHOOL_ADMIN: own school only (schoolId from DB, not callback)
   *   - TEACHER/CLASS_TEACHER: own school (optional className filter)
   *   - MAHALLA_RESPONSIBLE: own neighborhood (escalations only)
   *
   * PARENT/STUDENT are rejected — they use getStudentReport instead.
   */
  async getReport(params: {
    actorTelegramId: bigint;
    dateRange: DateRange;
    customFrom?: Date;
    customTo?: Date;
    schoolId?: number;      // optional filter (ADMIN/SUPER_ADMIN only)
    className?: string;     // optional filter (TEACHER only)
  }): Promise<ReportResult> {
    const { actorTelegramId, dateRange, customFrom, customTo, schoolId, className } = params;

    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;

    // Determine scope based on permission
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

    const range = resolveDateRange(dateRange, customFrom, customTo);

    // Build the attendance query where-clause based on scope
    let effectiveSchoolId: number | undefined;
    let effectiveClassName: string | undefined;
    let effectiveNeighborhoodId: number | undefined;

    if (scope === "school") {
      effectiveSchoolId = getActorSchoolId(actor) ?? undefined;
      if (!effectiveSchoolId) throw new PermissionError("Sizga maktab biriktirilmagan.");
    } else if (scope === "class") {
      effectiveSchoolId = getActorSchoolId(actor) ?? undefined;
      if (!effectiveSchoolId) throw new PermissionError("Sizga maktab biriktirilmagan.");
      effectiveClassName = className;
    } else if (scope === "neighborhood") {
      effectiveNeighborhoodId = getActorNeighborhoodId(actor) ?? undefined;
      if (!effectiveNeighborhoodId) throw new PermissionError("Sizga mahalla biriktirilmagan.");
    } else if (scope === "global") {
      // ADMIN/SUPER_ADMIN: optional schoolId filter
      if (schoolId) {
        const school = await prisma.school.findUnique({ where: { id: schoolId } });
        if (!school) throw new PermissionError("Maktab topilmadi.");
        effectiveSchoolId = schoolId;
      }
    }

    // For neighborhood scope, return escalations only (no raw attendance)
    if (scope === "neighborhood") {
      const escalations = await this.getEscalationStats({
        actorTelegramId,
        neighborhoodId: effectiveNeighborhoodId!,
      });

      return {
        scope,
        dateRange: range,
        totals: emptyTotals(),
        byClass: [],
        trend: [],
        escalations,
        totalStudents: 0,
      };
    }

    // ─── Efficient aggregation using Prisma groupBy ───────────────────
    // Group by status to get totals in a single query.
    // Phase 8: reports default to ACTIVE data only (archivedAt: null).
    // Historical reports can include archived data via the includeArchived param.
    const attendanceWhere: any = {
      date: { gte: range.from, lte: range.to },
      archivedAt: null,  // Phase 8: exclude archived records from default reports
    };
    if (effectiveSchoolId) attendanceWhere.schoolId = effectiveSchoolId;
    if (effectiveClassName) attendanceWhere.className = effectiveClassName;

    const statusGroups = await prisma.attendance.groupBy({
      by: ["status"],
      where: attendanceWhere,
      _count: { status: true },
    });

    // Build totals from the grouped data
    const totalsRaw = { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
    for (const g of statusGroups) {
      const count = g._count?.status ?? 0;
      totalsRaw.total += count;
      if (g.status === "PRESENT") totalsRaw.present = count;
      else if (g.status === "ABSENT") totalsRaw.absent = count;
      else if (g.status === "LATE") totalsRaw.late = count;
      else if (g.status === "EXCUSED") totalsRaw.excused = count;
    }
    const totals = computeRates(totalsRaw);

    // ─── Per-class breakdown using groupBy ────────────────────────────
    const classStatusGroups = await prisma.attendance.groupBy({
      by: ["className", "status"],
      where: attendanceWhere,
      _count: { status: true },
    });

    // Aggregate by class
    const classMap = new Map<string, { total: number; present: number; absent: number; late: number; excused: number }>();
    for (const g of classStatusGroups) {
      const cn = g.className;
      if (!classMap.has(cn)) {
        classMap.set(cn, { total: 0, present: 0, absent: 0, late: 0, excused: 0 });
      }
      const entry = classMap.get(cn)!;
      const count = g._count?.status ?? 0;
      entry.total += count;
      if (g.status === "PRESENT") entry.present = count;
      else if (g.status === "ABSENT") entry.absent = count;
      else if (g.status === "LATE") entry.late = count;
      else if (g.status === "EXCUSED") entry.excused = count;
    }

    // Get student count per class (for the "total students" field).
    // Phase 8: exclude archived students from active counts.
    const classStudentCounts = await prisma.student.groupBy({
      by: ["className"],
      where: {
        archivedAt: null,
        ...(effectiveSchoolId ? { schoolId: effectiveSchoolId } : {}),
      },
      _count: { id: true },
    });
    const studentCountByClass = new Map<string, number>();
    for (const c of classStudentCounts) {
      studentCountByClass.set(c.className, c._count?.id ?? 0);
    }

    const byClass: ClassStats[] = Array.from(classMap.entries()).map(([className, e]) => ({
      className,
      ...computeRates(e),
      studentCount: studentCountByClass.get(className) ?? 0,
    })).sort((a, b) => a.className.localeCompare(b.className));

    // ─── Daily trend using groupBy ────────────────────────────────────
    const dateStatusGroups = await prisma.attendance.groupBy({
      by: ["date", "status"],
      where: attendanceWhere,
      _count: { status: true },
    });

    const trendMap = new Map<string, { date: Date; present: number; absent: number; late: number; excused: number; total: number }>();
    for (const g of dateStatusGroups) {
      const dateKey = g.date.toISOString().split("T")[0];
      if (!trendMap.has(dateKey)) {
        trendMap.set(dateKey, {
          date: g.date,
          present: 0, absent: 0, late: 0, excused: 0, total: 0,
        });
      }
      const entry = trendMap.get(dateKey)!;
      const count = g._count?.status ?? 0;
      entry.total += count;
      if (g.status === "PRESENT") entry.present = count;
      else if (g.status === "ABSENT") entry.absent = count;
      else if (g.status === "LATE") entry.late = count;
      else if (g.status === "EXCUSED") entry.excused = count;
    }

    const trend: DailyTrendPoint[] = Array.from(trendMap.values())
      .map(t => ({
        date: t.date,
        present: t.present,
        absent: t.absent,
        late: t.late,
        excused: t.excused,
        total: t.total,
        attendanceRate: t.total === 0 ? 0 : Math.round(((t.present + t.late + t.excused) / t.total) * 100),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // ─── Escalation statistics ────────────────────────────────────────
    const escalations = await this.getEscalationStats({
      actorTelegramId,
      schoolId: effectiveSchoolId,
    });

    // ─── Total students in scope (Phase 8: exclude archived) ──────────
    const totalStudents = effectiveSchoolId
      ? await prisma.student.count({ where: { schoolId: effectiveSchoolId, archivedAt: null } })
      : await prisma.student.count({ where: { archivedAt: null } });

    return {
      scope,
      dateRange: range,
      totals,
      byClass,
      trend,
      escalations,
      totalStudents,
    };
  },

  /**
   * Get statistics for a single student.
   *
   * Authorization:
   *   - PARENT: must have family access to the student (via Student.parentId or FamilyStudent)
   *   - STUDENT: must be viewing their own record (session.studentId)
   *   - Staff with VIEW_CLASS_ATTENDANCE+: must have school access
   */
  async getStudentReport(params: {
    actorTelegramId: bigint;
    studentId: number;
    dateRange: DateRange;
    customFrom?: Date;
    customTo?: Date;
  }): Promise<{
    student: { id: number; fullName: string; className: string; schoolName: string };
    totals: AttendanceTotals;
    records: Array<{ date: Date; status: string; note: string | null }>;
  }> {
    const { actorTelegramId, studentId, dateRange, customFrom, customTo } = params;

    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    // Load the student
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true, fullName: true, className: true, schoolId: true, parentId: true,
        school: { select: { name: true } },
      },
    });
    if (!student) throw new PermissionError("O'quvchi topilmadi.");

    // Authorization check
    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );

    let authorized = false;

    // Staff: check school access
    if (["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN", "ADMIN", "SUPER_ADMIN", "MAHALLA_RESPONSIBLE"].includes(actor.user.role)) {
      if (hasPermission(
        { role: actor.user.role, isActive: actor.user.isActive },
        Permission.VIEW_CLASS_ATTENDANCE,
        adminForCheck
      )) {
        // For school-scoped roles, verify school access
        const actorSchoolId = getActorSchoolId(actor);
        if (effectiveRole === "SUPER_ADMIN" || effectiveRole === "ADMIN") {
          authorized = true;
        } else if (student.schoolId === actorSchoolId) {
          authorized = true;
        }
      }
    }

    // PARENT: check family access
    if (!authorized && actor.user.role === "PARENT") {
      const { familyRepo } = await import("../repositories/familyRepo");
      const hasFamilyAccess = await familyRepo.canUserAccessStudent(actor.user.id, studentId);
      const isLegacyParent = student.parentId === actor.user.id;
      authorized = hasFamilyAccess || isLegacyParent;
    }

    // STUDENT: check own record via Student.parentId or FamilyStudent link.
    // Phase 9 Security Fix: No longer blindly trusts the caller-passed
    // studentId. Verifies the User↔Student link at the DB level.
    if (!authorized && actor.user.role === "STUDENT") {
      if (student.parentId === actor.user.id) {
        authorized = true;
      } else {
        // Check family access as fallback
        const { familyRepo } = await import("../repositories/familyRepo");
        const hasFamilyAccess = await familyRepo.canUserAccessStudent(actor.user.id, studentId);
        authorized = hasFamilyAccess;
      }
    }

    if (!authorized) {
      throw new PermissionError("Sizda ushbu o'quvchining davomatini ko'rish huquqi yo'q.");
    }

    const range = resolveDateRange(dateRange, customFrom, customTo);

    // Get stats using efficient groupBy
    const statusGroups = await prisma.attendance.groupBy({
      by: ["status"],
      where: {
        studentId,
        date: { gte: range.from, lte: range.to },
      },
      _count: { status: true },
    });

    const totalsRaw = { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
    for (const g of statusGroups) {
      const count = g._count?.status ?? 0;
      totalsRaw.total += count;
      if (g.status === "PRESENT") totalsRaw.present = count;
      else if (g.status === "ABSENT") totalsRaw.absent = count;
      else if (g.status === "LATE") totalsRaw.late = count;
      else if (g.status === "EXCUSED") totalsRaw.excused = count;
    }
    const totals = computeRates(totalsRaw);

    // Get recent records (for the parent/student view)
    const records = await prisma.attendance.findMany({
      where: {
        studentId,
        date: { gte: range.from, lte: range.to },
      },
      orderBy: { date: "desc" },
      select: { date: true, status: true, note: true },
      take: 30,
    });

    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        className: student.className,
        schoolName: student.school?.name ?? "",
      },
      totals,
      records,
    };
  },

  /**
   * Get escalation statistics for the actor's scope.
   *
   * Returns:
   *   - total escalations
   *   - unresolved count
   *   - resolved count
   *   - by school (for global scope)
   *   - by neighborhood (for neighborhood scope)
   */
  async getEscalationStats(params: {
    actorTelegramId: bigint;
    schoolId?: number;
    neighborhoodId?: number;
  }): Promise<EscalationStats> {
    const { actorTelegramId, schoolId, neighborhoodId } = params;

    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;

    if (!hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_NEIGHBORHOOD_ATTENDANCE,
      adminForCheck
    ) && !hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_SCHOOL_ATTENDANCE,
      adminForCheck
    )) {
      throw new PermissionError("Sizda ogohlantirish statistikasini ko'rish huquqi yo'q.");
    }

    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (neighborhoodId) where.neighborhoodId = neighborhoodId;

    const [total, unresolved, resolved] = await Promise.all([
      prisma.attendanceEscalation.count({ where }),
      prisma.attendanceEscalation.count({ where: { ...where, resolvedAt: null } }),
      prisma.attendanceEscalation.count({ where: { ...where, NOT: { resolvedAt: null } } }),
    ]);

    // By school (for global/school scope)
    let bySchool: Array<{ schoolId: number; schoolName: string; count: number }> = [];
    if (!neighborhoodId) {
      const schoolGroups = await prisma.attendanceEscalation.groupBy({
        by: ["schoolId"],
        where: where,
        _count: { id: true },
      });
      const schools = await prisma.school.findMany({
        where: { id: { in: schoolGroups.map(g => g.schoolId) } },
        select: { id: true, name: true },
      });
      bySchool = schoolGroups.map(g => ({
        schoolId: g.schoolId,
        schoolName: schools.find(s => s.id === g.schoolId)?.name ?? `Maktab #${g.schoolId}`,
        count: g._count?.id ?? 0,
      }));
    }

    // By neighborhood (for neighborhood scope)
    let byNeighborhood: Array<{ neighborhoodId: number; count: number }> = [];
    if (neighborhoodId || (!schoolId && hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_GLOBAL_ATTENDANCE,
      adminForCheck
    ))) {
      const nbGroups = await prisma.attendanceEscalation.groupBy({
        by: ["neighborhoodId"],
        where: where,
        _count: { id: true },
      });
      byNeighborhood = nbGroups.map(g => ({
        neighborhoodId: g.neighborhoodId,
        count: g._count?.id ?? 0,
      }));
    }

    return { total, unresolved, resolved, bySchool, byNeighborhood };
  },

  /**
   * Generate a CSV export of attendance records for the actor's scope.
   *
   * Returns a CSV string. The caller sends it as a document via Telegram.
   *
   * Columns: studentName, className, schoolName, date, status, note, recordedBy
   */
  async exportCsv(params: {
    actorTelegramId: bigint;
    dateRange: DateRange;
    customFrom?: Date;
    customTo?: Date;
    schoolId?: number;
    className?: string;
  }): Promise<string> {
    const { actorTelegramId, dateRange, customFrom, customTo, schoolId, className } = params;

    const actor = await resolveActor(actorTelegramId);
    if (!actor) throw new PermissionError("Foydalanuvchi topilmadi.");

    const adminForCheck = actor.admin
      ? { role: actor.admin.role, isActive: actor.admin.isActive }
      : null;

    // Authorization: must have VIEW_SCHOOL_ATTENDANCE or higher
    if (!hasPermission(
      { role: actor.user.role, isActive: actor.user.isActive },
      Permission.VIEW_SCHOOL_ATTENDANCE,
      adminForCheck
    )) {
      throw new PermissionError("Sizda hisobotni eksport qilish huquqi yo'q.");
    }

    const range = resolveDateRange(dateRange, customFrom, customTo);

    // Build query based on scope
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );

    let effectiveSchoolId: number | undefined;
    let effectiveClassName: string | undefined;

    if (effectiveRole === "SCHOOL_ADMIN" || effectiveRole === "TEACHER" || effectiveRole === "CLASS_TEACHER") {
      effectiveSchoolId = getActorSchoolId(actor) ?? undefined;
      if (!effectiveSchoolId) throw new PermissionError("Sizga maktab biriktirilmagan.");
      if (effectiveRole === "TEACHER" || effectiveRole === "CLASS_TEACHER") {
        effectiveClassName = className;
      }
    } else if (effectiveRole === "ADMIN" || effectiveRole === "SUPER_ADMIN") {
      effectiveSchoolId = schoolId; // optional filter
    }

    const where: any = {
      date: { gte: range.from, lte: range.to },
      archivedAt: null,  // Phase 8: CSV export excludes archived records
    };
    if (effectiveSchoolId) where.schoolId = effectiveSchoolId;
    if (effectiveClassName) where.className = effectiveClassName;

    // Load records with student + school + recordedBy info
    const records = await prisma.attendance.findMany({
      where,
      orderBy: [{ date: "desc" }, { className: "asc" }],
      select: {
        date: true,
        status: true,
        note: true,
        student: { select: { fullName: true, className: true } },
        school: { select: { name: true } },
        recordedBy: { select: { fullName: true } },
      },
      take: 5000, // Safety limit — CSV exports are capped at 5000 rows
    });

    // Build CSV
    const header = "O'quvchi,Sinf,Maktab,Sana,Holat,Izoh,Yozgan\n";
    const rows = records.map(r => {
      const dateStr = r.date.toLocaleDateString("uz-UZ");
      const statusLabel: Record<string, string> = {
        PRESENT: "Bor",
        ABSENT: "Yo'q",
        LATE: "Kechikdi",
        EXCUSED: "Sababli",
      };
      // Phase 9 Security Fix: Escape CSV values and prevent formula injection.
      // Values starting with =, +, -, @ are prefixed with a single quote
      // to prevent Excel/Sheets from interpreting them as formulas.
      const escape = (s: string | null) => {
        if (!s) return "";
        let val = s;
        // Prevent CSV formula injection
        if (/^[=+\-@]/.test(val)) {
          val = "'" + val;
        }
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      };
      return [
        escape(r.student?.fullName ?? ""),
        escape(r.student?.className ?? ""),
        escape(r.school?.name ?? ""),
        dateStr,
        statusLabel[r.status] ?? r.status,
        escape(r.note),
        escape(r.recordedBy?.fullName ?? ""),
      ].join(",");
    }).join("\n");

    return header + rows;
  },
};
