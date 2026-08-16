/**
 * Phase 5: Attendance handlers (standalone, not conversation).
 *
 * These handlers cover:
 *   - Teacher attendance menu entry (`att_menu`)
 *   - Class selection (`att_class:<className>`)
 *   - Date selection (`att_date:<className>:<when>`)
 *   - Per-student status picker (`att_student:<studentId>`)
 *   - Per-student status mark (`att_mark:<studentId>:<status>`)
 *   - Save flow (`att_save`, `att_confirm_save`, `att_cancel`)
 *   - Parent attendance view (`view_child_attendance:<studentId>`)
 *   - Student own-attendance view (`my_attendance`)
 *   - Reports (`attendance_report`)
 *
 * The teacher flow uses session state to track the in-progress roll
 * call (className, date, marks per student). The marks are committed
 * atomically via attendanceService.bulkRecordAttendance, which re-
 * validates authorization on the server — never trusting the session
 * state for authorization.
 *
 * Replay-safe: these are normal callback handlers (not conversations),
 * so safeEditMessage is safe here.
 */
import type { BotContext } from "../../types";
import { attendanceService } from "../../services/attendanceService";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { prisma } from "../../database/prisma";
import {
  Permission,
  hasPermission,
} from "../../auth/permissions";
import { AttendanceStatus } from "@prisma/client";
import {
  attendanceTeacherMenu,
  attendanceDateSelect,
  attendanceRollCall,
  attendanceStudentMark,
  attendanceSavePreview,
  attendanceSaved,
  parentAttendanceView,
  studentAttendanceView,
  attendanceReportScreen,
  mainMenu,
} from "../ui/screens";
import { safeEditMessage } from "../ui/helpers";
import { safeAnswerCallbackQuery } from "./safeCallback";

/**
 * Get the in-progress attendance state from the session, creating it
 * if it doesn't exist.
 *
 * Phase 9 Date Fix: Normalizes `date` from string to Date on every
 * read. grammY session storage (Prisma Json) serializes Date to ISO
 * string on write and does NOT revive on read — so `state.date` is
 * a string after a session round-trip. This caused
 * `toDateOnly(state.date)` to crash with "getUTCFullYear is not a
 * function". Normalizing here ensures every handler that reads
 * `state.date` gets a real Date object.
 */
function getAttState(ctx: BotContext): NonNullable<BotContext["session"]["attendance"]> {
  if (!ctx.session.attendance) {
    ctx.session.attendance = {};
  }
  const state = ctx.session.attendance!;
  // Normalize date: string → Date (grammY session JSON round-trip)
  if (state.date && !(state.date instanceof Date)) {
    state.date = new Date(state.date as any);
  }
  return state;
}

function clearAttState(ctx: BotContext) {
  ctx.session.attendance = undefined;
}

/**
 * Resolve the actor (User + Admin) by Telegram ID. Returns null if
 * the user has no User record.
 */
async function resolveActor(telegramId: bigint) {
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);
  if (!user) return null;
  return { user, admin };
}

/**
 * Get the actor's effective school ID — the school they can record
 * attendance for. For school-scoped roles, this is their assigned
 * school. For SUPER_ADMIN/ADMIN, it's null (global — but attendance
 * recording requires a specific school, so they must pick one).
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

const STUDENTS_PER_PAGE = 10;

/**
 * Shared helper: render the roll-call screen with pagination.
 * Feature #8: shows 10 students per page with orqaga/keyingisi buttons.
 *
 * @param ctx Bot context
 * @param telegramId Actor's telegram ID (for permission re-check)
 * @param page Which page to show (0-indexed)
 */
