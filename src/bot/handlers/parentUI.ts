import type { BotContext } from "../../types";
import { InlineKeyboard } from "grammy";
import type { Complaint, School, Neighborhood, Student, Admin } from "@prisma/client";
import { userRepo } from "../../repositories/userRepo";
import { studentRepo } from "../../repositories/studentRepo";
import { complaintRepo } from "../../repositories/complaintRepo";
import {
  mainMenu,
  getMainMenuForRole,
  myComplaints,
  complaintDetail,
  childrenScreen,
  profileScreen,
  helpScreen,
} from "../ui/screens";
import { safeEditMessage, normalizeComplaintNumber } from "../ui/helpers";
import { adminRepo } from "../../repositories/adminRepo";
import { getEffectiveRole, isStaffRole, isUserActiveStaff } from "../../auth/permissions";
import { getAdminMenuKeyboard } from "../keyboards/adminMenu";

/**
 * Render a complaint (loaded from the DB with included relations) as the
 * parent-side complaint detail screen. Shared by the by-id and by-number
 * handlers so there is a single complaint-detail implementation.
 *
 * `safeEditMessage` is safe here — these are normal callback handlers
 * (outside any conversation), so the replay-safety rules do not apply.
 */
function renderComplaintDetail(
  ctx: BotContext,
  complaint: Complaint & {
    school: School | null;
    neighborhood: Neighborhood | null;
    student: Student | null;
    assignedToAdmin: Admin | null;
  }
) {
  const screen = complaintDetail({
    id: complaint.id,
    complaintNumber: complaint.complaintNumber,
    targetType: complaint.targetType,
    schoolName: complaint.school?.name ?? null,
    neighborhoodName: complaint.neighborhood?.name ?? null,
    childName: complaint.student?.fullName ?? null,
    childGrade: complaint.student?.className ?? null,
    category: complaint.category,
    status: complaint.status,
    text: complaint.description,
    createdAt: complaint.createdAt,
    assignedToAdminName: complaint.assignedToAdmin?.fullName ?? null,
  });
  return safeEditMessage(ctx, screen.text, screen.keyboard);
}

/**
 * Show main menu — role-aware.
 *
 * Phase 9 Fix: Previously this always showed the PARENT menu. Now it
 * resolves the user's role and shows the appropriate menu:
 *   - Staff: redirects to /panel logic (role-specific staff panel)
 *   - PARENT/STUDENT: shows the parent main menu
 */
export async function showMainMenu(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    const screen = mainMenu();
    await safeEditMessage(ctx, screen.text, screen.keyboard);
    await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);

  if (!user) {
    const screen = mainMenu();
    await safeEditMessage(ctx, screen.text, screen.keyboard);
    await ctx.answerCallbackQuery();
    return;
  }

  const adminForCheck = admin
    ? { role: admin.role, isActive: admin.isActive }
    : null;

  // If the user is active staff, show their role-specific panel
  if (isStaffRole(user.role) && isUserActiveStaff(
    { role: user.role, isActive: user.isActive },
    adminForCheck
  )) {
    const effectiveRole = getEffectiveRole(
      { role: user.role, isActive: user.isActive },
      adminForCheck
    );
    const roleLabels: Record<string, string> = {
      TEACHER: "👨‍🏫 O'qituvchi",
      CLASS_TEACHER: "👨‍🏫 Sinf rahbari",
      MAHALLA_RESPONSIBLE: "🏘 Mahalla mas'uli",
      SCHOOL_ADMIN: "🏫 Maktab administratori",
      ADMIN: "🛡 Admin",
      SUPER_ADMIN: "👑 Super Admin",
    };
    const label = roleLabels[effectiveRole] || effectiveRole;
    // Bug Fix: staff panels use ReplyKeyboard (Keyboard), not InlineKeyboard.
    // safeEditMessage calls editMessageText which only accepts InlineKeyboard.
    // Use ctx.reply directly for staff to avoid the type mismatch.
    await ctx.reply(`⚙️ ${label} paneli`, {
      reply_markup: getAdminMenuKeyboard(effectiveRole),
    });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // PARENT / STUDENT: show the role-appropriate menu
  // Bug Fix: STUDENT gets a student-specific menu, not the parent menu
  const screen = user.role === "STUDENT"
    ? getMainMenuForRole("STUDENT")
    : mainMenu();
  await safeEditMessage(ctx, screen.text, screen.keyboard);
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Show my complaints
 */
export async function showMyComplaints(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user) {
    await safeEditMessage(ctx, "⚠️ Foydalanuvchi topilmadi.", mainMenu().keyboard);
    await ctx.answerCallbackQuery();
    return;
  }

  // Feature #4: check for date-range filter in callback data
  // "my_complaints" (all) or "my_complaints:7" (last 7 days) or "my_complaints:30" (last 30 days)
  const data = ctx.callbackQuery?.data || "my_complaints";
  const filterDays = data.includes(":") ? Number(data.split(":")[1]) : null;

  let complaints;
  if (filterDays && [7, 30].includes(filterDays)) {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - filterDays);
    complaints = await complaintRepo.listByParentAndDateRange(user.id, fromDate, toDate);
  } else {
    complaints = await complaintRepo.listByParent(user.id);
  }

  if (complaints.length === 0) {
    // Show filter buttons even when empty
    const filterKb = new InlineKeyboard()
      .text("📅 Oxirgi 7 kun", "my_complaints:7")
      .row()
      .text("📅 Oxirgi 30 kun", "my_complaints:30")
      .row()
      .text("📋 Barchasi", "my_complaints")
      .row()
      .text("◀️ Bosh menyu", "home");
    await safeEditMessage(ctx, "📋 Sizda murojaatlar yo'q.", filterKb);
    await ctx.answerCallbackQuery();
    return;
  }

  const screen = myComplaints(
    complaints.map((c: any) => ({
      id: c.id,
      complaintNumber: c.complaintNumber,
      status: c.status,
      category: c.category,
    }))
  );

  // Bug Fix: previously filterKb REPLACED screen.keyboard, hiding the
  // complaint list buttons. Now we APPEND filter buttons to screen.keyboard
  // so both the complaint buttons AND the filter buttons are visible.
  screen.keyboard
    .row()
    .text("📅 7 kun", "my_complaints:7")
    .text("📅 30 kun", "my_complaints:30")
    .row()
    .text("📋 Barchasi", "my_complaints");

  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await ctx.answerCallbackQuery();
}

