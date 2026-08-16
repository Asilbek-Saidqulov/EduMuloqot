/**
 * Phase 4: Staff provisioning conversation.
 *
 * Flow:
 *   Admin → "Staff boshqaruvi" → "Xodim qo'shish"
 *   → Enter Telegram ID → Select role → Select school/neighborhood
 *   → Preview → Confirm → Provision
 *
 * Security:
 *   - All permission checks use Phase 1 authorization infrastructure
 *   - Actor's role and school scope are loaded from DB, not callback data
 *   - SUPER_ADMIN role cannot be assigned by non-SUPER_ADMIN
 *   - School scope is validated against actor's authorized scope
 *
 * Replay-safe: direct ctx.reply, conversation.external for DB calls.
 */
import type { BotContext, BotConversation } from "../../types";
import { InlineKeyboard } from "grammy";
import { staffService, setBotRef } from "../../services/staffService";
import { staffRepo } from "../../repositories/staffRepo";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { prisma } from "../../database/prisma";
import {
  Permission,
  hasPermission,
  getEffectiveRole,
  PermissionError,
} from "../../auth/permissions";
import {
  staffManagementMenu,
  staffAddTelegramIdPrompt,
  staffRoleSelection,
  staffSchoolSelection,
  staffNeighborhoodSelection,
  staffPreview,
  staffAddSuccess,
  mainMenu,
} from "../ui/screens";

// Role labels for display
const ROLE_LABELS: Record<string, string> = {
  TEACHER: "👨‍🏫 O'qituvchi",
  CLASS_TEACHER: "👨‍🏫 Sinf rahbari",
  SCHOOL_ADMIN: "🏫 Maktab administratori",
  MAHALLA_RESPONSIBLE: "🏘 Mahalla mas'uli",
  ADMIN: "🛡 Admin",
  SUPER_ADMIN: "👑 Super Admin",
};

