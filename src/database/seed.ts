import { prisma } from "./prisma";
import { bootstrapAdminIds } from "../config/env";

// Pilot uchun maktab va mahalla
const PILOT_SCHOOL = "258-son umumiy o'rta ta'lim maktabi";
const PILOT_NEIGHBORHOOD = "Uvaysiy MFY";

// MVP uchun boshlang'ich (namuna) maktab va mahallalar ro'yxati.
// Productionda bu ma'lumotlar admin panel yoki to'g'ridan-to'g'ri DB orqali to'ldiriladi.
const SCHOOL_NAMES = [PILOT_SCHOOL, "1-son maktab", "5-son maktab", "12-son maktab"];
const NEIGHBORHOOD_NAMES = [PILOT_NEIGHBORHOOD, "Yunusobod MFY", "Chilonzor MFY", "Mirzo Ulug'bek MFY"];

async function ensureSchool(name: string) {
  const existing = await prisma.school.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.school.create({ data: { name } });
}

async function ensureNeighborhood(name: string) {
  const existing = await prisma.neighborhood.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.neighborhood.create({ data: { name } });
}

async function main() {
  console.log("🌱 Seed boshlandi...");

  const schools = [];
  for (const name of SCHOOL_NAMES) {
    schools.push(await ensureSchool(name));
  }

  const neighborhoods = [];
  for (const name of NEIGHBORHOOD_NAMES) {
    neighborhoods.push(await ensureNeighborhood(name));
  }

  // BOOTSTRAP_ADMIN_IDS - faqat SUPER_ADMIN hisoblarini yaratish uchun ishlatiladi.
  // Har bir bootstrap ID uchun: role = SUPER_ADMIN, isActive = true, schoolId = null, neighborhoodId = null
  // Boshqa barcha adminlar (SCHOOL_ADMIN, NEIGHBORHOOD_ADMIN) SUPER_ADMIN Management UI orqali yaratiladi.
  //
  // Phase 4 Hardening: bootstrap IDs are now upserted into BOTH the
  // legacy `admins` table AND the canonical `users` table. Previously
  // only the admins table was touched, which meant a bootstrap SUPER_ADMIN
  // who sent /start for the first time got a User row created with the
  // default role=PARENT — and then `getEffectiveRole` had to combine
  // User.role=PARENT with Admin.role=SUPER_ADMIN to recover the
  // SUPER_ADMIN privilege. That worked but was fragile: if the Admin
  // row was ever deactivated (e.g. via the legacy admin management UI),
  // the user fell back to PARENT with no SUPER_ADMIN privilege at all.
  //
  // Now: the User record is the source of truth. Bootstrap sets
  // User.role=SUPER_ADMIN, User.isActive=true. The admins table row
  // is kept in sync for legacy code paths (authAdmin middleware,
  // complaint assignment, etc.) — but the User row is what matters
  // for the new Phase 4 permission system.
  let createdAdmins = 0;
  let updatedAdmins = 0;
  for (const telegramId of bootstrapAdminIds) {
    // 1. Upsert the User record (canonical source of truth).
    const existingUser = await prisma.user.findUnique({ where: { telegramId } });
    if (existingUser) {
      // Update existing User to SUPER_ADMIN, active, no scope.
      // We do NOT touch fullName/phone/parentRole — those may have
      // been set by the user themselves if they previously used the
      // bot as a parent.
      await prisma.$executeRaw`
        UPDATE "users"
        SET "role" = 'SUPER_ADMIN',
            "isActive" = true,
            "schoolId" = NULL,
            "neighborhoodId" = NULL
        WHERE "telegramId" = ${telegramId}
      `;
    } else {
      // Create new SUPER_ADMIN User with no scope.
      await prisma.$executeRaw`
        INSERT INTO "users" ("telegramId", "fullName", "role", "isActive", "schoolId", "neighborhoodId", "createdAt")
        VALUES (${telegramId}, 'SUPER_ADMIN', 'SUPER_ADMIN', true, NULL, NULL, NOW())
      `;
    }

    // 2. Upsert the legacy Admin record (kept in sync for backward compat).
    const existingAdmin = await prisma.admin.findUnique({ where: { telegramId } });
    if (existingAdmin) {
      await prisma.$executeRaw`
        UPDATE "admins"
        SET "role" = 'SUPER_ADMIN',
            "isActive" = true,
            "schoolId" = NULL,
            "neighborhoodId" = NULL
        WHERE "telegramId" = ${telegramId}
      `;
      updatedAdmins += 1;
    } else {
      await prisma.$executeRaw`
        INSERT INTO "admins" ("telegramId", "fullName", "role", "schoolId", "neighborhoodId", "isActive", "createdAt")
        VALUES (${telegramId}, 'SUPER_ADMIN', 'SUPER_ADMIN', NULL, NULL, true, NOW())
      `;
      createdAdmins += 1;
    }
  }

  console.log(`✅ ${schools.length} maktab tayyor.`);
  console.log(`✅ ${neighborhoods.length} mahalla tayor.`);
  console.log(`✅ ${createdAdmins} yangi SUPER_ADMIN yaratildi.`);
  console.log(`✅ ${updatedAdmins} SUPER_ADMIN yangilandi.`);
  console.log(`📍 Pilot maktab: ${PILOT_SCHOOL}`);
  console.log(`📍 Pilot mahalla: ${PILOT_NEIGHBORHOOD}`);
}

main()
  .catch((err) => {
    console.error("❌ Seed xatosi:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