async function renderRollCall(ctx: BotContext, telegramId: bigint, page: number = 0): Promise<void> {
  const state = getAttState(ctx);
  if (!state.className || !state.date || !state.schoolId) {
    await safeEditMessage(ctx, "⚠️ Davomat holati topilmadi. Qaytadan boshlang.", mainMenu().keyboard);
    return;
  }

  // Phase 10: CLASS_TEACHER class isolation — verify the teacher is
  // authorized to access this class. CLASS_TEACHER can only access
  // their assignedClassName; TEACHER can access any class at their school.
  const actor = await resolveActor(telegramId);
  if (!actor) {
    await safeEditMessage(ctx, "⚠️ Foydalanuvchi topilmadi.", mainMenu().keyboard);
    return;
  }
  if (actor.user.role === "CLASS_TEACHER" && actor.user.assignedClassName) {
    if (state.className !== actor.user.assignedClassName) {
      await safeEditMessage(ctx, "⛔️ Siz faqat o'zingizga biriktirilgan sinfga kira olasiz.", mainMenu().keyboard);
      return;
    }
  }

  const classAttendance = await attendanceService.getClassAttendance({
    actorTelegramId: telegramId,
    schoolId: state.schoolId,
    className: state.className,
    date: state.date,
  });

  if (!classAttendance) {
    await safeEditMessage(ctx, "⛔️ Ruxsat yo'q yoki sinf topilmadi.", mainMenu().keyboard);
    return;
  }

  // Phase 10: marks now stores only ABSENT student IDs as { [id]: "ABSENT" }
  if (!state.marks) state.marks = {};
  // Pre-populate from existing records: ABSENT → mark as absent
  for (const s of classAttendance.students) {
    if (s.status === "ABSENT" && !state.marks[s.id]) {
      state.marks[s.id] = "ABSENT";
    }
  }

  // Paginate: 10 students per page
  const total = classAttendance.students.length;
  const totalPages = Math.max(1, Math.ceil(total / STUDENTS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const startIdx = safePage * STUDENTS_PER_PAGE;
  const pageStudents = classAttendance.students.slice(startIdx, startIdx + STUDENTS_PER_PAGE);

  state.page = safePage;

  const marks = state.marks ?? {};
  const absentCount = Object.keys(marks).length;
  const dateLabel = state.date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });

  // Get subject from the actor's profile
  const subject = actor.user.teacherSubject || undefined;

  const screen = attendanceRollCall({
    className: state.className,
    date: state.date,
    dateLabel,
    subject,
    students: pageStudents.map(s => ({
      id: s.id,
      fullName: s.fullName,
      isAbsent: !!marks[s.id],
    })),
    absentCount,
    page: safePage,
    totalPages,
  });
  await safeEditMessage(ctx, screen.text, screen.keyboard);
}

/**
 * Attendance menu — entry point for teachers.
 *
 * Lists the classes available at the teacher's school. The class list
 * is derived from the students at the school (SELECT DISTINCT
 * className FROM students WHERE schoolId = ?), so it's always
 * up-to-date and reflects only classes that actually have students.
 *
 * Authorization: the actor must be an active staff member with
 * MANAGE_ATTENDANCE or VIEW_CLASS_ATTENDANCE permission. Deactivated
 * staff are rejected (hasPermission consults User.isActive).
 */