/**
 * Show children
 */
export async function showChildren(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user) {
    await safeEditMessage(ctx, "⚠️ Foydalanuvchi topilmadi.", mainMenu().keyboard);
    await ctx.answerCallbackQuery();
    return;
  }

  const children = await studentRepo.listByParent(user.id);

  const screen = childrenScreen(
    children.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      grade: c.className,
    }))
  );

  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await ctx.answerCallbackQuery();
}

/**
 * Show profile
 */
export async function showProfile(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user) {
    await safeEditMessage(ctx, "⚠️ Foydalanuvchi topilmadi.", mainMenu().keyboard);
    await ctx.answerCallbackQuery();
    return;
  }

  const children = await studentRepo.listByParent(user.id);

  const screen = profileScreen({
    fullName: user.fullName || undefined,
    phone: user.phone || undefined,
    childrenCount: children.length,
  });

  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await ctx.answerCallbackQuery();
}

/**
 * Show help
 */
export async function showHelp(ctx: BotContext): Promise<void> {
  const screen = helpScreen();
  await safeEditMessage(ctx, screen.text, screen.keyboard);
  await ctx.answerCallbackQuery();
}

/**
 * Start new complaint flow
 */
export async function startNewComplaint(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user) {
    await safeEditMessage(ctx, "⚠️ Foydalanuvchi topilmadi.", mainMenu().keyboard);
    await ctx.answerCallbackQuery();
    return;
  }

  // Check if user has children
  const children = await studentRepo.listByParent(user.id);

  if (children.length === 0) {
    await safeEditMessage(
      ctx,
      "👨‍👩‍👧 Farzand topilmadi\n\nMurojaat yuborish uchun avval\nfarzandingizni qo'shishingiz kerak.",
      new InlineKeyboard()
        .text("➕ Farzand qo'shish", "add_child")
        .row()
        .text("◀️ Orqaga", "home")
    );
    await ctx.answerCallbackQuery();
    return;
  }

  // Check if user has verified children
  const verifiedChildren = children.filter((s) => s.verificationStatus === "VERIFIED");

  if (verifiedChildren.length === 0) {
    await safeEditMessage(
      ctx,
      "⏳ Tasdiqlash kutilmoqda\n\nFarzandingiz hali maktab tomonidan\ntasdiqlanmagan. Tasdiqlangandan so'ng\nmurojaat yuborishingiz mumkin.",
      mainMenu().keyboard
    );
    await ctx.answerCallbackQuery();
    return;
  }

  // Enter school complaint conversation
  await ctx.conversation.enter("schoolComplaint");
}

/**
 * Home callback
 */
export async function homeCallback(ctx: BotContext): Promise<void> {
  await showMainMenu(ctx);
}

/**
 * Start registration callback
 *
 * Sends the phone-sharing ReplyKeyboard BEFORE entering the conversation.
 * This is fine because the reply happens outside the conversation (so it is
 * not part of the replay log) and the user needs the keyboard visible before
 * the conversation's first `waitFor` resolves. The conversation itself only
 * starts waiting once `ctx.conversation.enter` returns.
 */
export async function startRegistrationCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const { registrationStep1Phone } = await import("../ui/screens");
  const step1Screen = registrationStep1Phone();
  await ctx.reply(step1Screen.text, { reply_markup: step1Screen.reply_markup });

  await ctx.conversation.enter("parentRegistration");
}

