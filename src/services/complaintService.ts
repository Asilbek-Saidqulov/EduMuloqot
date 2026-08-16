import { ComplaintTargetType } from "@prisma/client";
import { complaintRepo } from "../repositories/complaintRepo";
import { notificationService } from "./notificationService";

export const complaintService = {
  async submitSchoolComplaint(params: {
    senderId: number;
    schoolId: number;
    studentId: number;
    category: string;
    description: string;
    attachments: { fileId: string; fileType: string }[];
  }) {
    const complaint = await complaintRepo.create({
      senderId: params.senderId,
      targetType: ComplaintTargetType.SCHOOL,
      schoolId: params.schoolId,
      studentId: params.studentId,
      category: params.category,
      description: params.description,
    });

    for (const att of params.attachments) {
      await complaintRepo.addAttachment(complaint.id, att.fileId, att.fileType);
    }

    await notificationService.notifySchoolAdmins(complaint);
    return complaint;
  },

  async submitNeighborhoodComplaint(params: {
    senderId: number;
    neighborhoodId: number;
    category: string;
    description: string;
    attachments: { fileId: string; fileType: string }[];
  }) {
    const complaint = await complaintRepo.create({
      senderId: params.senderId,
      targetType: ComplaintTargetType.NEIGHBORHOOD,
      neighborhoodId: params.neighborhoodId,
      category: params.category,
      description: params.description,
    });

    for (const att of params.attachments) {
      await complaintRepo.addAttachment(complaint.id, att.fileId, att.fileType);
    }

    await notificationService.notifyNeighborhoodAdmins(complaint);
    return complaint;
  },

  async changeStatus(
    complaintId: number,
    status: "IN_PROGRESS" | "RESOLVED" | "REJECTED",
    actorScope?: { schoolId?: number; neighborhoodId?: number }
  ) {
    // Phase 9 Security Fix: Re-validate scope at the service level.
    // The handler already checks via findByIdScoped, but defense-in-depth
    // requires the service to also verify the complaint is in scope.
    if (actorScope) {
      const scoped = await complaintRepo.findByIdScoped(complaintId, actorScope);
      if (!scoped) {
        throw new Error("Murojaat topilmadi yoki sizga tegishli emas.");
      }
    }
    const complaint = await complaintRepo.updateStatus(complaintId, status);
    await notificationService.notifyParentStatusChange(complaint);
    return complaint;
  },

  /**
   * Reply to a complaint as an ADMIN.
   *
   * `adminId` must be the Admin.id of the authenticated admin (from
   * ctx.admin.id via the authAdmin middleware). The message is stored
   * with senderType=ADMIN and senderAdminId=adminId — NOT with a User.id.
   * This prevents the previous identity-collision bug where an admin's
   * reply could be stored as if sent by a parent (when the admin's
   * Telegram ID matched a parent's User.telegramId).
   *
   * The caller is responsible for ensuring `adminId` comes from the
   * authenticated admin context (ctx.admin.id), NOT from user input.
   */
  async reply(
    complaintId: number,
    adminId: number,
    message: string,
    actorScope?: { schoolId?: number; neighborhoodId?: number }
  ) {
    // Phase 9 Security Fix: Re-validate scope at the service level.
    if (actorScope) {
      const scoped = await complaintRepo.findByIdScoped(complaintId, actorScope);
      if (!scoped) {
        throw new Error("Murojaat topilmadi yoki sizga tegishli emas.");
      }
    }
    const msg = await complaintRepo.addAdminMessage(complaintId, adminId, message);
    await notificationService.notifyParentReply(complaintId, message);
    return msg;
  },
};
