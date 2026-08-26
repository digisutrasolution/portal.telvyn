/**
 * Idempotent seed: permission groups, permissions, and system roles from the
 * catalog (single source of truth). Safe to re-run. Custom/tenant data is
 * never touched. Run: npx pnpm@9 --filter @telvyn/api exec prisma db seed
 */
import { PrismaClient } from "@prisma/client";
import { PERMISSION_GROUPS, PERMISSIONS, SYSTEM_ROLES } from "../src/authz/permission-catalog";
import { expandGrants } from "../src/authz/authorization";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const g of PERMISSION_GROUPS) {
    await prisma.permissionGroup.upsert({ where: { key: g.key }, create: g, update: { name: g.name, description: g.description } });
  }
  for (const p of PERMISSIONS) {
    const group = await prisma.permissionGroup.findUnique({ where: { key: p.group } });
    await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, resource: p.resource, action: p.action, description: p.description, groupId: group?.id },
      update: { description: p.description, groupId: group?.id },
    });
  }
  for (const role of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({ where: { tenantId: null, key: role.key } });
    const roleRow =
      existing ??
      (await prisma.role.create({ data: { tenantId: null, key: role.key, name: role.name, description: role.description, isSystem: true } }));
    const keys = expandGrants(role.permissions);
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } }),
      prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: roleRow.id, permissionId: p.id })) }),
    ]);
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions, ${SYSTEM_ROLES.length} system roles.`);
}

void main().finally(() => prisma.$disconnect());
