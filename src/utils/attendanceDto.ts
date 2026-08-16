/**
 * Phase 10 Hardening: Safe attendance DTO + authorization filter.
 *
 * Protects `absenceReason` (parent-submitted private explanation) from
 * being exposed to unauthorized roles.
 *
 * RULES:
 *   absenceReason may ONLY be returned to:
 *     1. CLASS_TEACHER assigned to the student's exact class
 *     2. SCHOOL_ADMIN authorized for that school
 *     3. ADMIN / SUPER_ADMIN (global access)
 *
 *   It MUST NEVER be returned to:
 *     - SUBJECT_TEACHER / ordinary TEACHER
 *     - unrelated CLASS_TEACHER (different class)
 *     - MAHALLA_RESPONSIBLE
 *     - another parent
 *     - another student
 *
 * Usage:
 *   const safeRecord = filterAttendanceForActor(rawRecord, actor);
 *   // safeRecord.absenceReason is undefined if actor is not authorized
 */

/**
 * Safe attendance record — absenceReason is optional.
 * When undefined, the field is completely omitted (not null).
 */
export interface SafeAttendanceRecord {
  id: number;
  date: Date;
  status: string;
  note: string | null;
  subject?: string | null;
  recordedById?: number;
  schoolId?: number;
  className?: string;
  studentId?: number;
  absenceReason?: string | null; // ONLY present if actor is authorized
}

/**
 * Actor context for authorization decisions.
 */
export interface AttendanceActor {
  role: string;
  schoolId: number | null;
  assignedClassName?: string | null;
}

/**
 * Check if the actor is authorized to see absenceReason for a specific
 * attendance record.
 *
 * Authorization:
 *   - ADMIN / SUPER_ADMIN: always yes (global access)
 *   - SCHOOL_ADMIN: yes if record.schoolId === actor.schoolId
 *   - CLASS_TEACHER: yes if record.className === actor.assignedClassName
 *     AND record.schoolId === actor.schoolId
 *   - Everyone else (TEACHER, PARENT, STUDENT, MAHALLA_RESPONSIBLE): no
 */
export function canSeeAbsenceReason(
  actor: AttendanceActor,
  record: { schoolId?: number; className?: string }
): boolean {
  // ADMIN / SUPER_ADMIN: global access
  if (actor.role === "ADMIN" || actor.role === "SUPER_ADMIN") {
    return true;
  }

  // SCHOOL_ADMIN: school-scoped access
  if (actor.role === "SCHOOL_ADMIN") {
    return actor.schoolId != null && record.schoolId === actor.schoolId;
  }

  // CLASS_TEACHER: class-scoped access (must match both school AND class)
  if (actor.role === "CLASS_TEACHER") {
    return (
      actor.schoolId != null &&
      record.schoolId === actor.schoolId &&
      actor.assignedClassName != null &&
      record.className === actor.assignedClassName
    );
  }

  // All other roles: denied
  return false;
}

/**
 * Filter a raw attendance record to remove absenceReason if the actor
 * is not authorized to see it.
 *
 * Returns a new object — does NOT mutate the input.
 * If unauthorized, `absenceReason` is completely OMITTED (not null).
 */
export function filterAttendanceForActor(
  record: any,
  actor: AttendanceActor
): SafeAttendanceRecord {
  const authorized = canSeeAbsenceReason(actor, {
    schoolId: record.schoolId,
    className: record.className,
  });

  const safe: SafeAttendanceRecord = {
    id: record.id,
    date: record.date,
    status: record.status,
    note: record.note ?? null,
  };

  // Include optional fields if present
  if (record.subject !== undefined) safe.subject = record.subject;
  if (record.recordedById !== undefined) safe.recordedById = record.recordedById;
  if (record.schoolId !== undefined) safe.schoolId = record.schoolId;
  if (record.className !== undefined) safe.className = record.className;
  if (record.studentId !== undefined) safe.studentId = record.studentId;

  // ONLY include absenceReason if authorized
  if (authorized && record.absenceReason != null) {
    safe.absenceReason = record.absenceReason;
  }

  return safe;
}

/**
 * Filter an array of attendance records for an actor.
 */
export function filterAttendanceListForActor(
  records: any[],
  actor: AttendanceActor
): SafeAttendanceRecord[] {
  return records.map(r => filterAttendanceForActor(r, actor));
}
