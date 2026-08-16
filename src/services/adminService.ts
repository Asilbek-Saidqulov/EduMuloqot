import { adminRepo } from "../repositories/adminRepo";
import { prisma } from "../database/prisma";

export const adminService = {
  async createAdmin(params: {
    telegramId: bigint;
    fullName?: string;
    role: string;
    schoolId?: number;
    neighborhoodId?: number;
    responsibilities?: string[];
    actorAdminId?: number;
  }) {
    const admin = await adminRepo.create({
      telegramId: params.telegramId,
      fullName: params.fullName,
      role: params.role,
      schoolId: params.schoolId,
      neighborhoodId: params.neighborhoodId,
    });

    if (params.responsibilities && params.responsibilities.length > 0) {
      await adminRepo.setResponsibilities(admin.id, params.responsibilities);
    }

    // Log action
    if (params.actorAdminId) {
      await this.logAction(params.actorAdminId, admin.id, "CREATE_ADMIN", {
        role: params.role,
        schoolId: params.schoolId,
        neighborhoodId: params.neighborhoodId,
        responsibilities: params.responsibilities,
      });
    }

    return admin;
  },

  async updateAdmin(
    adminId: number,
    params: {
      fullName?: string;
      role?: string;
      schoolId?: number;
      neighborhoodId?: number;
      isActive?: boolean;
      responsibilities?: string[];
    },
    actorAdminId?: number
  ) {
    const admin = await adminRepo.update(adminId, {
      fullName: params.fullName,
      role: params.role,
      schoolId: params.schoolId,
      neighborhoodId: params.neighborhoodId,
      isActive: params.isActive,
    });

    if (params.responsibilities !== undefined) {
      await adminRepo.setResponsibilities(adminId, params.responsibilities);
    }

    // Log action
    if (actorAdminId) {
      await this.logAction(actorAdminId, adminId, "UPDATE_ADMIN", params);
    }

    return admin;
  },

  async deactivateAdmin(adminId: number, actorAdminId?: number) {
    const result = await adminRepo.deactivate(adminId);

    // Log action
    if (actorAdminId) {
      await this.logAction(actorAdminId, adminId, "DEACTIVATE_ADMIN");
    }

    return result;
  },

  async activateAdmin(adminId: number, actorAdminId?: number) {
    const result = await adminRepo.activate(adminId);

    // Log action
    if (actorAdminId) {
      await this.logAction(actorAdminId, adminId, "ACTIVATE_ADMIN");
    }

    return result;
  },

  /**
   * Soft-delete an admin by deactivating them.
   *
   * This does NOT physically remove the Admin row. Instead it sets
   * `isActive = false`, which:
   *   - Blocks the admin from accessing `/admin` (authAdmin middleware
   *     checks isActive === false and denies access).
   *   - Removes the admin from the "assign to" list (listActiveBySchool /
   *     listActiveByNeighborhood filter isActive: true).
   *   - Blocks new assignments to this admin (complaintAssignmentService
   *     .assignComplaint checks targetAdmin.isActive and throws).
   *
   * Why soft delete instead of hard delete:
   *   The schema has two `ON DELETE RESTRICT` FK constraints that block
   *   hard deletion for any admin with real-world history:
   *     - ComplaintAssignment.toAdminId (assignment history)
   *     - AdminActionLog.actorAdminId (action logs)
   *   Hard-deleting such an admin throws a Prisma FK violation. Even if
   *   we changed those to SET NULL, we would lose historical attribution
   *   (which admin handled which complaint, which admin performed which
   *   action) — violating the Bug #6 sender-model preservation and the
   *   audit-log integrity requirements.
   *
   * Soft delete preserves ALL historical data:
   *   - ComplaintAssignment rows remain intact (fromAdminId / toAdminId
   *     still point to the deactivated admin).
   *   - ComplaintMessage.senderAdminId still points to the admin
   *     (senderType stays ADMIN — Bug #6 preserved).
   *   - AdminActionLog rows remain intact.
   *   - Complaint.assignedToAdminId still points to the admin (the
   *     complaint remains "assigned" to the now-inactive admin; a Super
   *     Admin can reassign it to an active admin if needed).
   *
   * The admin can be re-activated later via `activateAdmin` if needed.
   */
  async deleteAdmin(adminId: number, actorAdminId?: number) {
    // Log action before deactivation
    if (actorAdminId) {
      await this.logAction(actorAdminId, adminId, "DELETE_ADMIN");
    }

    return adminRepo.deactivate(adminId);
  },

  async getSchoolAdmins(schoolId: number) {
    return adminRepo.listActiveBySchool(schoolId);
  },

  async getNeighborhoodAdmins(neighborhoodId: number) {
    return adminRepo.listActiveByNeighborhood(neighborhoodId);
  },

  async countActiveSuperAdmins() {
    return prisma.admin.count({
      where: { role: "SUPER_ADMIN", isActive: true },
    });
  },

  async logAction(actorAdminId: number, targetAdminId: number | null, action: string, details?: any) {
    return (prisma as any).adminActionLog.create({
      data: {
        actorAdminId,
        targetAdminId,
        action,
        details: details ? JSON.stringify(details) : null,
      },
    });
  },

  async getActionLogs(adminId: number) {
    return (prisma as any).adminActionLog.findMany({
      where: { targetAdminId: adminId },
      include: { actorAdmin: true },
      orderBy: { createdAt: "desc" },
    });
  },
};