export async function attendanceMenuHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);

  if (!actor) {
    await safeEditMessage(ctx, "⚠️ Foydalanuvchi topilmadi.", mainMenu().keyboard);
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const adminForCheck = actor.admin
    ? { role: actor.admin.role, isActive: actor.admin.isActive }
    : null;
  const canViewClass = hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_CLASS_ATTENDANCE,
    adminForCheck
  );
  const canManage = hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.MANAGE_ATTENDANCE,
    adminForCheck
  );

  if (!canViewClass && !canManage) {
    await safeEditMessage(ctx, "⛔️ Sizda davomat huquqi yo'q.", mainMenu().keyboard);
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Get the school ID for the class list.
  const schoolId = getActorSchoolId(actor);
  if (!schoolId) {
    await safeEditMessage(
      ctx,
      "⚠️ Sizga maktab biriktirilmagan. Iltimos, administrator bilan bog'laning.",
      mainMenu().keyboard
    );
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Load distinct classes + student count for each.
  // Phase 8: exclude archived students from the class list.
  const classRows = await prisma.student.groupBy({
    by: ["className"],
    where: { schoolId, archivedAt: null },
    _count: { id: true },
    orderBy: { className: "asc" },
  });
  const classes = classRows.map((c: any) => ({
    className: c.className,
    studentCount: c._count?.id ?? 0,
  }));

  // Stash schoolId in session for later use in the flow.
  const state = getAttState(ctx);
  state.schoolId = schoolId;

  // Phase 10: CLASS_TEACHER auto-skips class selection — goes directly
  // to their assigned class. They cannot choose a different class.
  if (actor.user.role === "CLASS_TEACHER" && actor.user.assignedClassName) {
    state.className = actor.user.assignedClassName;
    // Show date selection directly
    const screen = attendanceDateSelect(actor.user.assignedClassName);
    await safeEditMessage(ctx, screen.text, screen.keyboard);
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // TEACHER: show class list to choose from
  const screen = attendanceTeacherMenu(classes);
  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await safeAnswerCallbackQuery(ctx);
}

/**
 * Class selected — show date selection.
 */
export async function attendanceClassHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Answer IMMEDIATELY before expensive work
  await safeAnswerCallbackQuery(ctx);

  // Parse className from callback data.
  const data = ctx.callbackQuery.data;
  const className = data.substring("att_class:".length);
  if (!className) {
    return; // callback already answered
  }

  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);
  if (!actor) {
    await safeEditMessage(ctx, "⚠️ Foydalanuvchi topilmadi.", mainMenu().keyboard);
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Re-verify permission (defense-in-depth — callback data is untrusted).
  const adminForCheck = actor.admin
    ? { role: actor.admin.role, isActive: actor.admin.isActive }
    : null;
  if (!hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_CLASS_ATTENDANCE,
    adminForCheck
  )) {
    await safeEditMessage(ctx, "⛔️ Sizda davomat huquqi yo'q.", mainMenu().keyboard);
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Phase 10: CLASS_TEACHER class isolation — can only access their
  // assigned class. Prevents callback manipulation (att_class:11-B).
  if (actor.user.role === "CLASS_TEACHER" && actor.user.assignedClassName) {
    if (className !== actor.user.assignedClassName) {
      await safeAnswerCallbackQuery(ctx, {
        text: "⛔️ Siz faqat o'zingizga biriktirilgan sinfga kira olasiz.",
        show_alert: true,
      });
      return;
    }
  }

  // Verify the class exists at the actor's school. This prevents a
  // teacher from crafting `att_class:foo` to access a class that
  // doesn't exist at their school.
  const schoolId = getActorSchoolId(actor);
  if (!schoolId) {
    await safeEditMessage(ctx, "⚠️ Maktab topilmadi.", mainMenu().keyboard);
    await safeAnswerCallbackQuery(ctx);
    return;
  }
  const classExists = await prisma.student.findFirst({
    where: { schoolId, className },
    select: { id: true },
  });
  if (!classExists) {
    await safeAnswerCallbackQuery(ctx, {
      text: "Bu sinf sizning maktabingizda topilmadi.",
      show_alert: true,
    });
    return;
  }

  // Stash className in session.
  const state = getAttState(ctx);
  state.className = className;
  state.marks = {};

  const screen = attendanceDateSelect(className);
  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await safeAnswerCallbackQuery(ctx);
}

/**
 * Date selected — show the roll-call screen.
 */
export async function attendanceDateHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Answer IMMEDIATELY before expensive work (loading students, etc.)
  await safeAnswerCallbackQuery(ctx);

  const parts = ctx.callbackQuery.data.split(":");
  if (parts.length < 3) {
    return; // callback already answered
  }
  const className = parts[1];
  const when = parts[2];

  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);
  if (!actor) {
    await safeEditMessage(ctx, "⚠️ Foydalanuvchi topilmadi.", mainMenu().keyboard);
    return;
  }

  // Re-verify permission.
  const adminForCheck = actor.admin
    ? { role: actor.admin.role, isActive: actor.admin.isActive }
    : null;
  if (!hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_CLASS_ATTENDANCE,
    adminForCheck
  )) {
    await safeEditMessage(ctx, "⛔️ Sizda davomat huquqi yo'q.", mainMenu().keyboard);
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Compute the date.
  const now = new Date();
  let date: Date;
  if (when === "yesterday") {
    date = new Date(now);
    date.setUTCDate(date.getUTCDate() - 1);
  } else {
    date = now;
  }

  // Stash className + date + schoolId in session.
  const state = getAttState(ctx);
  state.className = className;
  state.date = date;
  state.marks = {};
  state.page = 0;
  state.schoolId = getActorSchoolId(actor) ?? undefined;

  await safeAnswerCallbackQuery(ctx);
  await renderRollCall(ctx, telegramId, 0);
}

