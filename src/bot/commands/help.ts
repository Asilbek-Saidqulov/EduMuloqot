import type { BotContext } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import {
  getEffectiveRole,
  isStaffRole,
  isUserActiveStaff,
} from "../../auth/permissions";
import { mainMenu } from "../ui/screens";
import { getAdminMenuKeyboard } from "../keyboards/adminMenu";

/**
 * Role-aware help command.
 *
 * Shows different help text based on the user's effective role:
 *   - PARENT: complaint + child management help
 *   - STUDENT: attendance view help
 *   - TEACHER/CLASS_TEACHER: attendance recording help
 *   - SCHOOL_ADMIN: complaint + staff + application help
 *   - MAHALLA_RESPONSIBLE: escalation help
 *   - ADMIN/SUPER_ADMIN: full system help
 */
export async function helpCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    await ctx.reply("ℹ️ Yordam — /start ni bosing.");
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);

  const adminForCheck = admin
    ? { role: admin.role, isActive: admin.isActive }
    : null;

  const effectiveRole = user
    ? getEffectiveRole(
        { role: user.role, isActive: user.isActive },
        adminForCheck
      )
    : "PARENT";

  const helpText = getRoleHelp(effectiveRole);

  // Show the role-specific keyboard alongside help.
  if (user && isStaffRole(user.role) && isUserActiveStaff(
    { role: user.role, isActive: user.isActive },
    adminForCheck
  )) {
    await ctx.reply(helpText, {
      reply_markup: getAdminMenuKeyboard(effectiveRole),
    });
  } else {
    await ctx.reply(helpText, {
      reply_markup: mainMenu().keyboard,
    });
  }
}

function getRoleHelp(role: string): string {
  const header = "ℹ️ Yordam\n\n";

  switch (role) {
    case "TEACHER":
    case "CLASS_TEACHER":
      return header +
        "📋 Davomat — sinfingiz o'quvchilari davomatini belgilash\n" +
        "📊 Davomat hisoboti — sinfingiz davomat statistikasi\n\n" +
        "Har kuni davomatni belgilang. Ota-onalar avtomatik xabar oladi.\n" +
        "💡 /panel — tezda panelingizga qaytish";

    case "MAHALLA_RESPONSIBLE":
      return header +
        "🚨 Ogohlantirishlar — 3+ kun davom etmagan o'quvchilar ro'yxati\n" +
        "📊 Davomat hisoboti — mahallangiz bo'yicha hisobot\n\n" +
        "Ogohlantirish kelganda o'quvchi oilasi bilan bog'laning.\n" +
        "💡 /panel — tezda panelingizga qaytish";

    case "SCHOOL_ADMIN":
      return header +
        "📥 Yangi murojaatlar — ota-onalardan yangi murojaatlar\n" +
        "🎯 Menga biriktirilgan — sizga biriktirilgan murojaatlar\n" +
        "📋 Arizalar — o'quvchilarning ro'yxatga qo'shish arizalari\n" +
        "👥 Xodimlarni boshqarish — o'qituvchilar qo'shish/boshqarish\n" +
        "📊 Davomat hisoboti — maktab bo'yicha hisobot\n\n" +
        "💡 /panel — tezda panelingizga qaytish";

    case "ADMIN":
    case "SUPER_ADMIN":
      return header +
        "📥 Murojaatlar — barcha maktablar bo'yicha murojaatlar\n" +
        "📋 Arizalar — o'quvchi arizalari\n" +
        "👥 Xodimlarni boshqarish — barcha xodimlarni boshqarish\n" +
        "📊 Davomat hisoboti — global davomat hisoboti\n" +
        "💡 /status — tizim holatini ko'rish\n" +
        "💡 /panel — tezda panelingizga qaytish";

    case "STUDENT":
      return header +
        "📋 Mening davomatim — o'z davomatingizni ko'rish\n" +
        "Agar ro'yxatda topa olmasangiz, maktab adminiga ariza yuboring.\n" +
        "💡 /panel — panelingizga qaytish";

    case "PARENT":
    default:
      return header +
        "📝 Murojaat yuborish — maktabga yoki mahallaga murojaat\n" +
        "📋 Murojaatlarim — yuborgan murojaatlaringiz va holati\n" +
        "👨‍👩‍👧 Farzandlarim — farzandingiz ma'lumotlari va davomati\n" +
        "👤 Profil — ma'lumotlaringizni o'zgartirish\n\n" +
        "Har bir murojaat #EDU-XXXXXX ko'rinishidagi ID oladi.\n" +
        "Murojaat holati o'zgarganda sizga avtomatik xabar keladi.";
  }
}
