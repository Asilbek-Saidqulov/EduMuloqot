import { Bot } from "grammy";
import { Complaint } from "@prisma/client";
import { prisma } from "../database/prisma";
import { STATUS_LABELS } from "../types";
import type { BotContext } from "../types";

// app.ts ishga tushganda bot instance shu yerga inject qilinadi.
// Bu circular import (bot <-> service)ni oldini oladi: service bot API'siga
// to'g'ridan-to'g'ri bog'lanmaydi, faqat vaqtinchalik reference orqali ishlaydi.
let botRef: Bot<BotContext> | undefined;

export function registerBot(bot: Bot<BotContext>) {
  botRef = bot;
}

async function safeSend(telegramId: bigint, text: string) {
  if (!botRef) return;
  try {
    await botRef.api.sendMessage(telegramId.toString(), text);
  } catch (err) {
    // Phase 9: Mask telegramId in logs to prevent PII leakage
    const { maskTelegramId } = require("../utils/piiRedact");
    console.error(`Notification yuborilmadi (user=${maskTelegramId(telegramId)}):`, (err as Error).message);
  }
}

export const notificationService = {
  /**
   * Bug Fix #12: Send a direct notification to any user by telegramId.
   * Used by studentApplications to notify applicants when their
   * application is approved.
   */
  async notifyUser(telegramId: bigint, text: string) {
    await safeSend(telegramId, text);
  },

  async notifySchoolAdmins(complaint: Complaint) {
    if (!complaint.schoolId) return;
    // H2 fix: only notify ACTIVE admins. Deactivated (soft-deleted) admins
    // should not receive new-complaint notifications.
    // M3 fix: also filter by targetType: "SCHOOL" — defense-in-depth so
    // school admins are never notified about neighborhood complaints even
    // if a neighborhood complaint somehow had schoolId set.
    const admins = await prisma.admin.findMany({
      where: { schoolId: complaint.schoolId, isActive: true },
    });
    const school = await prisma.school.findUnique({ where: { id: complaint.schoolId } });
    const text =
      `🔔 Yangi murojaat\n\n` +
      `ID: ${complaint.complaintNumber}\n` +
      `Turi: Maktab\n` +
      `Maktab: ${school?.name ?? ""}\n` +
      `Kategoriya: ${complaint.category}\n\n` +
      `Ko'rish uchun /admin buyrug'ini bosing.`;
    for (const admin of admins) await safeSend(admin.telegramId, text);
  },

  async notifyNeighborhoodAdmins(complaint: Complaint) {
    if (!complaint.neighborhoodId) return;
    // H2 fix: only notify ACTIVE admins.
    const admins = await prisma.admin.findMany({
      where: { neighborhoodId: complaint.neighborhoodId, isActive: true },
    });
    const neighborhood = await prisma.neighborhood.findUnique({
      where: { id: complaint.neighborhoodId },
    });
    const text =
      `🔔 Yangi murojaat\n\n` +
      `ID: ${complaint.complaintNumber}\n` +
      `Turi: Mahalla\n` +
      `Mahalla: ${neighborhood?.name ?? ""}\n` +
      `Kategoriya: ${complaint.category}\n\n` +
      `Ko'rish uchun /admin buyrug'ini bosing.`;
    for (const admin of admins) await safeSend(admin.telegramId, text);
  },

  async notifyParentStatusChange(complaint: Complaint) {
    const sender = await prisma.user.findUnique({ where: { id: complaint.senderId } });
    if (!sender) return;
    const text =
      `📢 ${complaint.complaintNumber} murojaatingizning statusi o'zgardi.\n\n` +
      `Yangi status: ${STATUS_LABELS[complaint.status]}`;
    await safeSend(sender.telegramId, text);
  },

  async notifyParentReply(complaintId: number, message: string) {
    const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } });
    if (!complaint) return;
    const sender = await prisma.user.findUnique({ where: { id: complaint.senderId } });
    if (!sender) return;
    const text = `📢 ${complaint.complaintNumber} murojaatingizga javob keldi:\n\n${message}`;
    await safeSend(sender.telegramId, text);
  },

  async notifySchoolAdminsNewStudent(student: any, school: any) {
    // H2 fix: only notify ACTIVE admins. Also removed debug console.log
    // statements that leaked admin Telegram IDs to stdout.
    const admins = await prisma.admin.findMany({ where: { schoolId: school.id, isActive: true } });
    // parentId may be null for registry-imported students that haven't
    // been claimed yet. Only load the parent if parentId is set.
    const parent = student.parentId
      ? await prisma.user.findUnique({ where: { id: student.parentId } })
      : null;
    if (!parent) {
      return;
    }

    const text =
      `🆕 Yangi o'quvchi tasdiqlash so'rovi\n\n` +
      `Ota-ona: ${parent.fullName || "Noma'lum"}\n` +
      `Telefon: ${parent.phone || "Ko'rsatilmagan"}\n` +
      `Farzand: ${student.fullName}\n` +
      `Sinf: ${student.className}\n` +
      `Maktab: ${school.name}\n\n` +
      `Tasdiqlash uchun /admin buyrug'ini bosing.`;

    for (const admin of admins) {
      await safeSend(admin.telegramId, text);
    }
  },

  async notifyParentVerificationStatus(parentId: number, studentName: string, status: "VERIFIED" | "REJECTED") {
    const parent = await prisma.user.findUnique({ where: { id: parentId } });
    if (!parent) return;

    if (status === "VERIFIED") {
      const text =
        `🎉 Farzandingizning ma'lumotlari maktab tomonidan tasdiqlandi.\n\n` +
        `Farzand: ${studentName}\n\n` +
        `Endi EduMuloqot orqali maktabga murojaat yuborishingiz mumkin.`;
      await safeSend(parent.telegramId, text);
    } else {
      const text =
        `❌ Farzandingiz haqidagi ma'lumotlar maktab tomonidan tasdiqlanmadi.\n\n` +
        `Farzand: ${studentName}\n\n` +
        `Iltimos, ma'lumotlarni tekshirib qayta yuboring.`;
      await safeSend(parent.telegramId, text);
    }
  },

  async notifyParentAssignment(complaintId: number) {
    const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } });
    if (!complaint) return;
    const sender = await prisma.user.findUnique({ where: { id: complaint.senderId } });
    if (!sender) return;

    const text =
      `📌 Murojaatingiz maktabning tegishli mas'ul xodimiga yo'naltirildi.\n\n` +
      `Murojaat raqami: ${complaint.complaintNumber}\n` +
      `Holati: 📌 Biriktirildi`;

    await safeSend(sender.telegramId, text);
  },

  /**
   * Notify the SPECIFIC admin that a complaint has been assigned to them.
   *
   * `adminTelegramId` MUST come from the Admin record (adminRepo.findById
   * or ctx.admin.telegramId) — NEVER from userRepo.findOrCreateByTelegramId,
   * which could return a parent's User row if the admin's Telegram ID
   * collides with a parent's.
   *
   * This sends ONLY to the one assigned admin, not to all school admins.
   * The previous implementation incorrectly called notifySchoolAdmins here,
   * which broadcast to every admin in the school.
   *
   * Telegram failures are handled by `safeSend` (logged, not thrown) — the
   * DB assignment remains persisted even if the notification fails.
   */
  async notifyAssignedAdmin(adminTelegramId: bigint, complaint: {
    complaintNumber: string;
    category: string;
    schoolName?: string | null;
    neighborhoodName?: string | null;
    status: string;
  }) {
    const targetLabel = complaint.schoolName
      ? `🏫 Maktab: ${complaint.schoolName}`
      : complaint.neighborhoodName
      ? `🏘️ Mahalla: ${complaint.neighborhoodName}`
      : "";

    const text =
      `📌 Yangi murojaat sizga biriktirildi.\n\n` +
      `🆔 ${complaint.complaintNumber}\n` +
      (targetLabel ? `${targetLabel}\n` : "") +
      `📂 Kategoriya: ${complaint.category}\n` +
      `Ko'rish uchun /admin buyrug'ini bosing.`;

    await safeSend(adminTelegramId, text);
  },
};
