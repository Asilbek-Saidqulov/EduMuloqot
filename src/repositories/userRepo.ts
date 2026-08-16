import { prisma } from "../database/prisma";
import type { User } from "@prisma/client";

export const userRepo = {
  /**
   * Find or create a User by Telegram ID.
   *
   * H3 fix: if the user already exists, do NOT overwrite their fullName.
   * The previous implementation used `upsert` with `update: { fullName }`,
   * which silently overwrote a parent's custom-edited fullName (e.g.
   * "Akmal Karimov") with their Telegram first_name (e.g. "Akmal") every
   * time they sent /start or submitted a complaint.
   *
   * Now: if the user exists, return them as-is (no update). If they don't
   * exist, create them with the provided fullName (from Telegram first_name)
   * — this is the initial seed, not an overwrite.
   *
   * The `phone` parameter is kept for API compatibility but is also NOT
   * used to overwrite — phone is now only set via the profile edit flow
   * or the parent registration conversation.
   */
  async findOrCreateByTelegramId(telegramId: bigint, fullName?: string, phone?: string) {
    const existing = await prisma.user.findUnique({ where: { telegramId } });
    if (existing) {
      return existing;
    }
    return prisma.user.create({
      data: { telegramId, fullName, phone },
    });
  },

  async findByTelegramId(telegramId: bigint) {
    return prisma.user.findUnique({ where: { telegramId } });
  },

  async updatePhone(userId: number, phone: string) {
    return prisma.user.update({ where: { id: userId }, data: { phone } });
  },

  async updateFullName(userId: number, fullName: string) {
    return prisma.user.update({ where: { id: userId }, data: { fullName } });
  },

  /**
   * Update only the user's school. Preserves id, telegramId, fullName, phone,
   * neighborhoodId, createdAt. Used by the Profile Edit conversation.
   */
  async updateSchool(userId: number, schoolId: number) {
    return prisma.user.update({ where: { id: userId }, data: { schoolId } });
  },

  /**
   * Update only the user's neighborhood. Preserves id, telegramId, fullName,
   * phone, schoolId, createdAt. Used by the Profile Edit conversation.
   */
  async updateNeighborhood(userId: number, neighborhoodId: number) {
    return prisma.user.update({ where: { id: userId }, data: { neighborhoodId } });
  },

  async updateParentProfile(userId: number, data: {
    fullName: string;
    phone: string;
    schoolId: number;
    neighborhoodId: number;
    parentRole?: "FATHER" | "MOTHER";
  }) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        fullName: data.fullName,
        phone: data.phone,
        schoolId: data.schoolId,
        neighborhoodId: data.neighborhoodId,
        role: "PARENT",
        ...(data.parentRole ? { parentRole: data.parentRole } : {}),
      },
    });
  },

  /**
   * Phase 2: Update user as a student. Sets role to STUDENT.
   * Does NOT allow changing staff roles.
   */
  async updateStudentProfile(userId: number, data: {
    fullName: string;
    schoolId: number;
  }) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        fullName: data.fullName,
        schoolId: data.schoolId,
        role: "STUDENT",
      },
    });
  },

  /**
   * Phase 2: Check if the user's role is a staff/system role that
   * must NOT be overwritten by normal registration.
   */
  isStaffUser(user: { role: string }): boolean {
    const staffRoles = ["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN", "MAHALLA_RESPONSIBLE", "ADMIN", "SUPER_ADMIN"];
    return staffRoles.includes(user.role);
  },

  /**
   * Phase 2: Check if the user has already completed registration
   * (regardless of whether they're a parent or student).
   */
  isUserRegistered(user: { role: string; fullName: string | null; phone: string | null; schoolId: number | null }): boolean {
    // Staff users are always considered registered
    if (this.isStaffUser(user)) return true;
    // Parent: needs fullName, phone, schoolId
    if (user.role === "PARENT") {
      return user.fullName != null && user.fullName.trim().length > 0 &&
             user.phone != null && user.phone.trim().length > 0 &&
             user.schoolId != null;
    }
    // Student: needs fullName, schoolId
    if (user.role === "STUDENT") {
      return user.fullName != null && user.fullName.trim().length > 0 &&
             user.schoolId != null;
    }
    // Default: not registered
    return false;
  },

  /**
   * A parent is considered registered iff their profile is complete — i.e.
   * they have gone through the parent registration conversation and had
   * `updateParentProfile` called. The four fields below are exactly the
   * ones written by that conversation's final step:
   *   - fullName        (collected in registration step 2)
   *   - phone           (collected in registration step 1, via Telegram contact)
   *   - schoolId        (selected in registration step 3)
   *   - neighborhoodId  (selected in registration step 4)
   *
   * Having children is NOT required for a parent to be registered — the
   * child-registration flow is now optional and can be skipped ("Keyinroq").
   * A registered parent may legitimately have children.length === 0.
   *
   * This check is used by /start to decide whether to show the welcome
   * screen (unregistered) or the main menu (registered). It does NOT
   * affect feature-specific checks (e.g. school complaint still requires
   * a verified child — that restriction lives in the complaint flow,
   * not here).
   */
  isParentProfileComplete(user: Pick<User, "fullName" | "phone" | "schoolId" | "neighborhoodId">): boolean {
    return (
      user.fullName != null &&
      user.fullName.trim().length > 0 &&
      user.phone != null &&
      user.phone.trim().length > 0 &&
      user.schoolId != null &&
      user.neighborhoodId != null
    );
  },
};
