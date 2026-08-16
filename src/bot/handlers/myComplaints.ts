import type { BotContext } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { complaintRepo } from "../../repositories/complaintRepo";
import { myComplaints } from "../ui/screens";
import { mainMenuKeyboard } from "../keyboards/mainMenu";
import { InlineKeyboard } from "grammy";

/**
 * "📋 Murojaatlarim" tugmasi (hears) — shows the same UI as the
 * inline "my_complaints" callback.
 *
 * Bug Fix #9: Previously this handler showed a plain text list with
 * a ReplyKeyboard (no inline complaint buttons, no date filters).
 * Now it shows the same InlineKeyboard as `showMyComplaints` — with
 * complaint buttons + date filter buttons — so the UX is consistent
 * regardless of how the user triggers it.
 */
export async function myComplaintsHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user) {
    await ctx.reply("Sizda hali yuborilgan murojaatlar yo'q.", { reply_markup: mainMenuKeyboard });
    return;
  }

  const complaints = await complaintRepo.listByParent(user.id);

  if (complaints.length === 0) {
    const filterKb = new InlineKeyboard()
      .text("📅 Oxirgi 7 kun", "my_complaints:7")
      .row()
      .text("📅 Oxirgi 30 kun", "my_complaints:30")
      .row()
      .text("📋 Barchasi", "my_complaints")
      .row()
      .text("◀️ Bosh menyu", "home");
    await ctx.reply("📋 Sizda murojaatlar yo'q.", { reply_markup: filterKb });
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

  // Append filter buttons to the complaint list keyboard
  screen.keyboard
    .row()
    .text("📅 7 kun", "my_complaints:7")
    .text("📅 30 kun", "my_complaints:30")
    .row()
    .text("📋 Barchasi", "my_complaints");

  await ctx.reply(screen.text, { reply_markup: screen.keyboard });
}
