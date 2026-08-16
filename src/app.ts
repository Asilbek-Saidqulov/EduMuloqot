import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";

import { env } from "./config/env";
import type { BotContext, SessionData } from "./types";
import { STATUS_LABELS } from "./types";
import { createPrismaSessionStorage } from "./database/sessionStorage";
import { prisma } from "./database/prisma";

import { registerBot } from "./services/notificationService";
import { statsService } from "./services/statsService";
import { complaintService } from "./services/complaintService";
import { complaintRepo } from "./repositories/complaintRepo";

import { startCommand } from "./bot/commands/start";
import { helpCommand } from "./bot/commands/help";
import { adminCommand } from "./bot/commands/admin";
import { panelCommand } from "./bot/commands/panel";
import { cancelCommand } from "./bot/commands/cancel";
import { statusCommand } from "./bot/commands/status";
import { feedbackConversation, setFeedbackBotRef } from "./bot/conversations/feedback";
import { staffWorkloadHandler } from "./bot/handlers/staffWorkload";
import {
  escalationListHandler,
  escalationViewHandler,
  escalationResolveHandler,
} from "./bot/handlers/escalations";
import {
  reportMenuHandler,
  reportRangeHandler,
  reportStatsHandler,
  reportEscalationsHandler,
  reportExportHandler,
} from "./bot/handlers/reports";
import {
  archiveMenuHandler,
  archiveStatsHandler,
  archiveAttendanceListHandler,
  archiveAttendanceBulkHandler,
  archiveStudentsListHandler,
} from "./bot/handlers/archive";
import {
  setSchedulerBotRef,
  startScheduler,
  stopScheduler,
} from "./services/scheduler";
import { myComplaintsHandler } from "./bot/handlers/myComplaints";
import { adminInboxHandler } from "./bot/handlers/adminInbox";
import { myChildrenHandler } from "./bot/handlers/myChildren";
import {
  showMainMenu,
  showMyComplaints,
  showChildren,
  showProfile,
  showHelp,
  startNewComplaint,
  homeCallback,
  startRegistrationCallback,
  viewComplaint,
  viewComplaintByNumberDirect,
} from "./bot/handlers/parentUI";
import { studentApprovalHandler, approveStudentCallback, rejectStudentCallback } from "./bot/handlers/studentApproval";
import { routeCallback, assignToAdminCallback, cancelAssignCallback } from "./bot/handlers/complaintAssignment";
import {
  superAdminMenuHandler,
  listSchoolAdminsHandler,
  listNeighborhoodAdminsHandler,
  viewAdminCallback,
  deactivateAdminCallback,
  activateAdminCallback,
  deleteAdminCallback,
  editResponsibilitiesCallback,
  editScopeCallback,
  editNameCallback,
  changeRoleCallback,
  confirmActionCallback,
  selectSchoolCallback,
  selectNeighborhoodCallback,
  changeRoleConfirmCallback,
  saveResponsibilitiesCallback,
  toggleResponsibilityCallback,
  backToMenuCallback,
  backToListCallback,
} from "./bot/handlers/adminManagement";
import { authAdmin } from "./bot/middleware/authAdmin";
import { rateLimit } from "./bot/middleware/rateLimit";
import { resolveIdentity } from "./auth/identity";

import { schoolComplaintConversation } from "./bot/conversations/schoolComplaint";
import { neighborhoodComplaintConversation } from "./bot/conversations/neighborhoodComplaint";
import { adminReplyConversation } from "./bot/conversations/adminReply";
import { parentRegistrationConversation } from "./bot/conversations/parentRegistration";
import { onboardingConversation } from "./bot/conversations/onboarding";
import { familyConversation, showFamilyMenuHandler, familyInviteHandler } from "./bot/conversations/family";
import { staffProvisioningConversation } from "./bot/conversations/staffProvisioning";
import { staffMenuHandler, staffListHandler, staffViewHandler, staffDeactivateHandler, staffActivateHandler } from "./bot/handlers/staffManagement";
import { setBotRef as setStaffBotRef } from "./services/staffService";
import { setBotRef as setAttendanceBotRef } from "./services/attendanceService";
import {
  attendanceMenuHandler,
  attendanceClassHandler,
  attendanceDateHandler,
  attendanceToggleHandler,
  attendanceSaveHandler,
  attendanceConfirmSaveHandler,
  attendanceCancelHandler,
  attendanceBackToRollHandler,
  attendancePageHandler,
  attendanceCopyYesterdayHandler,
  parentAttendanceViewHandler,
  studentAttendanceViewHandler,
  attendanceReportHandler,
} from "./bot/handlers/attendance";
import {
  applicationListHandler,
  applicationViewHandler,
  applicationApproveHandler,
  applicationRejectHandler,
} from "./bot/handlers/studentApplications";
import { childRegistrationConversation } from "./bot/conversations/childRegistration";
import { childEditConversation } from "./bot/conversations/childEdit";
import { profileEditConversation } from "./bot/conversations/profileEdit";
import { complaintSearchByNumberConversation } from "./bot/conversations/complaintSearchByNumber";
// Phase 5+: addAdminConversation removed — superseded by
// staffProvisioningConversation which creates User + syncs Admin table.
// import { addAdminConversation } from "./bot/conversations/adminManagement";

