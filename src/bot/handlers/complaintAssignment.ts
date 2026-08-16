import type { BotContext } from "../../types";
import { complaintRepo } from "../../repositories/complaintRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { complaintAssignmentService } from "../../services/complaintAssignmentService";
import { routingService } from "../../services/routingService";
import { authAdmin } from "../middleware/authAdmin";
import { assignToAdminKeyboard, complaintActionKeyboardWithAssignment } from "../keyboards/complaintAssignment";
import { adminMenuKeyboard } from "../keyboards/adminMenu";
import { STATUS_LABELS } from "../../types";

/**
 * Handler for routing a complaint to an admin
 * Shows list of active admins from the same school
 */
export async function routeComplaintHandler(ctx: BotContext): Promise<void> {
  if (!ctx.admin) return;

  const admin = ctx.admin;
  if (!admin.schoolId) {
    await ctx.reply("⛔️ Bu funksiya faqat maktab adminlari uchun.", { reply_markup: adminMenuKeyboard });
    return;
  }

  // Get active admins for this school
  const schoolAdmins = await adminRepo.listActiveBySchool(admin.schoolId);
  
  if (schoolAdmins.length === 0) {
    await ctx.reply("Bu maktabda boshqa faol adminlar yo'q.", { reply_markup: adminMenuKeyboard });
    return;
  }

  // Store complaint ID in session for the assignment callback
  const complaintId = ctx.session.complaintId;
  if (!complaintId) {
    await ctx.reply("Xatolik: murojaat ID topilmadi.", { reply_markup: adminMenuKeyboard });
    return;
  }

  // Show admin selection keyboard
  await ctx.reply("👥 Mas'ul xodimni tanlang:", {
    reply_markup: assignToAdminKeyboard(schoolAdmins as any),
  });
}

/**
 * Callback handler for assigning complaint to specific admin
 */
export async function assignToAdminCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;
  
  const admin = ctx.admin;
  if (!admin) return;

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  const complaintId = ctx.session.complaintId;

  if (!complaintId) {
    await ctx.answerCallbackQuery({ text: "Xatolik: murojaat ID topilmadi.", show_alert: true });
    return;
  }

  // Verify the target admin is from the same school
  const targetAdmin = await adminRepo.findById(targetAdminId);
  if (!targetAdmin || targetAdmin.schoolId !== admin.schoolId) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q: boshqa maktab adminiga biriktirib bo'lmaydi.", show_alert: true });
    return;
  }

  try {
    // C3 fix: pass the assigning admin's scope so assignComplaint can
    // re-validate the complaint at the DB level. This prevents a stale
    // ctx.session.complaintId from being used to assign a complaint the
    // admin no longer has access to (e.g. the complaint was moved to
    // another school after routeCallback set the session).
    //
    // SUPER_ADMIN (schoolId=null, neighborhoodId=null) passes an empty
    // scope and can assign any complaint. SCHOOL_ADMIN passes their
    // schoolId. NEIGHBORHOOD_ADMIN passes their neighborhoodId.
    const result = await complaintAssignmentService.assignComplaint({
      complaintId,
      fromAdminId: admin.id,
      toAdminId: targetAdminId,
      scope: {
        schoolId: admin.schoolId ?? undefined,
        neighborhoodId: admin.neighborhoodId ?? undefined,
      },
    });

    if (result.duplicate) {
      // Same-admin assignment: no duplicate notification was sent.
      await ctx.answerCallbackQuery({
        text: "ℹ️ Murojaat allaqachon shu mas'ul xodimga biriktirilgan.",
        show_alert: true,
      });
    } else {
      await ctx.answerCallbackQuery({ text: "✅ Murojaat mas'ul xodimga yo'naltirildi." });
      await ctx.reply(`✅ Murojaat ${(targetAdmin.fullName || "admin")}ga yo'naltirildi.`, {
        reply_markup: adminMenuKeyboard,
      });
    }

    // Clean up session
    delete ctx.session.complaintId;
  } catch (error) {
    const message = (error as Error).message;
    await ctx.answerCallbackQuery({ text: message || "Xatolik yuz berdi.", show_alert: true });
    console.error("Assignment error:", error);
  }
}

/**
 * Callback handler for showing routing options
 */
export async function routeCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const complaintId = Number(ctx.callbackQuery.data.split(":")[1]);
  const admin = ctx.admin;
  if (!admin) return;

  // Get complaint details
  const complaint = await complaintRepo.findByIdScoped(complaintId, {
    schoolId: admin.schoolId ?? undefined,
    neighborhoodId: admin.neighborhoodId ?? undefined,
  });

  if (!complaint) {
    await ctx.answerCallbackQuery({ text: "Murojaat topilmadi yoki ruxsat yo'q.", show_alert: true });
    return;
  }

  // Store complaint ID in session
  ctx.session.complaintId = complaintId;

  // Get recommended responsibility
  const recommendedResponsibility = routingService.getResponsibilityForCategory(complaint.category);
  const recommendedLabel = recommendedResponsibility ? routingService.getResponsibilityLabel(recommendedResponsibility) : null;

  let text =
    `${complaint.complaintNumber}\n` +
    `Holat: ${STATUS_LABELS[complaint.status]}\n` +
    `Kategoriya: ${complaint.category}\n\n` +
    `${complaint.description}`;

  if (recommendedResponsibility) {
    text += `\n\n💡 Tavsiya etilgan mas'ul: ${recommendedLabel}`;
  }

  await ctx.reply(text, {
    reply_markup: complaintActionKeyboardWithAssignment(complaintId),
  });
  await ctx.answerCallbackQuery();
}

/**
 * Callback handler for canceling assignment
 */
export async function cancelAssignCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  await ctx.answerCallbackQuery({ text: "Bekor qilindi." });
  await ctx.reply("Yo'naltirish bekor qilindi.", { reply_markup: adminMenuKeyboard });
  
  // Clean up session
  delete ctx.session.complaintId;
}