/**
 * Student selected in roll call — show status picker.
 */
/**
 * Phase 10: Toggle student absent/present.
 * Tapping a student in the roll-call list toggles their absent status.
 * No separate status picker screen — direct toggle for simplicity.
 */
export async function attendanceToggleHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const studentId = Number(ctx.callbackQuery.data.split(":")[1]);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    await safeAnswerCallbackQuery(ctx, { text: "Noto'g'ri o'quvchi.", show_alert: true });
    return;
  }

  const state = getAttState(ctx);
  if (!state.className || !state.date || !state.schoolId) {
    await safeAnswerCallbackQuery(ctx, {
      text: "Davomat holati topilmadi. Qaytadan boshlang.",
      show_alert: true,
    });
    return;
  }

  // Toggle: if already absent → remove (mark as present)
  //         if not absent → add (mark as absent)
  // Answer IMMEDIATELY with the toggle result, THEN re-render
  if (!state.marks) state.marks = {};
  if (state.marks[studentId]) {
    delete state.marks[studentId];
    await safeAnswerCallbackQuery(ctx, { text: "✅ Bor" });
  } else {
    state.marks[studentId] = "ABSENT" as any;
    await safeAnswerCallbackQuery(ctx, { text: "❌ Yo'q" });
  }

  // Re-render the roll-call screen at the current page (callback already answered)
  const telegramId = BigInt(ctx.from.id);
  await renderRollCall(ctx, telegramId, state.page ?? 0);
}

/**
 * Save flow — show preview.
 */
export async function attendanceSaveHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const state = getAttState(ctx);
  if (!state.className || !state.date || !state.schoolId) {
    await safeAnswerCallbackQuery(ctx, {
      text: "Davomat holati topilmadi. Qaytadan boshlang.",
      show_alert: true,
    });
    return;
  }

  // Phase 10: marks stores only ABSENT student IDs.
  // All other students in the class will be marked PRESENT.
  const absentIds = Object.keys(state.marks ?? {}).map(Number);

  // Load ALL students in this class for the preview (need total count)
  const allStudents = await prisma.student.findMany({
    where: { schoolId: state.schoolId, className: state.className, archivedAt: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });

  const absentStudents = allStudents.filter(s => absentIds.includes(s.id));
  const presentCount = allStudents.length - absentStudents.length;

  // Get teacher info
  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);
  const teacherName = actor?.user.fullName || undefined;
  const subject = actor?.user.teacherSubject || undefined;

  const dateLabel = state.date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
  const screen = attendanceSavePreview({
    className: state.className,
    dateLabel,
    subject,
    teacherName,
    totalCount: allStudents.length,
    presentCount,
    absentCount: absentStudents.length,
    absentStudents: absentStudents.map(s => ({ fullName: s.fullName })),
  });
  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await safeAnswerCallbackQuery(ctx);
}

/**
 * Confirm save — persist attendance.
 * Phase 10: absent students stored as ABSENT, all others as PRESENT.
 * Also stores subject and triggers class teacher + parent notifications.
 */
