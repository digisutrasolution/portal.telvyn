/**
 * The permission + group + system-role catalog. This is the single source of
 * truth seeded into the DB (see prisma seed). Permissions are `resource.action`.
 * Adding a route's required permission here (and asserting coverage in tests)
 * is how we keep authorization deny-by-default and drift-free.
 */

export interface PermissionDef {
  key: string;
  resource: string;
  action: string;
  description: string;
  group: string;
}

export interface PermissionGroupDef {
  key: string;
  name: string;
  description: string;
}

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  /** Permission keys or wildcards (e.g. "did.*", "*"). */
  permissions: string[];
}

export const PERMISSION_GROUPS: PermissionGroupDef[] = [
  { key: "tenant", name: "Tenant", description: "Tenant configuration and lifecycle" },
  { key: "iam", name: "Access management", description: "Users, memberships, roles" },
  { key: "numbers", name: "Numbers", description: "DID inventory & routing" },
  { key: "billing", name: "Billing", description: "Wallet, invoices, ledger" },
  { key: "audit", name: "Audit", description: "Audit and security trails" },
];

export const PERMISSIONS: PermissionDef[] = [
  // tenant
  { key: "tenant.read", resource: "tenant", action: "read", description: "View tenant settings", group: "tenant" },
  { key: "tenant.manage", resource: "tenant", action: "manage", description: "Update tenant settings", group: "tenant" },
  // iam
  { key: "member.read", resource: "member", action: "read", description: "View members", group: "iam" },
  { key: "member.invite", resource: "member", action: "invite", description: "Invite members", group: "iam" },
  { key: "member.manage", resource: "member", action: "manage", description: "Update/remove members & their roles", group: "iam" },
  { key: "role.read", resource: "role", action: "read", description: "View roles", group: "iam" },
  { key: "role.manage", resource: "role", action: "manage", description: "Create/update/delete custom roles", group: "iam" },
  // numbers (used by later phases; declared now so roles are stable)
  { key: "did.read", resource: "did", action: "read", description: "View DID inventory", group: "numbers" },
  { key: "did.assign", resource: "did", action: "assign", description: "Assign/release DIDs", group: "numbers" },
  // billing (declared for role stability)
  { key: "wallet.read", resource: "wallet", action: "read", description: "View balances", group: "billing" },
  { key: "wallet.credit", resource: "wallet", action: "credit", description: "Post wallet credits", group: "billing" },
  // audit
  { key: "audit.read", resource: "audit", action: "read", description: "View the tenant audit log", group: "audit" },
];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full control of the tenant",
    permissions: ["*"],
  },
  {
    key: "admin",
    name: "Administrator",
    description: "Manage access, numbers, and settings",
    permissions: ["tenant.*", "member.*", "role.*", "did.*", "audit.read"],
  },
  {
    key: "operator",
    name: "Operator",
    description: "Operate numbers and view billing",
    permissions: ["tenant.read", "member.read", "did.read", "did.assign", "wallet.read"],
  },
  {
    key: "auditor",
    name: "Auditor",
    description: "Read-only across the tenant",
    permissions: ["tenant.read", "member.read", "role.read", "did.read", "wallet.read", "audit.read"],
  },
];

/** All permission keys — used to expand wildcards at seed/eval time. */
export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);