import { mainMenuKeyboard } from "./bot/keyboards/mainMenu";
import { adminMenuKeyboard, complaintActionKeyboard, complaintListKeyboard } from "./bot/keyboards/adminMenu";
import { complaintActionKeyboardWithAssignment } from "./bot/keyboards/complaintAssignment";

const bot = new Bot<BotContext>(env.BOT_TOKEN);

// notificationService bot API'siga murojaat qilishi uchun instance'ni inject qilamiz
// (services -> bot circular importdan qochish uchun, bot.ts izohiga qarang)
registerBot(bot);
setStaffBotRef(bot);
setAttendanceBotRef(bot);
setFeedbackBotRef(bot);
setSchedulerBotRef(bot);

// Feature #5, #9, #13: start scheduled jobs (parent digest, teacher
// reminder, mahalla digest). Runs in the background — checks every minute.
startScheduler();

// --- Global error handler ---
bot.catch((err) => {
  console.error("Bot error:", err);
});

// --- Global middleware ---
bot.use(rateLimit());

// Phase 1 Foundation: resolve the current user's identity on every update.
// Populates ctx.resolvedUser and ctx.resolvedAdmin for authorization checks.
bot.use(resolveIdentity);

bot.use(
  session<SessionData, BotContext>({
    initial: (): SessionData => ({}),
    storage: createPrismaSessionStorage<SessionData>(),
  })
);
bot.use(conversations());

// --- Exit conversation on /start BEFORE conversation handlers ---
bot.use(async (ctx, next) => {
  if (ctx.message?.text === "/start" && ctx.conversation) {
    await ctx.conversation.exit();
  }
  return next();
});

// Phase 5+: addAdminConversation removed — superseded by staffProvisioning.
// bot.use(createConversation(addAdminConversation, "addAdmin"));
bot.use(createConversation(schoolComplaintConversation, "schoolComplaint"));
bot.use(createConversation(neighborhoodComplaintConversation, "neighborhoodComplaint"));
bot.use(createConversation(adminReplyConversation, "adminReply"));
bot.use(createConversation(parentRegistrationConversation, "parentRegistration"));
bot.use(createConversation(onboardingConversation, "onboarding"));
bot.use(createConversation(familyConversation, "family"));
bot.use(createConversation(staffProvisioningConversation, "staffProvisioning"));
bot.use(createConversation(childRegistrationConversation, "childRegistration"));
bot.use(createConversation(childEditConversation, "childEdit"));
bot.use(createConversation(profileEditConversation, "profileEdit"));
bot.use(createConversation(complaintSearchByNumberConversation, "complaintSearchByNumber"));
// Feature #16: /fikr feedback conversation
bot.use(createConversation(feedbackConversation, "feedback"));
// Phase 10: Absence reason conversation
import { absenceReasonConversation } from "./bot/conversations/absenceReason";
bot.use(createConversation(absenceReasonConversation, "absenceReason"));

// --- Foydalanuvchi (ota-ona) buyruqlari ---
bot.command("start", startCommand);
bot.command("help", helpCommand);
bot.command("cancel", cancelCommand);
// Feature #16: /fikr feedback command — any user can send feedback to SUPER_ADMIN
bot.command("fikr", async (ctx) => {
  await ctx.conversation.enter("feedback");
});
// Feature #17: /status system health dashboard (ADMIN/SUPER_ADMIN only)
bot.command("status", statusCommand);
// Feature #14: /panel hint is shown on first login — but also register
// it as a command so users can type /panel anytime.

bot.hears("📋 Murojaatlarim", myComplaintsHandler);
bot.hears("👨‍👩‍👧 Farzandlarim", myChildrenHandler);
bot.hears("ℹ️ Yordam", helpCommand);

