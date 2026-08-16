import { prisma } from "../database/prisma";

export const adminRepo = {
  /** Telegram ID orqali admin ekanini tekshiradi — bo'lmasa null qaytadi. */
  async findByTelegramId(telegramId: bigint) {
    return prisma.admin.findUnique({
      where: { telegramId },
      include: { school: true, neighborhood: true } as any,
    });
  },

  /** ID orqali adminni topadi */
  async findById(id: number) {
    return prisma.admin.findUnique({
      where: { id },
      include: { school: true, neighborhood: true } as any,
    });
  },

  /** Maktab bo'yicha faol adminlarni ro'yxati */
  async listActiveBySchool(schoolId: number) {
    return prisma.admin.findMany({
      where: { schoolId, isActive: true } as any,
      include: { school: true } as any,
      orderBy: { createdAt: "asc" },
    });
  },

  /** Mahalla bo'yicha faol adminlarni ro'yxati */
  async listActiveByNeighborhood(neighborhoodId: number) {
    return prisma.admin.findMany({
      where: { neighborhoodId, isActive: true } as any,
      include: { neighborhood: true } as any,
      orderBy: { createdAt: "asc" },
    });
  },

  /** Adminga mas'uliyat qo'shadi */
  async addResponsibility(adminId: number, responsibility: string) {
    return (prisma as any).adminResponsibility.create({
      data: { adminId, responsibility },
    });
  },

  /** Admindan mas'uliyatni olib tashlaydi */
  async removeResponsibility(adminId: number, responsibility: string) {
    return (prisma as any).adminResponsibility.deleteMany({
      where: { adminId, responsibility },
    });
  },

  /** Adminning barcha mas'uliyatlarini almashtiradi */
  async setResponsibilities(adminId: number, responsibilities: string[]) {
    await (prisma as any).adminResponsibility.deleteMany({ where: { adminId } });
    if (responsibilities.length === 0) return [];
    return (prisma as any).adminResponsibility.createMany({
      data: responsibilities.map((r) => ({ adminId, responsibility: r })),
      skipDuplicates: true,
    });
  },

  /** Adminni deaktivatsiya qiladi */
  async deactivate(adminId: number) {
    return prisma.admin.update({
      where: { id: adminId },
      data: { isActive: false } as any,
    });
  },

  /** Adminni aktivatsiya qiladi */
  async activate(adminId: number) {
    return prisma.admin.update({
      where: { id: adminId },
      data: { isActive: true } as any,
    });
  },

  /** Yangi admin yaratadi */
  async create(data: {
    telegramId: bigint;
    fullName?: string;
    role: string;
    schoolId?: number;
    neighborhoodId?: number;
  }) {
    return prisma.admin.create({
      data: data as any,
      include: { school: true, neighborhood: true },
    });
  },

  /** Admin ma'lumotlarini yangilaydi */
  async update(id: number, data: {
    fullName?: string;
    role?: string;
    schoolId?: number;
    neighborhoodId?: number;
    isActive?: boolean;
  }) {
    return prisma.admin.update({
      where: { id },
      data: data as any,
      include: { school: true, neighborhood: true },
    });
  },
};
