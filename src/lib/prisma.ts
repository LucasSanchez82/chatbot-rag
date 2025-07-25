import { PrismaClient } from "@/generated/prisma";

declare global {
  var prisma: PrismaClient;
}

if (!global.prisma) {
  global.prisma = new PrismaClient();
}

export const prisma = global.prisma;