export async function attendanceConfirmSaveHandler(ctx: BotContext): Promise<void> {
  // Phase 10 Fix: Answer callback IMMEDIATELY before any expensive work.
  // Telegram's callback query expires after ~30s. The save + notification
  // flow can take 5-15s, so we must acknowledge first.
  if (!ctx.from) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const state = getAttState(ctx);
  if (!state.className || !state.date || !state.marks || !state.schoolId) {
    await safeAnswerCallbackQuery(ctx, {
      text: "Davomat holati topilmadi. Qaytadan boshlang.",
      show_alert: true,
    });
    return;
  }

  // Acknowledge IMMEDIATELY with a progress message
  await safeAnswerCallbackQuery(ctx, { text: "⏳ Saqlanmoqda..." });

  const telegramId = BigInt(ctx.from.id);

  // Load ALL students in this class
  const allStudents = await prisma.student.findMany({
    where: { schoolId: state.schoolId, className: state.className, archivedAt: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });

  const absentIds = new Set(Object.keys(state.marks).map(Number));

  // Build records: ABSENT for toggled students, PRESENT for everyone else
  const records = allStudents.map(s => ({
    studentId: s.id,
    status: (absentIds.has(s.id) ? "ABSENT" : "PRESENT") as AttendanceStatus,
  }));

  // Get teacher's subject
  const actor = await resolveActor(telegramId);
  const subject = actor?.user.teacherSubject || undefined;

  // Save attendance (this includes parent notifications internally)
  const results = await attendanceService.bulkRecordAttendance({
    actorTelegramId: telegramId,
    schoolId: state.schoolId,
    className: state.className,
    date: state.date,
    records,
    subject,
  });

  const savedCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const notifiedParents = results
    .filter(r => r.success)
    .reduce((sum, r) => sum + (r.notifiedParents ?? 0), 0);
  const escalated = results.some(r => r.escalated);

  // Phase 10: Notify the CLASS_TEACHER — non-blocking, errors logged
  const absentStudentNames = allStudents
    .filter(s => absentIds.has(s.id))
    .map(s => s.fullName);
  try {
    await attendanceService.notifyClassTeacher({
      schoolId: state.schoolId,
      className: state.className,
      date: state.date,
      subject,
      teacherName: actor?.user.fullName || undefined,
      totalCount: allStudents.length,
      absentCount: absentStudentNames.length,
      absentStudentNames,
    });
  } catch (err) {
    console.error("Class teacher notification failed:", (err as Error).message);
  }

  const dateLabel = state.date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
  const screen = attendanceSaved({
    className: state.className,
    dateLabel,
    savedCount,
    failedCount,
    notifiedParents,
    escalated,
  });

  // Clear the in-progress state.
  clearAttState(ctx);

  // Update the UI (callback already answered above)
  await safeEditMessage(ctx, screen.text, screen.keyboard);
}

/**
 * Cancel — clear state and return to menu.
 */
export async function attendanceCancelHandler(ctx: BotContext): Promise<void> {
  clearAttState(ctx);
  await safeEditMessage(ctx, "❌ Davomat bekor qilindi.", mainMenu().keyboard);
  await safeAnswerCallbackQuery(ctx);
}

/**
 * Back to roll — return from the status picker to the roll-call screen.
 */
export async function attendanceBackToRollHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }
  const state = getAttState(ctx);
  if (!state.className || !state.date) {
    await safeAnswerCallbackQuery(ctx, { text: "Holat topilmadi.", show_alert: true });
    return;
  }
  const telegramId = BigInt(ctx.from.id);
  await safeAnswerCallbackQuery(ctx);
  await renderRollCall(ctx, telegramId, state.page ?? 0);
}

/**
 * Feature #8: Pagination handler — navigate between pages of students.
 */
