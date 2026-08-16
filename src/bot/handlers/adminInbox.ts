import type { ComplaintStatus } from "@prisma/client";
import type { BotContext } from "../../types";
import { complaintRepo } from "../../repositories/complaintRepo";
import { complaintListKeyboard } from "../keyboards/adminMenu";

/**
 * Adminning "📥 Yangi murojaatlar" / "🔄 Jarayondagi murojaatlar" / "✅ Hal qilinganlar"
 * tugmalari uchun umumiy handler. ctx.admin authAdmin middleware'i tomonidan to'ldiriladi
 * va admin faqat o'z maktabi yoki mahallasiga tegishli murojaatlarni ko'radi (§7-band).
 */
export async function adminInboxHandler(ctx: BotContext, status?: ComplaintStatus): Promise<void> {
  const admin = ctx.admin;
  if (!admin) {
    await ctx.reply("⛔️ Sizda admin huquqi yo'q.");
    return;
  }

  // M5 fix: SUPER_ADMIN (no schoolId/neighborhoodId) can view ALL complaints.
  // Previously they were rejected with "Sizga hali maktab yoki mahalla
  // biriktirilmagan" — inconsistent with their global privileges.
  let complaints: any[];
  if (admin.schoolId) {
    complaints = await complaintRepo.listForSchoolAdmin(admin.schoolId, status);
  } else if (admin.neighborhoodId) {
    complaints = await complaintRepo.listForNeighborhoodAdmin(admin.neighborhoodId, status);
  } else {
    // SUPER_ADMIN: fetch all complaints (school + neighborhood)
    const { prisma } = await import("../../database/prisma");
    complaints = await prisma.complaint.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      include: { sender: true, student: true, school: true, neighborhood: true },
    });
  }

  if (complaints.length === 0) {
    await ctx.reply("Bu bo'limda hozircha murojaatlar yo'q.");
    return;
  }

  const items = complaints.map((c) => ({
    id: c.id,
    label: `${c.complaintNumber} — ${c.category}`,
  }));

  await ctx.reply("Murojaatlar ro'yxati (ko'rish uchun bosing):", {
    reply_markup: complaintListKeyboard(items),
  });
}