// Fix: "📝 Murojaat yuborish" button on mainMenuKeyboard — enters the
// schoolComplaint conversation (same as the inline "new_complaint" callback).
bot.hears("📝 Murojaat yuborish", async (ctx) => {
  await ctx.conversation.enter("schoolComplaint");
});

bot.hears("➕ Farzand qo'shish", async (ctx) => {
  await ctx.conversation.enter("childRegistration");
});

// --- Admin buyruqlari (authAdmin middleware orqali himoyalangan) ---
bot.command("admin", authAdmin, adminCommand);

// Phase 5+: /panel works for ALL staff roles (TEACHER, CLASS_TEACHER,
// SCHOOL_ADMIN, etc.) without requiring an Admin-table record. This is
// the recommended entry point for staff — /admin is kept for backward
// compatibility with legacy Admin-table users.
bot.command("panel", panelCommand);

bot.hears("🏠 Bosh menyu", async (ctx) => {
  // Phase 9 Fix: Role-aware "Bosh menyu" — staff get their panel,
  // parents/students get the parent menu. Previously this always
  // showed the parent menu, even for SUPER_ADMIN.
  if (!ctx.from) return;
  const telegramId = BigInt(ctx.from.id);
  const { userRepo } = await import("./repositories/userRepo");
  const { adminRepo } = await import("./repositories/adminRepo");
  const { getEffectiveRole, isStaffRole, isUserActiveStaff } = await import("./auth/permissions");
  const { getAdminMenuKeyboard } = await import("./bot/keyboards/adminMenu");
  const { mainMenu } = await import("./bot/ui/screens");

  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);

  if (!user) {
    const screen = mainMenu();
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    return;
  }

  const adminForCheck = admin
    ? { role: admin.role, isActive: admin.isActive }
    : null;

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
    await ctx.reply(`⚙️ ${label} paneli`, {
      reply_markup: getAdminMenuKeyboard(effectiveRole),
    });
    return;
  }

  // PARENT / STUDENT
  const screen = mainMenu();
  await ctx.reply(screen.text, { reply_markup: screen.keyboard });
});

// Phase 5+: "👥 Xodimlarni boshqarish" is the staff management entry
// point for SCHOOL_ADMIN+. It opens the staff management menu where
// they can add teachers, deactivate staff, etc. No authAdmin middleware
// — the handler checks permissions internally via hasPermission.
bot.hears("👥 Xodimlarni boshqarish", staffMenuHandler);

// Feature #12: "🚨 Ogohlantirishlar" shows escalation list for mahalla
// responsibles, with resolution tracking (mark as resolved).
bot.hears("🚨 Ogohlantirishlar", escalationListHandler);

// Phase 5+: "📋 Arizalar" shows student applications for school admins.
bot.hears("📋 Arizalar", applicationListHandler);

// Feature #11: "📋 Belgilanmagan sinflar" shows teachers who haven't recorded
// today's attendance — for school admins to follow up.
bot.hears("📋 Belgilanmagan sinflar", staffWorkloadHandler);

// Phase 8: "🗄 Arxiv" opens the archive menu for SCHOOL_ADMIN+.
bot.hears("🗄 Arxiv", archiveMenuHandler);

bot.hears("📥 Yangi murojaatlar", authAdmin, (ctx) => adminInboxHandler(ctx, "NEW"));
bot.hears("🔄 Jarayondagi murojaatlar", authAdmin, (ctx) => adminInboxHandler(ctx, "IN_PROGRESS"));
bot.hears("✅ Hal qilinganlar", authAdmin, (ctx) => adminInboxHandler(ctx, "RESOLVED"));
bot.hears("🎯 Menga biriktirilgan", authAdmin, async (ctx) => {
  const admin = ctx.admin;
  if (!admin) return;
  
  const complaints = await complaintRepo.listAssignedToAdmin(admin.id);
  
  if (complaints.length === 0) {
    await ctx.reply("Sizga hozircha biriktirilgan murojaatlar yo'q.");
    return;
  }

  const items = complaints.map((c) => ({
    id: c.id,
    label: `${c.complaintNumber} — ${c.category}`,
  }));

  await ctx.reply("Sizga biriktirilgan murojaatlar (ko'rish uchun bosing):", {
    reply_markup: complaintListKeyboard(items),
  });
});
// Phase 5+: "👨‍🎓 O'quvchi tasdiqlashlari" removed — students are now
// auto-verified on claim (pre-validated via Excel import). The
// studentApprovalHandler and its hears registration are removed.
// The approve_student/reject_student callback handlers remain for
// backward compatibility with any legacy PENDING records.

