import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is missing");
  }

  const dbUrl = new URL(url);

  if (dbUrl.pathname !== "/footwear_omnichannel_test") {
    throw new Error("SAFETY STOP: Not the isolated test database");
  }

  if (!["127.0.0.1", "localhost"].includes(dbUrl.hostname)) {
    throw new Error("SAFETY STOP: Unexpected database host");
  }

  if (dbUrl.port !== "5433") {
    throw new Error("SAFETY STOP: Unexpected database port");
  }

  const prisma = new PrismaClient();

  try {
    const email = "m112-manager-b@localhost.invalid";

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        roles: { include: { role: true } },
        locations: true,
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new Error("Synthetic Manager B account missing or inactive");
    }

    const roles = user.roles.map((r) => r.role.code);
    const locations = user.locations.map((l) => l.locationId);

    if (
      !roles.includes("BRANCH_MANAGER") ||
      roles.includes("SUPER_ADMIN") ||
      locations.length !== 1 ||
      locations[0] !== "46d6e7fe-8733-422e-83db-bd6b40bdb7d1"
    ) {
      throw new Error("SAFETY STOP: Unexpected Manager B permissions");
    }

    const password = randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    console.log("PASS: Synthetic Manager B password reset");
    console.log("Email:", email);
    console.log("TEMPORARY_PASSWORD:", password);
    console.log("Save this password privately. Do not share it in chat.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