/**
 * View a single complaint (parent-side).
 *
 * Triggered by `view_complaint:<id>` from the My Complaints list, or by
 * `refresh_complaint:<id>` from the complaint detail screen's "Yangilash"
 * button. Both callback patterns route here.
 *
 * Security: the complaint is loaded via `complaintRepo.findByIdForParent`,
 * which scopes by `senderId` — the currently authenticated parent's user
 * id. A parent CANNOT view another parent's complaint by constructing
 * `view_complaint:<other_id>`: the query returns null and the user sees a
 * "not found" message.
 *
 * This is a normal callback handler (NOT a conversation), so safeEditMessage
 * is safe here — the replay-safety rules only apply inside @grammyjs/conversations.
 *
 * The callback query is ALWAYS answered (even on error / not-found), so
 * Telegram never leaves a loading spinner running.
 *
 * `idParam` is the raw `:<id>` suffix from the regex match (e.g. ":123").
 * It's parsed defensively — a non-numeric id results in a not-found message
 * rather than a crash.
 */
export async function viewComplaint(ctx: BotContext, idParam: string): Promise<void> {
  if (!ctx.from) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Parse the id defensively. If the user manually sends a malformed
  // callback like `view_complaint:abc`, we show not-found instead of
  // crashing.
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    await safeEditMessage(
      ctx,
      "⚠️ Murojaat topilmadi.",
      new InlineKeyboard().text("◀️ Murojaatlarim", "my_complaints")
    );
    await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user) {
    await safeEditMessage(
      ctx,
      "⚠️ Foydalanuvchi topilmadi.",
      mainMenu().keyboard
    );
    await ctx.answerCallbackQuery();
    return;
  }

  // Privacy-scoped lookup: findByIdForParent enforces senderId = user.id.
  // Returns null if the complaint doesn't exist OR belongs to another
  // parent — both cases are reported as "not found" to avoid leaking the
  // existence of other parents' complaints.
  const complaint = await complaintRepo.findByIdForParent(id, user.id);

  if (!complaint) {
    await safeEditMessage(
      ctx,
      "⚠️ Murojaat topilmadi yoki sizga tegishli emas.",
      new InlineKeyboard().text("◀️ Murojaatlarim", "my_complaints")
    );
    await ctx.answerCallbackQuery();
    return;
  }

  await renderComplaintDetail(ctx, complaint);
  await ctx.answerCallbackQuery();
}

/**
 * View a complaint by its complaint number (direct callback path).
 *
 * Triggered by `view_complaint_by_number:<complaintNumber>` from the
 * submission-success screen's "📋 Murojaatni ko'rish" button. The complaint
 * number is already known (it was just created by this same user), so no
 * text input is needed — we normalize the embedded number and look it up
 * directly.
 *
 * For the manual-entry flow (user types a number), see the
 * `complaintSearchByNumber` conversation.
 *
 * Security: the lookup uses `complaintRepo.findByComplaintNumberForParent`,
 * which scopes by `senderId` at the database level. A parent CANNOT view
 * another parent's complaint by constructing
 * `view_complaint_by_number:<other_number>`: the query returns null and the
 * user sees the same generic not-found message as for a nonexistent number.
 *
 * The callback query is ALWAYS answered (even on error / not-found), so
 * Telegram never leaves a loading spinner running.
 *
 * `numberParam` is the raw `:<complaintNumber>` suffix from the regex
 * match. It may or may not include the leading `#`; `normalizeComplaintNumber`
 * handles both forms.
 */
export async function viewComplaintByNumberDirect(ctx: BotContext, numberParam: string): Promise<void> {
  if (!ctx.from) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Normalize the embedded complaint number. This accepts "#EDU-000001",
  // "EDU-000001", "edu-000001", etc. — anything the screen might have
  // embedded. If it doesn't normalize, show not-found (no crash).
  const normalized = normalizeComplaintNumber(numberParam);
  if (!normalized) {
    await safeEditMessage(
      ctx,
      "⚠️ Murojaat topilmadi yoki sizga tegishli emas.",
      new InlineKeyboard().text("◀️ Murojaatlarim", "my_complaints")
    );
    await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user) {
    await safeEditMessage(
      ctx,
      "⚠️ Foydalanuvchi topilmadi.",
      mainMenu().keyboard
    );
    await ctx.answerCallbackQuery();
    return;
  }

  // Privacy-scoped lookup by complaint number. senderId is enforced at the
  // DB level — returns null if the complaint doesn't exist OR belongs to
  // another parent. Same not-found message in both cases to avoid leaking
  // the existence of other parents' complaints.
  const complaint = await complaintRepo.findByComplaintNumberForParent(normalized, user.id);

  if (!complaint) {
    await safeEditMessage(
      ctx,
      "⚠️ Murojaat topilmadi yoki sizga tegishli emas.",
      new InlineKeyboard().text("◀️ Murojaatlarim", "my_complaints")
    );
    await ctx.answerCallbackQuery();
    return;
  }

  await renderComplaintDetail(ctx, complaint);
  await ctx.answerCallbackQuery();
}