// --- SUPER_ADMIN admin management handlers ---
// Phase 5+: Removed redundant hears handlers for:
//   - "➕ Admin qo'shish" (superseded by "➕ Xodim qo'shish" in staff management)
//   - "👥 Barcha adminlar" (superseded by "👥 Xodimlar ro'yxati")
//   - "🏫 Maktab adminlari" (superseded by "👥 Xodimlar ro'yxati")
//   - "🏘️ Mahalla adminlari" (superseded by "👥 Xodimlar ro'yxati")
// The legacy "👥 Adminlarni boshqarish" hears handler is kept —
// Bug Fix #5: "👥 Adminlarni boshqarish" previously opened the dead
// superAdminMenuKeyboard (all buttons had no hears handlers). Now
// redirects to the modern staff management menu instead.
bot.hears("👥 Adminlarni boshqarish", authAdmin, staffMenuHandler);

bot.hears("📊 Statistika", authAdmin, async (ctx) => {
  const admin = ctx.admin!;
  const text = await statsService.forAdmin({
    schoolId: admin.schoolId ?? undefined,
    neighborhoodId: admin.neighborhoodId ?? undefined,
  });
  await ctx.reply(text, { reply_markup: adminMenuKeyboard });
});

// --- Admin inline tugmalari ---
bot.callbackQuery(/^view:(\d+)$/, authAdmin, async (ctx) => {
  const id = Number(ctx.match[1]);
  const admin = ctx.admin!;

  const complaint = await complaintRepo.findByIdScoped(id, {
    schoolId: admin.schoolId ?? undefined,
    neighborhoodId: admin.neighborhoodId ?? undefined,
  });

  if (!complaint) {
    await ctx.answerCallbackQuery({ text: "Murojaat topilmadi yoki sizga tegishli emas.", show_alert: true });
    return;
  }

  const text =
    `${complaint.complaintNumber}\n` +
    `Holat: ${STATUS_LABELS[complaint.status]}\n` +
    `Kategoriya: ${complaint.category}\n\n` +
    `${complaint.description}`;

  // Use assignment keyboard for school complaints, regular keyboard for neighborhood
  const keyboard = complaint.targetType === "SCHOOL" 
    ? complaintActionKeyboardWithAssignment(complaint.id)
    : complaintActionKeyboard(complaint.id);

  await ctx.reply(text, { reply_markup: keyboard });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^status:(\d+):(IN_PROGRESS|RESOLVED|REJECTED)$/, authAdmin, async (ctx) => {
  const id = Number(ctx.match[1]);
  const status = ctx.match[2] as "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  const admin = ctx.admin!;

  const complaint = await complaintRepo.findByIdScoped(id, {
    schoolId: admin.schoolId ?? undefined,
    neighborhoodId: admin.neighborhoodId ?? undefined,
  });

  if (!complaint) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
    return;
  }

  await complaintService.changeStatus(id, status);
  await ctx.answerCallbackQuery({ text: "Holat yangilandi." });
  await ctx.reply(`✅ ${complaint.complaintNumber} holati yangilandi: ${STATUS_LABELS[status]}`);
});

bot.callbackQuery(/^reply:(\d+)$/, authAdmin, async (ctx) => {
  const id = Number(ctx.match[1]);
  const admin = ctx.admin!;

  // C1 fix: scope-check the complaint BEFORE entering the conversation.
  // The admin can only reply to complaints in their school/neighborhood.
  // SUPER_ADMIN (schoolId=null, neighborhoodId=null) passes an empty scope
  // and can reply to any complaint. This prevents a SCHOOL_ADMIN from
  // crafting reply:<other_school_complaint_id> to reply to a complaint
  // they don't have access to.
  const complaint = await complaintRepo.findByIdScoped(id, {
    schoolId: admin.schoolId ?? undefined,
    neighborhoodId: admin.neighborhoodId ?? undefined,
  });

  if (!complaint) {
    await ctx.answerCallbackQuery({ text: "Murojaat topilmadi yoki sizga tegishli emas.", show_alert: true });
    return;
  }

  ctx.session.complaintId = id;
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("adminReply");
});

bot.callbackQuery(/^approve_student:(\d+)$/, authAdmin, approveStudentCallback);
bot.callbackQuery(/^reject_student:(\d+)$/, authAdmin, rejectStudentCallback);

bot.callbackQuery(/^route:(\d+)$/, authAdmin, routeCallback);
bot.callbackQuery(/^assign_to:(\d+)$/, authAdmin, assignToAdminCallback);
bot.callbackQuery(/^cancel_assign$/, authAdmin, cancelAssignCallback);

