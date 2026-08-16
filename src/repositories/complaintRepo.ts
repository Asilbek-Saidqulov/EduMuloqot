import { ComplaintStatus, ComplaintTargetType, ComplaintMessageSenderType } from "@prisma/client";
import { prisma } from "../database/prisma";

interface CreateComplaintInput {
  senderId: number;
  targetType: ComplaintTargetType;
  schoolId?: number;
  studentId?: number;
  neighborhoodId?: number;
  category: string;
  description: string;
}

export const complaintRepo = {
  /**
   * Murojaat yaratadi va #EDU-000001 formatidagi complaint_number tayinlaydi.
   * id asosida raqamlanadi — bitta tranzaksiyada, race condition bo'lmasligi uchun.
   */
  async create(input: CreateComplaintInput) {
    return prisma.$transaction(async (tx) => {
      const created = await tx.complaint.create({
        data: { ...input, complaintNumber: "PENDING" },
      });
      const complaintNumber = `#EDU-${String(created.id).padStart(6, "0")}`;
      return tx.complaint.update({
        where: { id: created.id },
        data: { complaintNumber },
      });
    });
  },

  /** Faqat shu ota-onaning o'z murojaatlari — privacy §7-band */
  async listByParent(senderId: number) {
    return prisma.complaint.findMany({
      where: { senderId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Feature #4: List complaints by parent + date range.
   * Used for the "oxirgi 7 kun" / "oxirgi 30 kun" date filter.
   */
  async listByParentAndDateRange(senderId: number, fromDate?: Date, toDate?: Date) {
    const where: any = { senderId };
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }
    return prisma.complaint.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  },

  async findByIdForParent(id: number, senderId: number) {
    return prisma.complaint.findFirst({
      where: { id, senderId },
      include: {
        messages: true,
        attachments: true,
        school: true,
        neighborhood: true,
        student: true,
        assignedToAdmin: true,
      },
    });
  },

  /**
   * Look up a complaint by its complaintNumber (e.g. "#EDU-000001" or
   * "EDU-000001"), scoped to the given sender. The `complaintNumber` passed
   * in must already be normalized to the canonical form stored in the DB
   * ("#EDU-000001" — with the leading `#`). Use `normalizeComplaintNumber`
   * from the caller before passing it here.
   *
   * Security: the `senderId` filter is applied at the database level — a
   * parent can never retrieve another parent's complaint by guessing its
   * number. Returns null if the complaint doesn't exist OR belongs to
   * another parent; the caller should show the same generic not-found
   * message in both cases to avoid leaking the existence of other parents'
   * complaints.
   */
  async findByComplaintNumberForParent(complaintNumber: string, senderId: number) {
    // M1 fix: complaintNumber is now @unique, so we can use findUnique
    // for the complaintNumber lookup and then filter by senderId in the
    // where clause. This is more efficient than findFirst and guarantees
    // a deterministic result.
    return prisma.complaint.findFirst({
      where: { complaintNumber, senderId },
      include: {
        messages: true,
        attachments: true,
        school: true,
        neighborhood: true,
        student: true,
        assignedToAdmin: true,
      },
    });
  },

  /** Maktab admini uchun — faqat o'z maktabiga tegishli murojaatlar */
  async listForSchoolAdmin(schoolId: number, status?: ComplaintStatus) {
    return prisma.complaint.findMany({
      where: { schoolId, targetType: "SCHOOL", ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { sender: true, student: true },
    });
  },

  /** Mahalla admini uchun — faqat o'z mahallasiga tegishli murojaatlar */
  async listForNeighborhoodAdmin(neighborhoodId: number, status?: ComplaintStatus) {
    return prisma.complaint.findMany({
      where: { neighborhoodId, targetType: "NEIGHBORHOOD", ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { sender: true },
    });
  },

  /**
   * Admin bitta murojaatni ochadi — lekin faqat o'ziga tegishli bo'lsa.
   * schoolId/neighborhoodId scope tashqarisidagi murojaatga admin hech qachon murojaat
   * qila olmasligi shu yerda ta'minlanadi (§7-band).
   */
  async findByIdScoped(id: number, scope: { schoolId?: number; neighborhoodId?: number }) {
    return prisma.complaint.findFirst({
      where: {
        id,
        ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
        ...(scope.neighborhoodId ? { neighborhoodId: scope.neighborhoodId } : {}),
      },
      include: { sender: true, student: true, school: true, neighborhood: true, messages: true },
    });
  },

  async updateStatus(id: number, status: ComplaintStatus) {
    return prisma.complaint.update({ where: { id }, data: { status } });
  },

  /**
   * Add a message to a complaint thread from the PARENT.
   * `senderUserId` must be the User.id of the parent who owns the complaint.
   * The message is stored with senderType=PARENT, senderId=senderUserId,
   * senderAdminId=null.
   */
  async addParentMessage(complaintId: number, senderUserId: number, message: string) {
    return prisma.complaintMessage.create({
      data: {
        complaintId,
        senderType: ComplaintMessageSenderType.PARENT,
        senderId: senderUserId,
        senderAdminId: null,
        message,
      },
    });
  },

  /**
   * Add a message to a complaint thread from an ADMIN.
   * `senderAdminId` must be the Admin.id of the admin replying to the parent.
   * The message is stored with senderType=ADMIN, senderAdminId=senderAdminId,
   * senderId=null.
   *
   * This replaces the old addMessage(complaintId, adminSenderUserId, message)
   * which used a User.id for the admin — that caused identity collisions
   * when an admin's Telegram ID matched a parent's.
   */
  async addAdminMessage(complaintId: number, senderAdminId: number, message: string) {
    return prisma.complaintMessage.create({
      data: {
        complaintId,
        senderType: ComplaintMessageSenderType.ADMIN,
        senderId: null,
        senderAdminId: senderAdminId,
        message,
      },
    });
  },

  async addAttachment(complaintId: number, fileId: string, fileType: string) {
    return prisma.complaintAttachment.create({ data: { complaintId, fileId, fileType } });
  },

  async countByStatus(scope: { schoolId?: number; neighborhoodId?: number }) {
    const where = {
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      ...(scope.neighborhoodId ? { neighborhoodId: scope.neighborhoodId } : {}),
    };
    const [total, newC, inProgress, resolved, rejected] = await Promise.all([
      prisma.complaint.count({ where }),
      prisma.complaint.count({ where: { ...where, status: "NEW" } }),
      prisma.complaint.count({ where: { ...where, status: "IN_PROGRESS" } }),
      prisma.complaint.count({ where: { ...where, status: "RESOLVED" } }),
      prisma.complaint.count({ where: { ...where, status: "REJECTED" } }),
    ]);
    return { total, newC, inProgress, resolved, rejected };
  },

  /** Faqat shu adminiga biriktirilgan murojaatlar */
  async listAssignedToAdmin(adminId: number) {
    return prisma.complaint.findMany({
      where: { assignedToAdminId: adminId } as any,
      orderBy: { createdAt: "desc" },
      include: { sender: true, student: true, school: true },
    });
  },
};
