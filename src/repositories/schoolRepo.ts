import { prisma } from "../database/prisma";

export const schoolRepo = {
  async listAll() {
    return prisma.school.findMany({ orderBy: { name: "asc" } });
  },
  async findById(id: number) {
    return prisma.school.findUnique({ where: { id } });
  },
};