// --- Admin management callbacks ---
bot.callbackQuery(/^view_admin:(\d+)$/, authAdmin, viewAdminCallback);
bot.callbackQuery(/^deactivate:(\d+)$/, authAdmin, deactivateAdminCallback);
bot.callbackQuery(/^activate:(\d+)$/, authAdmin, activateAdminCallback);
bot.callbackQuery(/^delete:(\d+)$/, authAdmin, deleteAdminCallback);
bot.callbackQuery(/^edit_resp:(\d+)$/, authAdmin, editResponsibilitiesCallback);
bot.callbackQuery(/^edit_scope:(\d+)$/, authAdmin, editScopeCallback);
bot.callbackQuery(/^edit_name:(\d+)$/, authAdmin, editNameCallback);
bot.callbackQuery(/^change_role:(\d+)$/, authAdmin, changeRoleCallback);
bot.callbackQuery(/^confirm:(\w+):(\d+)$/, authAdmin, confirmActionCallback);
bot.callbackQuery(/^select_school:(\d+)$/, authAdmin, selectSchoolCallback);
bot.callbackQuery(/^select_neighborhood:(\d+)$/, authAdmin, selectNeighborhoodCallback);
bot.callbackQuery(/^change_role:(\w+)$/, authAdmin, changeRoleConfirmCallback);
bot.callbackQuery(/^save_responsibilities$/, authAdmin, saveResponsibilitiesCallback);
bot.callbackQuery(/^toggle_resp:(\w+)$/, authAdmin, toggleResponsibilityCallback);
bot.callbackQuery(/^back_to_menu$/, authAdmin, backToMenuCallback);
bot.callbackQuery(/^back_to_list$/, authAdmin, backToListCallback);

// --- Parent UI callbacks ---
bot.callbackQuery("home", homeCallback);
// Feature #4: "my_complaints" now handles both plain and date-filtered
// (my_complaints:7, my_complaints:30) via the regex registered below.
// The old exact-match `bot.callbackQuery("my_complaints", ...)` is removed.
bot.callbackQuery(/^view_complaint:(\d+)$/, async (ctx) => {
  // ctx.match[1] is the captured <id> (a string). The viewComplaint handler
  // parses it defensively and always answers the callback query, so Telegram
  // never leaves a loading spinner running.
  await viewComplaint(ctx, ctx.match[1]);
});
bot.callbackQuery(/^refresh_complaint:(\d+)$/, async (ctx) => {
  // Refresh reuses the same handler as view — it just reloads the same
  // complaint from the DB and re-renders the detail screen. This is what
  // the "🔄 Yangilash" button on the detail screen uses.
  await viewComplaint(ctx, ctx.match[1]);
});
bot.callbackQuery(/^view_complaint_by_number:(.+)$/, async (ctx) => {
  // Direct path: the complaint number is embedded in the callback data
  // (e.g. "view_complaint_by_number:#EDU-000001"). This is sent by the
  // submission-success screen's "📋 Murojaatni ko'rish" button. The handler
  // normalizes the number and looks it up scoped to the current parent.
  // ctx.match[1] is the captured complaint number (may include leading "#").
  await viewComplaintByNumberDirect(ctx, ctx.match[1]);
});
bot.callbackQuery("search_complaint_by_number", async (ctx) => {
  // Manual-entry path: enter the complaintSearchByNumber conversation,
  // which asks the user to type a complaint number.
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("complaintSearchByNumber");
});
bot.callbackQuery("my_children", showChildren);
bot.callbackQuery("profile", showProfile);
bot.callbackQuery("help", showHelp);
bot.callbackQuery("new_complaint", startNewComplaint);
bot.callbackQuery("start_registration", async (ctx) => {
  // Phase 2: enter the new onboarding conversation instead of the old
  // parent-only registration. The onboarding conversation handles both
  // student and parent paths, including father/mother selection.
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("onboarding");
});

// --- Phase 2: Onboarding callbacks ---
bot.callbackQuery("onboard_student", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("onboarding");
});
bot.callbackQuery("onboard_parent", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("onboarding");
});

