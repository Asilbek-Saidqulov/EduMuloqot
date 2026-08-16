import { InlineKeyboard, Keyboard } from "grammy";

// SUPER_ADMIN management menu
export const superAdminMenuKeyboard = new Keyboard()
  .text("👥 Barcha adminlar")
  .text("➕ Admin qo'shish")
  .row()
  .text("🏫 Maktab adminlari")
  .text("🏘️ Mahalla adminlari")
  .row()
  .text("🔙 Admin menyusi")
  .resized();

// Role selection keyboard
export function roleSelectionKeyboard() {
  return new InlineKeyboard()
    .text("👑 SUPER_ADMIN", "role:SUPER_ADMIN")
    .row()
    .text("🏫 SCHOOL_ADMIN", "role:SCHOOL_ADMIN")
    .row()
    .text("🏘️ NEIGHBORHOOD_ADMIN", "role:NEIGHBORHOOD_ADMIN")
    .row()
    .text("❌ Bekor qilish", "cancel:add_admin");
}

// Responsibility selection keyboard (multi-select)
export function responsibilitySelectionKeyboard(selected: Set<string>) {
  const responsibilities = [
    { key: "COMPLAINT_MANAGER", label: "Murojaatlarni boshqarish" },
    { key: "PSYCHOLOGIST", label: "Psixolog" },
    { key: "SOCIAL_WORKER", label: "Ijtimoiy xodim" },
    { key: "EDUCATION", label: "Ta'lim" },
    { key: "DISCIPLINE", label: "Intizom" },
    { key: "STUDENT_AFFAIRS", label: "O'quvchilar bilan ishlash" },
  ];

  const kb = new InlineKeyboard();
  responsibilities.forEach(({ key, label }) => {
    const isSelected = selected.has(key);
    kb.text(`${isSelected ? "☑" : "☐"} ${label}`, `toggle_resp:${key}`).row();
  });
  kb.text("✅ Saqlash", "save_responsibilities").row();
  kb.text("❌ Bekor qilish", "cancel:responsibilities");
  return kb;
}

// School selection keyboard
export function schoolSelectionKeyboard(schools: Array<{ id: number; name: string }>) {
  const kb = new InlineKeyboard();
  schools.forEach((school) => {
    kb.text(school.name, `select_school:${school.id}`).row();
  });
  kb.text("❌ Bekor qilish", "cancel:school");
  return kb;
}

// Neighborhood selection keyboard
export function neighborhoodSelectionKeyboard(neighborhoods: Array<{ id: number; name: string }>) {
  const kb = new InlineKeyboard();
  neighborhoods.forEach((neighborhood) => {
    kb.text(neighborhood.name, `select_neighborhood:${neighborhood.id}`).row();
  });
  kb.text("❌ Bekor qilish", "cancel:neighborhood");
  return kb;
}

// Admin list keyboard
export function adminListKeyboard(admins: Array<{ id: number; fullName: string | null; role: string; schoolName?: string | null; neighborhoodName?: string | null; isActive: boolean }>) {
  const kb = new InlineKeyboard();
  admins.forEach((admin) => {
    const status = admin.isActive ? "🟢" : "🔴";
    const scope = admin.schoolName || admin.neighborhoodName || "Global";
    const label = `${status} ${admin.fullName || `Admin ${admin.id}`} (${admin.role} - ${scope})`;
    kb.text(label, `view_admin:${admin.id}`).row();
  });
  kb.text("🔙 Orqaga", "back_to_menu");
  return kb;
}

// Admin detail keyboard
export function adminDetailKeyboard(adminId: number) {
  return new InlineKeyboard()
    .text("🎯 Mas'uliyatlarni o'zgartirish", `edit_resp:${adminId}`)
    .row()
    .text("🏫 Scope'ni o'zgartirish", `edit_scope:${adminId}`)
    .row()
    .text("✏️ Ismni o'zgartirish", `edit_name:${adminId}`)
    .row()
    .text("🔴 Faolsizlantirish", `deactivate:${adminId}`)
    .text("🟢 Faollashtirish", `activate:${adminId}`)
    .row()
    .text("🗑️ O'chirish", `delete:${adminId}`)
    .row()
    .text("🔙 Orqaga", "back_to_list");
}

// Confirmation keyboard
export function confirmationKeyboard(action: string, adminId: number) {
  return new InlineKeyboard()
    .text("✅ Ha, tasdiqlash", `confirm:${action}:${adminId}`)
    .row()
    .text("❌ Bekor qilish", "cancel:confirmation");
}

// Role change keyboard
export function roleChangeKeyboard() {
  return new InlineKeyboard()
    .text("👑 SUPER_ADMIN", "change_role:SUPER_ADMIN")
    .row()
    .text("🏫 SCHOOL_ADMIN", "change_role:SCHOOL_ADMIN")
    .row()
    .text("🏘️ NEIGHBORHOOD_ADMIN", "change_role:NEIGHBORHOOD_ADMIN")
    .row()
    .text("❌ Bekor qilish", "cancel:role_change");
}
