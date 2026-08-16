import { InlineKeyboard } from "grammy";

export function studentApprovalKeyboard(studentId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Tasdiqlash", `approve_student:${studentId}`)
    .text("❌ Rad etish", `reject_student:${studentId}`);
}

export function adminMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📥 Yangi murojaatlar", "inbox:NEW")
    .row()
    .text("🔄 Jarayondagi murojaatlar", "inbox:IN_PROGRESS")
    .row()
    .text("✅ Hal qilinganlar", "inbox:RESOLVED")
    .row()
    .text("👨‍🎓 O'quvchi tasdiqlashlari", "student_approvals")
    .row()
    .text("📊 Statistika", "stats");
}