// Phase 5+: "👨‍🏫 O'qituvchi" button handler.
// SECURITY: This does NOT self-provision the teacher role. It checks
// that the user has been provisioned as staff by an admin (User.role
// is a staff role AND User.isActive is true). If not, the user sees
// an access-denied screen. This prevents anyone from granting
// themselves staff privileges by tapping the button.
bot.callbackQuery("onboard_teacher", async (ctx) => {
  if (!ctx.from) {
    await ctx.answerCallbackQuery();
    return;
  }
  const telegramId = BigInt(ctx.from.id);
  const { userRepo } = await import("./repositories/userRepo");
  const { adminRepo } = await import("./repositories/adminRepo");
  const { isUserActiveStaff } = await import("./auth/permissions");
  const { teacherAccessDeniedScreen, mainMenu } = await import("./bot/ui/screens");
  const { getAdminMenuKeyboard } = await import("./bot/keyboards/adminMenu");
  const { getEffectiveRole } = await import("./auth/permissions");

  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);

  const adminForCheck = admin
    ? { role: admin.role, isActive: admin.isActive }
    : null;

  // Check if the user is an active staff member.
  if (!user || !isUserActiveStaff(
    { role: user.role, isActive: user.isActive },
    adminForCheck
  )) {
    // Not a provisioned staff member — show access denied.
    const screen = teacherAccessDeniedScreen();
    await ctx.answerCallbackQuery();
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    return;
  }

  // Provisioned staff member — show the role-specific staff panel.
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
  await ctx.answerCallbackQuery({ text: `✅ ${label} paneli` });
  await ctx.reply(`⚙️ ${label} paneli`, {
    reply_markup: getAdminMenuKeyboard(effectiveRole),
  });
});

// Phase 5+: "◀️ Orqaga" from the teacher-access-denied screen.
bot.callbackQuery("back_to_welcome", async (ctx) => {
  const { welcomeScreen } = await import("./bot/ui/screens");
  await ctx.answerCallbackQuery();
  await ctx.reply(welcomeScreen().text, { reply_markup: welcomeScreen().keyboard });
});
bot.callbackQuery("onboard_parent_father", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in onboarding conversation
});
bot.callbackQuery("onboard_parent_mother", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in onboarding conversation
});
bot.callbackQuery("onboard_back", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in onboarding conversation
});
bot.callbackQuery("cancel_onboarding", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in onboarding conversation
});

// Phase 5+: Student onboarding — DB search + application callbacks.
// These are answered here (to dismiss the Telegram loading spinner)
// but the actual logic is handled in the onboarding conversation.
bot.callbackQuery("confirm_student_match", async (ctx) => {
  await ctx.answerCallbackQuery();
});
bot.callbackQuery("reject_student_match", async (ctx) => {
  await ctx.answerCallbackQuery();
});
bot.callbackQuery("submit_student_application", async (ctx) => {
  await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^onboard_select_school:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in onboarding conversation
});

// --- Phase 3: Family callbacks ---
bot.callbackQuery("family_menu", showFamilyMenuHandler);
bot.callbackQuery("family_invite", familyInviteHandler);
bot.callbackQuery("family_create", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("family");
});
bot.callbackQuery("family_join_prompt", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("family");
});
bot.callbackQuery("confirm_family_create", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in family conversation
});
bot.callbackQuery("cancel_family_create", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in family conversation
});
bot.callbackQuery("confirm_family_join", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in family conversation
});
bot.callbackQuery("cancel_family_join", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in family conversation
});

