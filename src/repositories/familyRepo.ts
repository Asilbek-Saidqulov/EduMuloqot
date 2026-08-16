/**
 * Phase 3: Family repository.
 *
 * Handles all DB operations for the Family system:
 *   - Create family + membership (atomic)
 *   - Find user's family
 *   - List family members
 *   - List family students (children)
 *   - Create/validate/use invitations
 *   - Add student to family
 */
import { prisma } from "../database/prisma";
import { ParentRole } from "@prisma/client";
import crypto from "crypto";

const INVITATION_EXPIRY_HOURS = 24;

export const familyRepo = {
  /**
   * Create a family and add the creating parent as the first member.
   * Atomic: both operations in a single transaction.
   */
  async createFamily(parentUserId: number, parentRole: ParentRole): Promise<any> {
    return prisma.$transaction(async (tx) => {
      const family = await tx.family.create({ data: {} });
      const member = await tx.familyMember.create({
        data: {
          familyId: family.id,
          userId: parentUserId,
          parentRole,
        },
      });
      return { family, member };
    });
  },

  /**
   * Find the family a user belongs to (if any).
   */
  async findFamilyByUserId(userId: number) {
    const membership = await prisma.familyMember.findUnique({
      where: { userId },
      include: {
        family: {
          include: {
            members: { include: { user: { select: { id: true, fullName: true, parentRole: true } } } },
            students: { include: { student: { select: { id: true, fullName: true, className: true, verificationStatus: true } } } },
          },
        },
      },
    });
    return membership?.family || null;
  },

  /**
   * Find a user's family membership (if any).
   */
  async findMembership(userId: number) {
    return prisma.familyMember.findUnique({
      where: { userId },
    });
  },

  /**
   * List all members of a family.
   */
  async listMembers(familyId: number) {
    return prisma.familyMember.findMany({
      where: { familyId },
      include: { user: { select: { id: true, fullName: true, parentRole: true } } },
    });
  },

  /**
   * List all students (children) in a family.
   */
  async listStudents(familyId: number) {
    return prisma.familyStudent.findMany({
      where: { familyId },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            className: true,
            verificationStatus: true,
            schoolId: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  /**
   * Add a student to a family. Atomic with uniqueness check.
   * Returns null if the student is already in a family.
   */
  async addStudentToFamily(familyId: number, studentId: number): Promise<any | null> {
    try {
      return await prisma.familyStudent.create({
        data: { familyId, studentId },
      });
    } catch (error: any) {
      if (error?.code === "P2002") return null; // unique constraint violation
      throw error;
    }
  },

  /**
   * Create a secure invitation for a second parent to join a family.
   * Generates a cryptographically random token, stores its SHA-256 hash.
   * Returns the raw token (shown to the user once) — only the hash is stored.
   */
  async createInvitation(familyId: number, createdByUserId: number): Promise<{ token: string; expiresAt: Date }> {
    // Generate a random token: EDU-XXXXXX-XX format
    const bytes = crypto.randomBytes(6);
    const token = `EDU-${bytes.toString("hex").toUpperCase().slice(0, 6)}-${bytes.toString("hex").toUpperCase().slice(6, 8)}`;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);

    await prisma.familyInvitation.create({
      data: {
        familyId,
        tokenHash,
        expiresAt,
        createdBy: createdByUserId,
      },
    });

    return { token, expiresAt };
  },

  /**
   * Validate and consume an invitation token. Atomic:
   * 1. Find the invitation by token hash
   * 2. Check not expired
   * 3. Check not already used
   * 4. Check the target family doesn't already have this parent role
   * 5. Create the membership
   * 6. Mark invitation as used
   * Returns the family if successful, or null/error if invalid.
   */
  async joinFamilyByInvitation(
    token: string,
    userId: number,
    parentRole: ParentRole
  ): Promise<{ family: any; member: any } | { error: string }> {
    const tokenHash = crypto.createHash("sha256").update(token.toUpperCase()).digest("hex");

    return prisma.$transaction(async (tx) => {
      // Find the invitation
      const invitation = await tx.familyInvitation.findUnique({
        where: { tokenHash },
        include: { family: true },
      });

      if (!invitation) {
        return { error: "Taklif kodi topilmadi." };
      }

      // Check expired
      if (invitation.expiresAt < new Date()) {
        return { error: "Taklif kodi muddati tugagan." };
      }

      // Check already used
      if (invitation.usedAt !== null) {
        return { error: "Bu taklif kodi allaqachon ishlatilgan." };
      }

      // Check the user isn't already in a family
      const existingMembership = await tx.familyMember.findUnique({
        where: { userId },
      });
      if (existingMembership) {
        return { error: "Siz allaqachon bir oilaga a'zosiz." };
      }

      // Check the family doesn't already have this parent role
      const existingRole = await tx.familyMember.findUnique({
        where: { familyId_parentRole: { familyId: invitation.familyId, parentRole } },
      });
      if (existingRole) {
        const roleLabel = parentRole === "FATHER" ? "Ota" : "Ona";
        return { error: `Bu oilada ${roleLabel} roli allaqachon mavjud.` };
      }

      // Create membership
      const member = await tx.familyMember.create({
        data: {
          familyId: invitation.familyId,
          userId,
          parentRole,
        },
      });

      // Mark invitation as used
      await tx.familyInvitation.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });

      return { family: invitation.family, member };
    });
  },

  /**
   * Find an invitation by token (for preview before joining).
   * Returns the family info (safe for display) or null.
   */
  async findInvitationByToken(token: string): Promise<any | null> {
    const tokenHash = crypto.createHash("sha256").update(token.toUpperCase()).digest("hex");

    const invitation = await prisma.familyInvitation.findUnique({
      where: { tokenHash },
      include: {
        family: {
          include: {
            members: {
              include: {
                user: { select: { fullName: true, parentRole: true } },
              },
            },
            students: {
              include: {
                student: { select: { fullName: true, className: true } },
              },
            },
          },
        },
      },
    });

    if (!invitation) return null;
    if (invitation.expiresAt < new Date()) return null;
    if (invitation.usedAt !== null) return null;

    return invitation;
  },

  /**
   * Check if a user has access to a specific student via their family.
   */
  async canUserAccessStudent(userId: number, studentId: number): Promise<boolean> {
    const membership = await prisma.familyMember.findUnique({
      where: { userId },
      select: { familyId: true },
    });
    if (!membership) return false;

    const familyStudent = await prisma.familyStudent.findUnique({
      where: { studentId },
      select: { familyId: true },
    });
    if (!familyStudent) return false;

    return membership.familyId === familyStudent.familyId;
  },
};
