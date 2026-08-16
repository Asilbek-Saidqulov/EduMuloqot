import type { BotContext } from "../../types";
import { studentRepo } from "../../repositories/studentRepo";
import { studentService } from "../../services/studentService";
import { authAdmin } from "../middleware/authAdmin";
import { adminMenuKeyboard } from "../keyboards/adminMenu";
import { InlineKeyboard } from "grammy";

export async function studentApprovalHandler(ctx: BotContext): Promise<void> {
  if (!ctx.admin) return;

  const admin = ctx.admin;
  if (!admin.schoolId) {
    await ctx.reply("Siz maktab admini emassiz.", { reply_markup: adminMenuKeyboard });
    return;
  }

  const pendingStudents = await studentRepo.listPendingBySchool(admin.schoolId);

  if (pendingStudents.length === 0) {
    await ctx.reply("Hozircha kutilayotgan o'quvchi tasdiqlash so'rovlari yo'q.", {
      reply_markup: adminMenuKeyboard,
    });
    return;
  }

  for (const student of pendingStudents) {
    const text =
      `⏳ Yangi o'quvchi tasdiqlash so'rovi\n\n` +
      `Farzand: ${student.fullName}\n` +
      `Sinf: ${student.className}\n` +
      `Ota-ona: ${student.parent?.fullName || "Noma'lum"}\n` +
      `Telefon: ${student.parent?.phone || "Ko'rsatilmagan"}\n` +
      `Maktab: ${student.school.name}`;

    const keyboard = new InlineKeyboard()
      .text("✅ Tasdiqlash", `approve_student:${student.id}`)
      .text("❌ Rad etish", `reject_student:${student.id}`);

    await ctx.reply(text, { reply_markup: keyboard });
  }

  await ctx.reply(`⏳ Jami ${pendingStudents.length} ta kutilayotgan so'rov.`, {
    reply_markup: adminMenuKeyboard,
  });
}

export async function approveStudentCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;
  
  const studentId = Number(ctx.callbackQuery.data.split(":")[1]);
  if (!ctx.admin) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
    return;
  }

  if (!ctx.admin.schoolId) {
    await ctx.answerCallbackQuery({ text: "Siz maktab admini emassiz.", show_alert: true });
    return;
  }

  try {
    await studentService.approveStudent(studentId, ctx.admin.schoolId);
    await ctx.answerCallbackQuery({ text: "O'quvchi tasdiqlandi." });
    await ctx.reply("✅ O'quvchi tasdiqlandi.", { reply_markup: adminMenuKeyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: (error as Error).message, show_alert: true });
  }
}

export async function rejectStudentCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;
  
  const studentId = Number(ctx.callbackQuery.data.split(":")[1]);
  if (!ctx.admin) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
    return;
  }

  if (!ctx.admin.schoolId) {
    await ctx.answerCallbackQuery({ text: "Siz maktab admini emassiz.", show_alert: true });
    return;
  }

  try {
    await studentService.rejectStudent(studentId, ctx.admin.schoolId);
    await ctx.answerCallbackQuery({ text: "O'quvchi rad etildi." });
    await ctx.reply("❌ O'quvchi rad etildi.", { reply_markup: adminMenuKeyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: (error as Error).message, show_alert: true });
  }
}
