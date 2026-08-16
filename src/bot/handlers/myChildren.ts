import type { BotContext } from "../../types";
import { StudentVerificationStatus } from "@prisma/client";
import { studentRepo } from "../../repositories/studentRepo";
import { userRepo } from "../../repositories/userRepo";
import { STUDENT_VERIFICATION_LABELS } from "../../types";
import { mainMenuKeyboard } from "../keyboards/mainMenu";
import { Keyboard } from "grammy";

export async function myChildrenHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user) {
    await ctx.reply("Siz hali ro'yxatdan o'tmaganingiz.", { reply_markup: mainMenuKeyboard });
    return;
  }

  const students = await studentRepo.listByParent(user.id);

  if (students.length === 0) {
    const kb = new Keyboard()
      .text("➕ Farzand qo'shish")
      .row()
      .text("❌ Bekor qilish")
      .resized();
    await ctx.reply("Sizda hali ro'yxatga olingan farzandlar yo'q.", { reply_markup: kb });
    return;
  }

  const lines = students.map((s) => {
    const status = STUDENT_VERIFICATION_LABELS[s.verificationStatus] || "?";
    return `${status} ${s.fullName} — ${s.className}`;
  });

  const kb = new Keyboard()
    .text("➕ Farzand qo'shish")
    .row()
    .text("❌ Bekor qilish")
    .resized();

  await ctx.reply(`👨‍👩‍👧 Sizning farzandlaringiz:\n\n${lines.join("\n")}`, { reply_markup: kb });
}