export async function attendancePageHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }
  const page = Number(ctx.callbackQuery.data.split(":")[1]);
  if (!Number.isInteger(page) || page < 0) {
    await safeAnswerCallbackQuery(ctx, { text: "Noto'g'ri sahifa.", show_alert: true });
    return;
  }
  // Answer IMMEDIATELY before loading students for the new page
  const telegramId = BigInt(ctx.from.id);
  await safeAnswerCallbackQuery(ctx);
  await renderRollCall(ctx, telegramId, page);
}

/**
 * Feature #7: Copy yesterday's attendance to today.
 * Loads yesterday's attendance records and pre-populates the marks,
 * then shows the roll-call screen for review + save.
 */
export async function attendanceCopyYesterdayHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Answer IMMEDIATELY before loading yesterday's records
  await safeAnswerCallbackQuery(ctx);

  const className = ctx.callbackQuery.data.substring("att_copy_yesterday:".length);
  if (!className) {
    return; // callback already answered
  }

  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);
  if (!actor) {
    await safeAnswerCallbackQuery(ctx, { text: "Foydalanuvchi topilmadi.", show_alert: true });
    return;
  }

  const adminForCheck = actor.admin
    ? { role: actor.admin.role, isActive: actor.admin.isActive }
    : null;
  if (!hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.MANAGE_ATTENDANCE,
    adminForCheck
  )) {
    await safeAnswerCallbackQuery(ctx, { text: "⛔️ Davomat yozish huquqi yo'q.", show_alert: true });
    return;
  }

  const schoolId = getActorSchoolId(actor);
  if (!schoolId) {
    await safeAnswerCallbackQuery(ctx, { text: "Maktab topilmadi.", show_alert: true });
    return;
  }

  // Compute today + yesterday
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  // Load yesterday's attendance for this class
  const yesterdayRecords = await prisma.attendance.findMany({
    where: { schoolId, className, date: yesterday },
    select: { studentId: true, status: true },
  });

  if (yesterdayRecords.length === 0) {
    await safeAnswerCallbackQuery(ctx, {
      text: "Kecha uchun davomat ma'lumotlari topilmadi.",
      show_alert: true,
    });
    return;
  }

  // Stash state with yesterday's marks pre-populated
  const state = getAttState(ctx);
  state.className = className;
  state.date = today;
  state.schoolId = schoolId;
  state.page = 0;
  state.marks = {};
  for (const r of yesterdayRecords) {
    state.marks[r.studentId] = r.status;
  }

  await safeAnswerCallbackQuery(ctx, { text: `📋 ${yesterdayRecords.length} ta o'quvchi davomati nusxalandi` });
  await renderRollCall(ctx, telegramId, 0);
}

// ─── Parent attendance view ───────────────────────────────────────────

/**
 * Parent view of a child's attendance.
 *
 * Authorization: the parent must have family access to the student
 * (via Student.parentId OR FamilyStudent). The service checks this
 * via familyRepo.canUserAccessStudent and the legacy parentId check.
 *
 * A parent CANNOT view another parent's child's attendance by crafting
 * `view_child_attendance:<other_studentId>` — the service returns null
 * and the handler shows "not found".
 */
