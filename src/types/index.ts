import { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import { Context, SessionFlavor } from "grammy";
import { Prisma } from "@prisma/client";
import type { AttendanceStatus } from "@prisma/client";

export interface SessionData {
  // hozircha bo'sh — grammY session asosan conversations plagini uchun ishlatiladi;
  // uzoq muddatli state BotSession jadvalida saqlanadi
  step?: string;
  complaintId?: number;
  targetAdminId?: number;
  selectedResponsibilities?: string[];
  pendingRole?: string;
  /** Used by view_child callback → childEdit conversation to know which student to edit. */
  studentId?: number;
  /**
   * Phase 5: In-progress attendance roll-call state. Set by attendance
   * handlers when a teacher starts taking attendance, cleared on save
   * or cancel. The marks are NOT authoritative — the service re-
   * validates authorization on save.
   */
  attendance?: {
    className?: string;
    date?: Date;
    schoolId?: number;
    marks?: Record<number, AttendanceStatus>;
    page?: number;
  };
}

/** authAdmin middleware tomonidan to'ldiriladi — faqat admin ekanligi tasdiqlangan requestlarda mavjud bo'ladi. */
export type AdminWithScope = Prisma.AdminGetPayload<{
  include: { school: true; neighborhood: true };
}> & { role: string };

export interface AdminFlavor {
  admin?: AdminWithScope;
  /** Phase 1 Foundation: resolved User identity (set by resolveIdentity middleware). */
  resolvedUser?: {
    id: number;
    telegramId: bigint;
    fullName: string | null;
    phone: string | null;
    schoolId: number | null;
    neighborhoodId: number | null;
    role: string;
    /** Phase 4 Hardening: authoritative active/inactive flag for staff. */
    isActive: boolean;
  };
  /** Phase 1 Foundation: resolved Admin identity (set by resolveIdentity middleware). */
  resolvedAdmin?: {
    id: number;
    telegramId: bigint;
    fullName: string | null;
    role: string;
    schoolId: number | null;
    neighborhoodId: number | null;
    isActive: boolean;
  } | null;
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor & AdminFlavor;
export type BotConversation = Conversation<BotContext>;

export const CATEGORIES_SCHOOL = [
  "📚 Ta'lim jarayoni",
  "👨‍🏫 O'qituvchi bilan bog'liq masala",
  "👦 O'quvchi bilan bog'liq masala",
  "⚠️ Xavfsizlik",
  "🏫 Maktab sharoiti",
  "📝 Boshqa",
] as const;

export const CATEGORIES_NEIGHBORHOOD = [
  "🏘 Mahalla muammosi",
  "💡 Infratuzilma",
  "🧑‍👩‍👧 Ijtimoiy masala",
  "🏫 Ta'lim bilan bog'liq masala",
  "⚠️ Xavfsizlik",
  "📝 Boshqa",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  NEW: "🟡 Yangi",
  ASSIGNED: "📌 Biriktirildi",
  IN_PROGRESS: "🔵 Ko'rib chiqilmoqda",
  RESOLVED: "🟢 Hal qilindi",
  REJECTED: "🔴 Rad etildi",
};

export const STUDENT_VERIFICATION_LABELS: Record<string, string> = {
  PENDING: "⏳",
  VERIFIED: "✅",
  REJECTED: "❌",
};