export async function staffProvisioningConversation(conversation: BotConversation, ctx: BotContext) {
  // Resolve the actor's identity from DB. Phase 4 Hardening: load both
  // User and Admin records so getEffectiveRole can produce the correct
  // effective role, and hasPermission can consult User.isActive.
  const telegramId = BigInt(ctx.from!.id);
  const [actor, admin] = await conversation.external(async () => {
    const u = await userRepo.findByTelegramId(telegramId);
    const a = await adminRepo.findByTelegramId(telegramId);
    return [u, a] as const;
  });

  if (!actor) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Compute the effective role. Phase 4 Hardening: if User.isActive is
  // false, getEffectiveRole returns PARENT and the MANAGE_STAFF check
  // below fails — a deactivated staff member cannot provision others.
  const adminForCheck = admin
    ? { role: admin.role, isActive: admin.isActive, schoolId: admin.schoolId, neighborhoodId: admin.neighborhoodId }
    : null;
  const effectiveRole = getEffectiveRole(
    { role: actor.role, isActive: actor.isActive },
    adminForCheck
  );

  // Check MANAGE_STAFF permission (also consults User.isActive).
  if (!hasPermission({ role: actor.role, isActive: actor.isActive }, Permission.MANAGE_STAFF, adminForCheck)) {
    await ctx.reply("⛔️ Sizda xodimlarni boshqarish huquqi yo'q.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Step 1: Ask for Telegram ID
  const idPrompt = staffAddTelegramIdPrompt();
  await ctx.reply(idPrompt.text, { reply_markup: idPrompt.keyboard });

  let ctxInput = await conversation.waitFor(["message:text", "callback_query:data"]);

  if (ctxInput.callbackQuery?.data === "cancel_staff_add") {
    await ctxInput.answerCallbackQuery();
    await ctx.reply("❌ Xodim qo'shish bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Ignore stale callbacks
  if (ctxInput.callbackQuery) {
    await ctxInput.answerCallbackQuery();
    const screen = staffAddTelegramIdPrompt();
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    ctxInput = await conversation.waitFor(["message:text", "callback_query:data"]);
    if (ctxInput.callbackQuery) {
      await ctxInput.answerCallbackQuery();
      await ctx.reply("❌ Bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }
  }

  const telegramIdStr = ctxInput.message?.text?.trim() ?? "";
  // Validate BEFORE BigInt conversion — BigInt("abc") throws SyntaxError
  if (!telegramIdStr || isNaN(Number(telegramIdStr)) || telegramIdStr.length < 5) {
    await ctx.reply("⚠️ Noto'g'ri Telegram ID formati.", { reply_markup: mainMenu().keyboard });
    return;
  }
  const targetTelegramId = BigInt(telegramIdStr);

  // Check if target user already exists
  const existingUser = await conversation.external(() => staffRepo.findByTelegramId(targetTelegramId));

  // Step 2: Role selection
  const roleScreen = staffRoleSelection();
  await ctx.reply(roleScreen.text, { reply_markup: roleScreen.keyboard });

  let ctxRole = await conversation.waitForCallbackQuery([
    /^staff_role:\w+$/,
    "cancel_staff_add",
  ]);
  await ctxRole.answerCallbackQuery();

  if (ctxRole.callbackQuery.data === "cancel_staff_add") {
    await ctx.reply("❌ Xodim qo'shish bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  const selectedRole = ctxRole.callbackQuery.data.split(":")[1];
  const roleLabel = ROLE_LABELS[selectedRole] || selectedRole;

  // Step 3: School/neighborhood selection (if required)
  let schoolId: number | null = null;
  let neighborhoodId: number | null = null;
  let schoolName = "";
  let neighborhoodName = "";

  if (["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN"].includes(selectedRole)) {
    const schools = await conversation.external(() => prisma.school.findMany());
    const schoolScreen = staffSchoolSelection(schools);
    await ctx.reply(schoolScreen.text, { reply_markup: schoolScreen.keyboard });

    let ctxSchool = await conversation.waitForCallbackQuery([
      /^staff_school:\d+$/,
      "cancel_staff_add",
    ]);
    await ctxSchool.answerCallbackQuery();

    if (ctxSchool.callbackQuery.data === "cancel_staff_add") {
      await ctx.reply("❌ Bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }

    schoolId = Number(ctxSchool.callbackQuery.data.split(":")[1]);
    const school = schools.find((s) => s.id === schoolId);
    schoolName = school?.name ?? "";

    // Validate school exists (defense-in-depth)
    if (!school) {
      await ctx.reply("⚠️ Noto'g'ri maktab.", { reply_markup: mainMenu().keyboard });
      return;
    }
  } else if (selectedRole === "MAHALLA_RESPONSIBLE") {
    const neighborhoods = await conversation.external(() => prisma.neighborhood.findMany());
    const nbScreen = staffNeighborhoodSelection(neighborhoods);
    await ctx.reply(nbScreen.text, { reply_markup: nbScreen.keyboard });

    let ctxNb = await conversation.waitForCallbackQuery([
      /^staff_neighborhood:\d+$/,
      "cancel_staff_add",
    ]);
    await ctxNb.answerCallbackQuery();

    if (ctxNb.callbackQuery.data === "cancel_staff_add") {
      await ctx.reply("❌ Bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }

    neighborhoodId = Number(ctxNb.callbackQuery.data.split(":")[1]);
    const nb = neighborhoods.find((n) => n.id === neighborhoodId);
    neighborhoodName = nb?.name ?? "";

    if (!nb) {
      await ctx.reply("⚠️ Noto'g'ri mahalla.", { reply_markup: mainMenu().keyboard });
      return;
    }
  }

  // Phase 10: Step 3b — Teacher subject (free text) or CLASS_TEACHER assigned class
  let teacherSubject: string | undefined;
  let assignedClassName: string | undefined;

  if (selectedRole === "TEACHER") {
    // Ask for subject as free text
    await ctx.reply(
      "📚 Qaysi fan o'qituvchisi ekanini kiriting:\n\n" +
      "(Misol: Matematika, Informatika, Fizika, Ingliz tili, Ona tili va adabiyot)",
      { reply_markup: new InlineKeyboard().text("❌ Bekor qilish", "cancel_staff_add") }
    );

    let ctxSubject = await conversation.waitFor(["message:text", "callback_query:data"]);
    if (ctxSubject.callbackQuery?.data === "cancel_staff_add") {
      await ctxSubject.answerCallbackQuery();
      await ctx.reply("❌ Bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }
    if (ctxSubject.callbackQuery) {
      await ctxSubject.answerCallbackQuery();
      return;
    }
    teacherSubject = ctxSubject.message?.text?.trim();
    if (!teacherSubject || teacherSubject.length < 2) {
      await ctx.reply("⚠️ Fan nomi kamida 2 ta belgidan iborat bo'lishi kerak.", { reply_markup: mainMenu().keyboard });
      return;
    }
  } else if (selectedRole === "CLASS_TEACHER") {
    // Ask for assigned class — show class list from the selected school
    const classes = await conversation.external(() =>
      prisma.student.groupBy({
        by: ["className"],
        where: { schoolId: schoolId!, archivedAt: null },
        _count: { id: true },
        orderBy: { className: "asc" },
      })
    );

    if (classes.length === 0) {
      await ctx.reply("⚠️ Bu maktabda sinflar topilmadi.", { reply_markup: mainMenu().keyboard });
      return;
    }

    const classKb = new InlineKeyboard();
    for (const c of classes) {
      classKb.text(c.className, `staff_class:${c.className}`).row();
    }
    classKb.text("❌ Bekor qilish", "cancel_staff_add");

    await ctx.reply("🏫 Qaysi sinfning sinf rahbari ekanligini belgilang:", { reply_markup: classKb });

    let ctxClass = await conversation.waitForCallbackQuery([
      /^staff_class:.+$/,
      "cancel_staff_add",
    ]);
    await ctxClass.answerCallbackQuery();

    if (ctxClass.callbackQuery.data === "cancel_staff_add") {
      await ctx.reply("❌ Bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }

    assignedClassName = ctxClass.callbackQuery.data.substring("staff_class:".length);
  }

  // Step 4: Preview (include subject/class info)
  let previewText = `👤 Xodim qo'shish\n\n`;
  previewText += `🆔 Telegram ID: ${telegramIdStr}\n`;
  previewText += `👤 Ism: ${existingUser?.fullName || "Yangi foydalanuvchi"}\n`;
  previewText += `🎭 Rol: ${roleLabel}\n`;
  if (schoolName) previewText += `🏫 Maktab: ${schoolName}\n`;
  if (neighborhoodName) previewText += `🏘️ Mahalla: ${neighborhoodName}\n`;
  if (teacherSubject) previewText += `📚 Fan: ${teacherSubject}\n`;
  if (assignedClassName) previewText += `🏫 Sinf: ${assignedClassName}\n`;
  previewText += `\nTasdiqlaysizmi?`;

  const previewKb = new InlineKeyboard()
    .text("✅ Tasdiqlash", "confirm_staff_add")
    .row()
    .text("❌ Bekor qilish", "cancel_staff_add");

  await ctx.reply(previewText, { reply_markup: previewKb });

  let ctxConfirm = await conversation.waitForCallbackQuery([
    "confirm_staff_add",
    "cancel_staff_add",
  ]);
  await ctxConfirm.answerCallbackQuery();

  if (ctxConfirm.callbackQuery.data === "cancel_staff_add") {
    await ctx.reply("❌ Xodim qo'shish bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Step 5: Provision
  try {
    await conversation.external(() =>
      staffService.provisionStaff({
        actorUserId: actor.id,
        actorRole: effectiveRole,
        actorSchoolId: actor.schoolId,
        targetTelegramId,
        targetFullName: existingUser?.fullName || undefined,
        newRole: selectedRole,
        schoolId,
        neighborhoodId,
        teacherSubject,
        assignedClassName,
      })
    );

    const successScreen = staffAddSuccess(roleLabel);
    await ctx.reply(successScreen.text, { reply_markup: successScreen.keyboard });
  } catch (error: any) {
    const msg = error instanceof PermissionError ? error.message : `❌ Xatolik: ${error.message}`;
    await ctx.reply(msg, { reply_markup: mainMenu().keyboard });
  }
}
