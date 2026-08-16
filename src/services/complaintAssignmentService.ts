import { complaintAssignmentRepo } from "../repositories/complaintAssignmentRepo";
import { complaintRepo } from "../repositories/complaintRepo";
import { notificationService } from "./notificationService";
import { adminRepo } from "../repositories/adminRepo";

export const complaintAssignmentService = {
  /**
   * Assign a complaint to an admin.
   *
   * Sender-model safety (Bug #6): the assignee is identified by Admin.id
   * (`toAdminId`). The notification recipient is loaded from the Admin
   * record (adminRepo.findById → admin.telegramId), NEVER from
   * userRepo.findOrCreateByTelegramId. This prevents identity collisions
   * when an admin's Telegram ID matches a parent's.
   *
   * Same-admin guard: if the complaint is already assigned to the same
   * admin, no duplicate assignment record is created and no duplicate
   * notification is sent. The complaint remains assigned and the caller
   * sees a "already assigned" message.
   *
   * Invalid/inactive admin: the target admin is validated (exists, active)
   * before the assignment is persisted. An invalid target throws an error
   * and no DB write occurs.
   *
   * Notification failure: Telegram failures are handled inside
   * `safeSend` (logged, not thrown). The DB assignment remains persisted
   * even if the notification fails — we do NOT roll back a successful
   * database assignment merely because Telegram temporarily failed.
   */
  async assignComplaint(params: {
    complaintId: number;
    fromAdminId?: number;
    toAdminId: number;
    note?: string;
    /**
     * C3 fix: the caller MUST pass the assigning admin's scope so the
     * complaint is re-validated at the DB level. This prevents a stale
     * ctx.session.complaintId from being used to assign a complaint the
     * admin no longer has access to.
     *
     * SUPER_ADMIN passes an empty scope {} (can assign any complaint).
     * SCHOOL_ADMIN passes { schoolId: <admin.schoolId> }.
     * NEIGHBORHOOD_ADMIN passes { neighborhoodId: <admin.neighborhoodId> }.
     */
    scope: { schoolId?: number; neighborhoodId?: number };
  }) {
    // C3 fix: re-validate the complaint against the admin's scope at the
    // DB level. Never trust a stale ctx.session.complaintId — the complaint
    // might have been moved to another school, or the admin's school might
    // have changed since routeCallback set the session.
    const complaint = await complaintRepo.findByIdScoped(params.complaintId, params.scope);
    if (!complaint) {
      throw new Error("Murojaat topilmadi yoki sizga tegishli emas");
    }

    // Validate the target admin exists and is active BEFORE any DB write.
    // This prevents assigning to a deleted/deactivated admin.
    const targetAdmin = await adminRepo.findById(params.toAdminId);
    if (!targetAdmin) {
      throw new Error("Ma'sul xodim topilmadi");
    }
    if ((targetAdmin as any).isActive === false) {
      throw new Error("Ma'sul xodim faol emas");
    }

    // Same-admin guard: if the complaint is already assigned to the same
    // admin, do NOT create a duplicate assignment record and do NOT send a
    // duplicate notification. Return a no-op result so the caller can show
    // an appropriate "already assigned" message.
    if (complaint.assignedToAdminId === params.toAdminId) {
      return {
        duplicate: true as const,
        complaintId: params.complaintId,
        assignedToAdminId: params.toAdminId,
      };
    }

    // Create assignment record, update complaint.assignedToAdminId, AND
    // update complaint status to ASSIGNED — all in a single transaction.
    // M2 fix: the status update is now inside complaintAssignmentRepo.create's
    // transaction, so if either write fails, both are rolled back.
    const assignment = await complaintAssignmentRepo.create({
      complaintId: params.complaintId,
      fromAdminId: params.fromAdminId,
      toAdminId: params.toAdminId,
      note: params.note,
    });

    // Notify the SPECIFIC assigned admin (not all school admins).
    // The notification recipient comes from the Admin record's telegramId,
    // loaded above via adminRepo.findById. This is the Admin.telegramId,
    // NOT a User.telegramId — so a parent/admin Telegram ID collision
    // cannot misroute the notification.
    await this.notifyAssignedAdmin(params.complaintId, targetAdmin.telegramId, complaint);

    // Notify the PARENT (complaint submitter) that their complaint was
    // routed. This uses complaint.senderId (User.id) to find the parent's
    // telegramId — correct, because the parent IS a User.
    await notificationService.notifyParentAssignment(params.complaintId);

    return { duplicate: false as const, assignment };
  },

  /**
   * Get assignment history for a complaint.
   */
  async getAssignmentHistory(complaintId: number) {
    return complaintAssignmentRepo.listByComplaint(complaintId);
  },

  /**
   * Get complaints assigned to a specific admin.
   */
  async getAdminAssignments(adminId: number) {
    return complaintAssignmentRepo.listByAdmin(adminId);
  },

  /**
   * Notify the SPECIFIC admin that a complaint has been assigned to them.
   *
   * `adminTelegramId` MUST come from the Admin record (passed in from
   * adminRepo.findById(...).telegramId), NEVER from
   * userRepo.findOrCreateByTelegramId — which could return a parent's
   * User row if the admin's Telegram ID collides with a parent's.
   *
   * This is the fix for Bug #7: the previous implementation loaded the
   * admin but then discarded the telegramId and called
   * `notifySchoolAdmins(complaint)`, which broadcast to ALL admins of the
   * school instead of just the assigned admin.
   *
   * Telegram failures are handled by `safeSend` inside notificationService
   * (logged, not thrown). The DB assignment remains persisted.
   *
   * `complaintInfo` is passed in (rather than re-loaded) because the caller
   * already loaded the complaint via findByIdScoped — we avoid a second
   * DB round-trip. The school/neighborhood names are resolved here for the
   * notification text.
   */
  async notifyAssignedAdmin(
    complaintId: number,
    adminTelegramId: bigint,
    complaintInfo?: { complaintNumber: string; category: string; schoolId?: number | null; neighborhoodId?: number | null; status: string }
  ) {
    // If the caller didn't pass complaint info, load it now.
    let info = complaintInfo;
    if (!info) {
      const complaint = await complaintRepo.findByIdScoped(complaintId, {});
      if (!complaint) return;
      info = {
        complaintNumber: complaint.complaintNumber,
        category: complaint.category,
        schoolId: complaint.schoolId,
        neighborhoodId: complaint.neighborhoodId,
        status: complaint.status,
      };
    }

    // Resolve school/neighborhood names for the notification text.
    let schoolName: string | null = null;
    let neighborhoodName: string | null = null;
    if (info.schoolId) {
      const { prisma } = await import("../database/prisma");
      const school = await prisma.school.findUnique({ where: { id: info.schoolId } });
      schoolName = school?.name ?? null;
    }
    if (info.neighborhoodId) {
      const { prisma } = await import("../database/prisma");
      const neighborhood = await prisma.neighborhood.findUnique({ where: { id: info.neighborhoodId } });
      neighborhoodName = neighborhood?.name ?? null;
    }

    await notificationService.notifyAssignedAdmin(adminTelegramId, {
      complaintNumber: info.complaintNumber,
      category: info.category,
      schoolName,
      neighborhoodName,
      status: info.status,
    });
  },
};
