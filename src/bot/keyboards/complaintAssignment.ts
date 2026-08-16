import { InlineKeyboard } from "grammy";

export function assignToAdminKeyboard(admins: Array<{ id: number; fullName: string | null; responsibilities: any[] }>) {
  const kb = new InlineKeyboard();
  admins.forEach((admin) => {
    const responsibilities = admin.responsibilities?.map((r: any) => r.responsibility).join(", ") || "";
    const label = admin.fullName || `Admin ${admin.id}`;
    kb.text(`${label}${responsibilities ? ` (${responsibilities})` : ""}`, `assign_to:${admin.id}`).row();
  });
  kb.text("❌ Bekor qilish", `cancel_assign`).row();
  return kb;
}

export function complaintActionKeyboardWithAssignment(complaintId: number) {
  return new InlineKeyboard()
    .text("➡️ Mas'ulga yo'naltirish", `route:${complaintId}`)
    .row()
    .text("🔵 Ko'rib chiqilmoqda", `status:${complaintId}:IN_PROGRESS`)
    .row()
    .text("🟢 Hal qilindi", `status:${complaintId}:RESOLVED`)
    .text("🔴 Rad etildi", `status:${complaintId}:REJECTED`)
    .row()
    .text("💬 Javob berish", `reply:${complaintId}`);
}