export async function parentAttendanceViewHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const studentId = Number(ctx.callbackQuery.data.split(":")[1]);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    await safeEditMessage(ctx, "⚠️ Noto'g'ri so'rov.", mainMenu().keyboard);
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const result = await attendanceService.getAttendanceForParent({
    parentTelegramId: telegramId,
    studentId,
  });

  if (!result) {
    await safeEditMessage(
      ctx,
      "⚠️ Farzand topilmadi yoki sizga tegishli emas.",
      mainMenu().keyboard
    );
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  // Feature #3: load siblings (other children of the same parent) for
  // the multi-child quick-switcher.
  // Bug Fix #10: Also load children linked via FamilyStudent (Phase 3
  // family system) — step-children linked via family invitation.
  let siblings: Array<{ id: number; fullName: string; className: string }> = [];
  try {
    const parent = await prisma.user.findUnique({
      where: { telegramId },
      select: { id: true },
    });
    if (parent) {
      // Load children via legacy parentId
      const legacyChildren = await prisma.student.findMany({
        where: { parentId: parent.id },
        select: { id: true, fullName: true, className: true },
      });

      // Load children via FamilyStudent → FamilyMember
      const familyStudents = await prisma.familyStudent.findMany({
        where: {
          family: {
            members: { some: { userId: parent.id } },
          },
        },
        include: {
          student: { select: { id: true, fullName: true, className: true } },
        },
      });

      // Merge + deduplicate by student id
      const seen = new Set<number>();
      for (const c of legacyChildren) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          siblings.push({ id: c.id, fullName: c.fullName, className: c.className });
        }
      }
      for (const fs of familyStudents) {
        if (fs.student && !seen.has(fs.student.id)) {
          seen.add(fs.student.id);
          siblings.push({
            id: fs.student.id,
            fullName: fs.student.fullName,
            className: fs.student.className,
          });
        }
      }
      // Sort by name
      siblings.sort((a, b) => a.fullName.localeCompare(b.fullName));
    }
  } catch (err) {
    // Non-critical — if sibling loading fails, just skip the switcher.
  }

  const screen = parentAttendanceView({
    childName: result.student.fullName,
    className: result.student.className,
    schoolName: result.student.schoolName,
    stats: result.stats,
    records: result.records.map(r => ({
      date: r.date,
      status: r.status,
      note: r.note,
    })),
    siblings,
  });
  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await safeAnswerCallbackQuery(ctx);
}

// ─── Student own-attendance view ──────────────────────────────────────

/**
 * Student view of their own attendance.
 *
 * The studentId must be passed via session (set when the student
 * logs in or selects themselves). For Phase 5 we use the existing
 * session.studentId field. A future phase should add a Student.userId
 * link for stronger identity verification.
 */
export async function studentAttendanceViewHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const studentId = ctx.session.studentId;
  if (!studentId) {
    await safeEditMessage(
      ctx,
      "⚠️ Sizning o'quvchi ma'lumotlaringiz topilmadi.",
      mainMenu().keyboard
    );
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const result = await attendanceService.getOwnAttendanceForStudent({
    userTelegramId: telegramId,
    studentId,
  });

  if (!result) {
    await safeEditMessage(
      ctx,
      "⚠️ Davomat ma'lumotlari topilmadi.",
      mainMenu().keyboard
    );
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const screen = studentAttendanceView({
    stats: result.stats,
    records: result.records.map(r => ({
      date: r.date,
      status: r.status,
      note: r.note,
    })),
  });
  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await safeAnswerCallbackQuery(ctx);
}

// ─── Reports ──────────────────────────────────────────────────────────

/**
 * Attendance report — role-scoped.
 *
 * Defaults to the last 30 days. The scope is determined by the
 * service based on the actor's effective role and permissions.
 */
export async function attendanceReportHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    await safeAnswerCallbackQuery(ctx);
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - 30);

  try {
    const report = await attendanceService.getReport({
      actorTelegramId: telegramId,
      fromDate,
      toDate,
    });

    const dateRange = `${fromDate.toLocaleDateString("uz-UZ")} — ${toDate.toLocaleDateString("uz-UZ")}`;
    const scopeLabel: Record<string, string> = {
      global: "Global (barcha maktablar)",
      school: "Mening maktabim",
      neighborhood: "Mening mahallam",
      class: "Mening sinfim",
    };

    const screen = attendanceReportScreen({
      scope: scopeLabel[report.scope] || report.scope,
      totals: report.totals,
      byClass: report.byClass,
      escalations: report.escalations,
      dateRange,
    });
    await safeEditMessage(ctx, screen.text, screen.keyboard);
  } catch (error: any) {
    await safeEditMessage(
      ctx,
      `⚠️ ${error.message || "Hisobot olinmadi."}`,
      mainMenu().keyboard
    );
  }
  await safeAnswerCallbackQuery(ctx);
}
