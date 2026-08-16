import { InlineKeyboard, Keyboard } from "grammy";

/**
 * Phase 5+: Role-specific admin panel keyboards.
 *
 * Each role sees ONLY the functions they have permission to use.
 * This replaces the old "one size fits all" adminMenuKeyboard that
 * showed every button to every admin regardless of role.
 *
 * Role → menu mapping:
 *   TEACHER / CLASS_TEACHER  → attendance-focused (record + view class)
 *   MAHALLA_RESPONSIBLE      → escalation-focused (view absences)
 *   SCHOOL_ADMIN             → school-scoped (complaints, approvals, staff, reports)
 *   ADMIN                    → global (same as SCHOOL_ADMIN but global scope)
 *   SUPER_ADMIN              → everything + admin management
 *
 * Legacy `adminMenuKeyboard` is kept for backward compatibility with
 * existing handlers that import it as a fallback.
 */

/**
 * TEACHER / CLASS_TEACHER panel.
 * Permissions: MANAGE_ATTENDANCE, VIEW_CLASS_ATTENDANCE
 * These roles are attendance-focused — they don't handle complaints,
 * approve students, or manage other staff.
 */
export const teacherPanelKeyboard = new Keyboard()
  .text("📋 Davomat")
  .text("📊 Davomat hisoboti")
  .row()
  .text("🏠 Bosh menyu")
  .resized();

/**
 * MAHALLA_RESPONSIBLE panel.
 * Permissions: VIEW_NEIGHBORHOOD_ATTENDANCE
 * Views attendance escalations for their neighborhood. Does NOT record
 * attendance, does NOT handle school complaints.
 */
export const mahallaPanelKeyboard = new Keyboard()
  .text("🚨 Ogohlantirishlar")
  .text("📊 Davomat hisoboti")
  .row()
  .text("🏠 Bosh menyu")
  .resized();

/**
 * SCHOOL_ADMIN panel.
 * Permissions: VIEW_COMPLAINTS, MANAGE_COMPLAINTS, REPLY_TO_COMPLAINTS,
 *   VIEW_SCHOOL_DATA, MANAGE_STAFF, VIEW_SCHOOL_ATTENDANCE
 * School-scoped — can only see/manage their own school's data.
 * Phase 5+: Removed "👨‍🎓 O'quvchi tasdiqlashlari" (students are now
 * auto-verified on claim — no manual approval needed). Added "📋 Arizalar"
 * for student applications. Added "📋 Belgilanmagan" for staff workload.
 */
export const schoolAdminPanelKeyboard = new Keyboard()
  .text("📥 Yangi murojaatlar")
  .text("🔄 Jarayondagi murojaatlar")
  .row()
  .text("✅ Hal qilinganlar")
  .text("🎯 Menga biriktirilgan")
  .row()
  .text("📋 Arizalar")
  .text("📊 Statistika")
  .row()
  .text("👥 Xodimlarni boshqarish")
  .text("📊 Davomat hisoboti")
  .row()
  .text("📋 Belgilanmagan sinflar")
  .text("🗄 Arxiv")
  .row()
  .text("🏠 Bosh menyu")
  .resized();

/**
 * ADMIN panel (global scope).
 * Same capabilities as SCHOOL_ADMIN but global — can see all schools.
 * Does NOT have "Adminlarni boshqarish" (SUPER_ADMIN only).
 */
export const adminPanelKeyboard = new Keyboard()
  .text("📥 Yangi murojaatlar")
  .text("🔄 Jarayondagi murojaatlar")
  .row()
  .text("✅ Hal qilinganlar")
  .text("🎯 Menga biriktirilgan")
  .row()
  .text("📋 Arizalar")
  .text("📊 Statistika")
  .row()
  .text("👥 Xodimlarni boshqarish")
  .text("📊 Davomat hisoboti")
  .row()
  .text("🏠 Bosh menyu")
  .resized();

/**
 * SUPER_ADMIN panel — system management focused.
 * Phase 9 Fix: Removed operational complaint buttons (Yangi murojaatlar,
 * Jarayondagi, Hal qilingan, Menga biriktirilgan) — SUPER_ADMIN is a
 * system administrator, not a complaint operator. Added /status.
 */
export const superAdminPanelKeyboard = new Keyboard()
  .text("📊 Statistika")
  .text("📊 Davomat hisoboti")
  .row()
  .text("📋 Arizalar")
  .text("👥 Xodimlarni boshqarish")
  .row()
  .text("🏠 Bosh menyu")
  .resized();

/**
 * Legacy fallback keyboard — kept for backward compatibility with
 * existing handlers that reference `adminMenuKeyboard` directly.
 * Equivalent to the SCHOOL_ADMIN panel.
 */
export const adminMenuKeyboard = schoolAdminPanelKeyboard;

/**
 * Get the role-specific panel keyboard.
 *
 * @param effectiveRole The effective role string (from getEffectiveRole,
 *   combining User.role and legacy Admin.role). One of:
 *   "TEACHER", "CLASS_TEACHER", "MAHALLA_RESPONSIBLE",
 *   "SCHOOL_ADMIN", "ADMIN", "SUPER_ADMIN"
 */
export function getAdminMenuKeyboard(role: string): Keyboard {
  switch (role) {
    case "TEACHER":
    case "CLASS_TEACHER":
      return teacherPanelKeyboard;
    case "MAHALLA_RESPONSIBLE":
      return mahallaPanelKeyboard;
    case "SCHOOL_ADMIN":
      return schoolAdminPanelKeyboard;
    case "ADMIN":
      return adminPanelKeyboard;
    case "SUPER_ADMIN":
      return superAdminPanelKeyboard;
    default:
      // Unknown role — fall back to the school admin panel.
      return schoolAdminPanelKeyboard;
  }
}

// ─── Inline keyboards for complaint actions (unchanged) ───────────────

export function complaintActionKeyboard(complaintId: number) {
  return new InlineKeyboard()
    .text("🔵 Ko'rib chiqilmoqda", `status:${complaintId}:IN_PROGRESS`)
    .row()
    .text("🟢 Hal qilindi", `status:${complaintId}:RESOLVED`)
    .text("🔴 Rad etildi", `status:${complaintId}:REJECTED`)
    .row()
    .text("💬 Javob berish", `reply:${complaintId}`);
}

export function complaintListKeyboard(complaintIds: { id: number; label: string }[]) {
  const kb = new InlineKeyboard();
  complaintIds.forEach(({ id, label }) => {
    kb.text(label, `view:${id}`).row();
  });
  return kb;
}
