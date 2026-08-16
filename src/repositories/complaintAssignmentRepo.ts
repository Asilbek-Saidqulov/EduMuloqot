import { prisma } from "../database/prisma";

export const complaintAssignmentRepo = {
  async create(data: {
    complaintId: number;
    fromAdminId?: number;
    toAdminId: number;
    note?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      // Create assignment record
      const assignment = await (tx as any).complaintAssignment.create({
        data,
      });

      // Update complaint with assigned admin AND status to ASSIGNED.
      // M2 fix: move the status update inside the same transaction as the
      // assignment record creation. Previously, complaintAssignmentService
      // called complaintRepo.updateStatus separately after the transaction
      // committed — if the status update failed, the assignment was
      // committed but the status was wrong.
      await tx.complaint.update({
        where: { id: data.complaintId },
        data: { assignedToAdminId: data.toAdminId, status: "ASSIGNED" } as any,
      });

      return assignment;
    });
  },

  async listByComplaint(complaintId: number) {
    return (prisma as any).complaintAssignment.findMany({
      where: { complaintId },
      include: { fromAdmin: true, toAdmin: true },
      orderBy: { assignedAt: "asc" },
    });
  },

  async listByAdmin(adminId: number) {
    return (prisma as any).complaintAssignment.findMany({
      where: { toAdminId: adminId },
      include: { complaint: true, fromAdmin: true },
      orderBy: { assignedAt: "desc" },
    });
  },
};
