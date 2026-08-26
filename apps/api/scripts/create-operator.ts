/**
 * Bootstrap CLI — creates (or resets the password of) an operator account.
 * Usage:
 *   npx pnpm@9 --dir "D:/Claude Dev/portal.telvyn.co" --filter @telvyn/api create-operator -- <email> <password> [full name]
 * No hardcoded credentials anywhere; the password is supplied at invocation.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { ARGON2_OPTIONS } from "../src/auth/account-flows.service";

async function main(): Promise<void> {
  const [email, password, ...nameParts] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: create-operator <email> <password> [full name]");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
  const fullName = nameParts.join(" ") || null;

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), passwordHash, fullName, status: "ACTIVE" },
    update: { passwordHash, failedLogins: 0, lockedUntil: null },
  });
  await prisma.securityEvent.create({
    data: { userId: user.id, type: "auth.operator_bootstrap", metadata: { via: "create-operator-cli" } },
  });
  console.log(`Operator ready: ${user.email} (${user.id})`);
  await prisma.$disconnect();
}

void main();
