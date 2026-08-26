/**
 * Bootstrap CLI — create a tenant and attach an existing user as a member with
 * a system role (default: owner). Sets the user's primary tenant if unset.
 * Usage:
 *   ... --filter @telvyn/api create-tenant -- <slug> "<name>" <userEmail> [roleKey]
 */
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  const [slug, name, email, roleKey = "owner"] = argv;
  if (!slug || !name || !email) {
    console.error('Usage: create-tenant <slug> "<name>" <userEmail> [roleKey]');
    process.exit(1);
  }
  const prisma = new PrismaClient();

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.error(`No user with email ${email}. Create one first with create-operator.`);
    process.exit(1);
  }
  const role = await prisma.role.findFirst({ where: { tenantId: null, key: roleKey, isSystem: true } });
  if (!role) {
    console.error(`No system role "${roleKey}". Run the seed first (prisma db seed).`);
    process.exit(1);
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: { slug, name, type: "PLATFORM", status: "ACTIVE" },
    update: { name },
  });
  const membership = await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    create: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" },
    update: { status: "ACTIVE" },
  });
  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
    create: { membershipId: membership.id, roleId: role.id },
    update: {},
  });
  if (!user.tenantId) {
    await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  }
  console.log(`Tenant ${tenant.slug} (${tenant.id}); ${email} is ${roleKey}.`);
  await prisma.$disconnect();
}

void main();