// --- Phase 4: Staff management callbacks ---
bot.callbackQuery("staff_menu", staffMenuHandler);
bot.callbackQuery("staff_list", staffListHandler);
bot.callbackQuery(/^staff_view:\d+$/, staffViewHandler);
bot.callbackQuery(/^staff_deactivate:\d+$/, staffDeactivateHandler);
bot.callbackQuery(/^staff_activate:\d+$/, staffActivateHandler);
bot.callbackQuery("staff_add", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("staffProvisioning");
});
bot.callbackQuery(/^staff_role:\w+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in staffProvisioning conversation
});
bot.callbackQuery(/^staff_school:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery(/^staff_neighborhood:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
// Phase 10: CLASS_TEACHER class selection during provisioning
bot.callbackQuery(/^staff_class:.+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery("confirm_staff_add", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery("cancel_staff_add", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery("back_to_admin_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Phase 5+: show the role-specific panel by redirecting to /panel
  // logic. We can't call panelCommand directly because it expects
  // ctx.from (which is available here). This ensures each role sees
  // their own keyboard when returning to the admin menu.
  await panelCommand(ctx);
});

// Phase 9 Fix: Replaced the broken "Eski admin boshqaruvi" sub-menu
// with direct callbacks to the legacy list handlers. SUPER_ADMIN only.
bot.callbackQuery("legacy_list_school_admins", authAdmin, async (ctx) => {
  if (!ctx.admin || (ctx.admin as any).role !== "SUPER_ADMIN") {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }
  await listSchoolAdminsHandler(ctx);
});
bot.callbackQuery("legacy_list_neighborhood_admins", authAdmin, async (ctx) => {
  if (!ctx.admin || (ctx.admin as any).role !== "SUPER_ADMIN") {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }
  await listNeighborhoodAdminsHandler(ctx);
});

// Bug Fix: Register cancel callbacks for admin-management screens.
// Without these, tapping "❌ Bekor qilish" on responsibility/school/
// neighborhood/role-change/confirmation screens leaves a permanent
// loading spinner — the user is stuck.
bot.callbackQuery(/^cancel:(\w+)$/, authAdmin, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Return to the admin list (or admin menu if list fails)
  await backToListCallback(ctx);
});

// --- Phase 5: Attendance callbacks ---
// Teacher attendance flow
bot.callbackQuery("att_menu", attendanceMenuHandler);
bot.callbackQuery(/^att_class:.+$/, attendanceClassHandler);
bot.callbackQuery(/^att_date:.+:(today|yesterday)$/, attendanceDateHandler);
// Phase 10: Toggle student absent/present (replaces att_student + att_mark)
bot.callbackQuery(/^att_toggle:\d+$/, attendanceToggleHandler);
// Phase 10: Parent submits absence reason — enters a conversation
bot.callbackQuery(/^submit_reason:\d+$/, async (ctx) => {
  const attendanceId = Number(ctx.callbackQuery!.data.split(":")[1]);
  ctx.session.complaintId = attendanceId; // reuse session field for attendanceId
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("absenceReason");
});
bot.callbackQuery("att_save", attendanceSaveHandler);
bot.callbackQuery("att_confirm_save", attendanceConfirmSaveHandler);
bot.callbackQuery("att_cancel", attendanceCancelHandler);
bot.callbackQuery("att_back_to_roll", attendanceBackToRollHandler);
// Feature #8: pagination — next/previous page of students
bot.callbackQuery(/^att_page:\d+$/, attendancePageHandler);
// Feature #7: copy yesterday's attendance to today
bot.callbackQuery(/^att_copy_yesterday:.+$/, attendanceCopyYesterdayHandler);

// Feature #12: escalation resolution tracking (mahalla responsible)
bot.callbackQuery("escalation_list", escalationListHandler);
bot.callbackQuery(/^view_escalation:\d+$/, escalationViewHandler);
bot.callbackQuery(/^resolve_escalation:\d+$/, escalationResolveHandler);

// Feature #11: staff workload view (unrecorded classes)
bot.callbackQuery("staff_workload", staffWorkloadHandler);

// Feature #4: complaint date filter
bot.callbackQuery(/^my_complaints(:\d+)?$/, showMyComplaints);

// Feature #16: feedback cancel
bot.callbackQuery("cancel_feedback", async (ctx) => {
  await ctx.answerCallbackQuery();
});

// Feature #3: "noop" callback — a label button that does nothing (used
// as a section header in the multi-child switcher).
bot.callbackQuery("noop", async (ctx) => {
  await ctx.answerCallbackQuery();
});

// Phase 10: Cancel absence reason submission
bot.callbackQuery("cancel_reason", async (ctx) => {
  await ctx.answerCallbackQuery();
});

// Parent attendance view (from child-detail screen)
bot.callbackQuery(/^view_child_attendance:\d+$/, parentAttendanceViewHandler);

// Student own-attendance view (from main menu)
bot.callbackQuery("my_attendance", studentAttendanceViewHandler);

// Attendance reports (for staff with VIEW_*_ATTENDANCE permission)
// Phase 7: "📊 Davomat hisoboti" now opens the report MENU (with
// time-range options) instead of going straight to the 30-day report.
bot.callbackQuery("attendance_report", reportMenuHandler);
bot.callbackQuery("report_menu", reportMenuHandler);
bot.callbackQuery(/^report:(today|week|month)$/, reportRangeHandler);
bot.callbackQuery("report:stats", reportStatsHandler);
bot.callbackQuery("report:escalations", reportEscalationsHandler);
bot.callbackQuery("report:export", reportExportHandler);

// --- Phase 8: Archive callbacks ---
bot.callbackQuery("archive_menu", archiveMenuHandler);
bot.callbackQuery("archive_stats", archiveStatsHandler);
bot.callbackQuery("archive_attendance_list", archiveAttendanceListHandler);
bot.callbackQuery("archive_attendance_bulk", archiveAttendanceBulkHandler);
bot.callbackQuery("archive_students_list", archiveStudentsListHandler);

// Also expose attendance entry from the admin menu via hears —
// teachers and school admins can type "📋 Davomat" to open the menu.
bot.hears("📋 Davomat", attendanceMenuHandler);
bot.hears("📊 Davomat hisoboti", reportMenuHandler);

// --- Phase 5+: Student Application callbacks ---
bot.callbackQuery("application_list", applicationListHandler);
bot.callbackQuery(/^view_application:\d+$/, applicationViewHandler);
bot.callbackQuery(/^approve_application:\d+$/, applicationApproveHandler);
bot.callbackQuery(/^reject_application:\d+$/, applicationRejectHandler);

// --- Registration callbacks ---
bot.callbackQuery("request_phone", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Phone is handled in conversation via message:contact
});
// Note: select_school: and select_neighborhood: broad no-op handlers
// were removed — they conflicted with the admin-management specific
// handlers (select_school:<digit>) causing double answerCallbackQuery.
// The conversation framework handles its own callbacks internally.
bot.callbackQuery(/^select_class:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery("edit_registration", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery("add_child_now", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("childRegistration");
});
bot.callbackQuery("skip_child", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showMainMenu(ctx);
});
bot.callbackQuery("add_child", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("childRegistration");
});
bot.callbackQuery("confirm_child_registration", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery("edit_child_registration", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
// --- Child claim flow (registry-based) ---
bot.callbackQuery("confirm_claim_child", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in childRegistration conversation
});
bot.callbackQuery("reject_claim_child", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery("retry_name_search", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});
bot.callbackQuery(/^select_claim:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in conversation
});

// --- Child edit flow ---
// view_child:<id> is sent by the childrenScreen inline keyboard when the
// parent taps an existing child. We stash the id in session and enter the
// childEdit conversation, which loads the student, shows current info, and
// offers to edit name or class. The student's id, schoolId, parentId,
// verificationStatus and createdAt are preserved — only the chosen field
// is updated. No new Student row is created.
bot.callbackQuery(/^view_child:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  ctx.session.studentId = id;
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("childEdit");
});
bot.callbackQuery(/^select_edit_class:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in childEdit conversation
});
bot.callbackQuery("confirm_edit_child", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in childEdit conversation
});
bot.callbackQuery("cancel_edit_child", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in childEdit conversation
});
bot.callbackQuery("edit_child_name", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in childEdit conversation
});
bot.callbackQuery("edit_child_class", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in childEdit conversation
});

