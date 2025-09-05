import { PrismaClient } from "@/generated/prisma";

declare global {
  var prisma: PrismaClient;
}

if (!global.prisma) {
  global.prisma = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn", "info"]
        : ["error"],
  });
}

export const prisma = global.prisma;
