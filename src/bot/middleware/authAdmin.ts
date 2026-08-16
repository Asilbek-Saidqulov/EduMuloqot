import type { NextFunction } from "grammy";
import type { BotContext } from "../../types";
import { adminRepo } from "../../repositories/adminRepo";
import { userRepo } from "../../repositories/userRepo";
import { isUserActiveStaff } from "../../auth/permissions";

/**
 * Faqat "admins" jadvalida ro'yxatdan o'tgan foydalanuvchilarga admin buyruqlari/tugmalariga
 * ruxsat beradi. Topilgan admin yozuvi (maktab/mahalla scope bilan) ctx.admin ga yoziladi —
 * shundan keyingi handlerlar (adminInbox, statistika, status o'zgartirish) shu scope asosida ishlaydi.
 *
 * Role-based scope enforcement:
 * - SUPER_ADMIN: global access, no school/neighborhood requirement
 * - SCHOOL_ADMIN: faqat schoolId bo'lgan adminlar maktab ma'lumotlariga kirishi mumkin
 * - NEIGHBORHOOD_ADMIN: faqat neighborhoodId bo'lgan adminlar mahalla ma'lumotlariga kirishi mumkin
 * - isActive: faqat aktiv adminlar admin funksiyalaridan foydalanishi mumkin
 *
 * Phase 4 Hardening:
 *   - In addition to checking Admin.isActive, we ALSO check User.isActive.
 *     This is defense-in-depth: a Super Admin who deactivates a staff
 *     member via the Phase 4 staff management UI sets User.isActive=false
 *     but does NOT necessarily touch the Admin table (the Admin row is
 *     synced separately by staffSyncService). If we only checked
 *     Admin.isActive, a deactivated staff member with a still-active
 *     Admin record could still access /admin.
 *   - The check uses `isUserActiveStaff()` from permissions.ts, which
 *     combines User.isActive with the effective role. A PARENT with an
 *     Admin record (legacy bootstrap scenario) is still treated as
 *     active staff if the Admin record is active — preserving backward
 *     compatibility.
 */
export async function authAdmin(ctx: BotContext, next: NextFunction): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);

  // Load both User and Admin records. Phase 4 Hardening: we MUST
  // consult User.isActive as well as Admin.isActive.
  const [admin, user] = await Promise.all([
    adminRepo.findByTelegramId(telegramId),
    userRepo.findByTelegramId(telegramId),
  ]);

  if (!admin) {
    await ctx.reply("⛔️ Sizda admin huquqi yo'q.");
    return;
  }

  // Check Admin.isActive (legacy check, preserved).
  const adminWithRole = admin as any;
  if (adminWithRole.isActive === false) {
    await ctx.reply("⛔️ Sizning admin hisobingiz deaktivatsiya qilingan. Administrator bilan bog'laning.");
    return;
  }

  // Phase 4 Hardening: also check User.isActive. If the user has been
  // deactivated via the Phase 4 staff management UI, they must NOT be
  // able to access /admin even if their Admin record is still active.
  // (The staffSyncService should sync Admin.isActive to match
  // User.isActive, but this is defense-in-depth in case of sync lag
  // or partial failures.)
  if (user && user.isActive === false) {
    await ctx.reply("⛔️ Sizning hisobingiz faol emas. Administrator bilan bog'laning.");
    return;
  }

  // Role-based scope validation
  if (adminWithRole.role === "SCHOOL_ADMIN" && !admin.schoolId) {
    await ctx.reply("⛔️ Siz maktab adminisiz, lekin hech qanday maktabga biriktirilmagansiz.");
    return;
  }

  if (adminWithRole.role === "NEIGHBORHOOD_ADMIN" && !admin.neighborhoodId) {
    await ctx.reply("⛔️ Siz mahalla adminisiz, lekin hech qanday mahallaga biriktirilmagansiz.");
    return;
  }

  // SUPER_ADMIN has no scope requirements
  ctx.admin = admin as any;
  await next();
}
