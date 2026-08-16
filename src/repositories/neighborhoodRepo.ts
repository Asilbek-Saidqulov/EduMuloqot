import { prisma } from "../database/prisma";

export const neighborhoodRepo = {
  async listAll() {
    return prisma.neighborhood.findMany({ orderBy: { name: "asc" } });
  },
  async findById(id: number) {
    return prisma.neighborhood.findUnique({ where: { id } });
  },
};
