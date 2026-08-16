import { complaintRepo } from "../repositories/complaintRepo";

export const statsService = {
  async forAdmin(scope: { schoolId?: number; neighborhoodId?: number }) {
    const c = await complaintRepo.countByStatus(scope);
    return (
      `📊 Statistika\n\n` +
      `Jami murojaatlar: ${c.total}\n` +
      `🟡 Yangi: ${c.newC}\n` +
      `🔵 Ko'rib chiqilmoqda: ${c.inProgress}\n` +
      `🟢 Hal qilingan: ${c.resolved}\n` +
      `🔴 Rad etilgan: ${c.rejected}`
    );
  },
};