// --- Profile edit flow ---
// edit_profile is sent by the profileScreen inline keyboard when the parent
// taps "✏️ Ma'lumotlarni o'zgartirish". We enter the profileEdit
// conversation, which loads the current user, shows current info, and
// offers to edit name / phone / school / neighborhood. Only the chosen
// field is updated — id, telegramId, createdAt, and the other three
// profile fields are preserved.
bot.callbackQuery("edit_profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("profileEdit");
});
bot.callbackQuery("edit_profile_name", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in profileEdit conversation
});
bot.callbackQuery("edit_profile_phone", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in profileEdit conversation
});
bot.callbackQuery("edit_profile_school", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in profileEdit conversation
});
bot.callbackQuery("edit_profile_neighborhood", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in profileEdit conversation
});
bot.callbackQuery(/^select_edit_profile_school:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in profileEdit conversation
});
bot.callbackQuery(/^select_edit_profile_neighborhood:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in profileEdit conversation
});
bot.callbackQuery("confirm_edit_profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in profileEdit conversation
});
bot.callbackQuery("cancel_edit_profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Handled in profileEdit conversation
});

// --- Tushunilmagan xabarlar uchun fallback (faol conversation bo'lmaganda ishlaydi) ---
bot.on("message:text", async (ctx) => {
  await ctx.reply("Tushunmadim 🤔 Quyidagi menyudan tanlang:", { reply_markup: mainMenuKeyboard });
});

bot.catch((err) => {
  console.error(`Bot xatosi (update ${err.ctx.update.update_id}):`, err.error);
});

// H6 fix: graceful shutdown on SIGTERM / SIGINT. Stops polling and
// disconnects Prisma so pending DB operations are not lost.
process.on("SIGTERM", async () => {
  console.log("📤 SIGTERM received — shutting down gracefully...");
  stopScheduler();
  bot.stop();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("📤 SIGINT received — shutting down gracefully...");
  stopScheduler();
  bot.stop();
  await prisma.$disconnect();
  process.exit(0);
});

// L4 fix: log unhandled promise rejections so they don't disappear silently.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

bot.start({
  onStart: () => console.log("🤖 EduMuloqot bot ishga tushdi"),
});
