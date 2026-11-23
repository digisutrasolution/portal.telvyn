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
  { key: "telecom", name: "Telecom", description: "Engines, nodes, carriers, trunks, routing, health" },
  { key: "fraud", name: "Fraud", description: "Fraud & abuse controls" },
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
  { key: "did.manage", resource: "did", action: "manage", description: "Manage DID lifecycle & routing", group: "numbers" },
  // billing (declared for role stability)
  { key: "wallet.read", resource: "wallet", action: "read", description: "View balances", group: "billing" },
  { key: "wallet.credit", resource: "wallet", action: "credit", description: "Post wallet credits", group: "billing" },
  // CDRs / usage are billing-adjacent; declared now (routes land in Phase 14) so
  // roles are stable and the frontend gates on cdr.read, not wallet.read.
  { key: "cdr.read", resource: "cdr", action: "read", description: "View call detail records (CDRs)", group: "billing" },
  // audit
  { key: "audit.read", resource: "audit", action: "read", description: "View the tenant audit log", group: "audit" },
  // telecom control plane (Phase 12). Platform infra = telecom.read/telecom.manage
  // (mutations further gated to PLATFORM tenants); tenant resources = carrier/sip_trunk/routing.
  { key: "telecom.read", resource: "telecom", action: "read", description: "View telecom engines, nodes & regions", group: "telecom" },
  { key: "telecom.manage", resource: "telecom", action: "manage", description: "Manage platform telecom engines, nodes & regions", group: "telecom" },
  { key: "telecom.health.read", resource: "telecom.health", action: "read", description: "View telecom health & heartbeats", group: "telecom" },
  { key: "carrier.read", resource: "carrier", action: "read", description: "View carriers", group: "telecom" },
  { key: "carrier.create", resource: "carrier", action: "create", description: "Create carriers", group: "telecom" },
  { key: "carrier.update", resource: "carrier", action: "update", description: "Update carriers", group: "telecom" },
  { key: "carrier.delete", resource: "carrier", action: "delete", description: "Delete carriers", group: "telecom" },
  { key: "sip_trunk.read", resource: "sip_trunk", action: "read", description: "View SIP trunks", group: "telecom" },
  { key: "sip_trunk.create", resource: "sip_trunk", action: "create", description: "Create SIP trunks", group: "telecom" },
  { key: "sip_trunk.update", resource: "sip_trunk", action: "update", description: "Update SIP trunks", group: "telecom" },
  { key: "sip_trunk.delete", resource: "sip_trunk", action: "delete", description: "Delete SIP trunks", group: "telecom" },
  { key: "routing.read", resource: "routing", action: "read", description: "View routing profiles", group: "telecom" },
  { key: "routing.manage", resource: "routing", action: "manage", description: "Manage routing profiles & rules", group: "telecom" },
  // fraud control plane (Phase 12R, ADR-0021). Foundation slice: read-only
  // access to the tenant's own fraud events. Enforcement permissions
  // (fraud.policy.manage, fraud.killswitch, platform read_all) land with their
  // slices — declared there, never as a `fraud.*` wildcard, so no escalation.
  { key: "fraud.events.read", resource: "fraud.events", action: "read", description: "View fraud events", group: "fraud" },
  // fraud policy authoring (Phase 12R-2a). Declarative config only — no
  // enforcement. `read` is oversight; `manage` creates/updates/deletes limits.
  { key: "fraud.policy.read", resource: "fraud.policy", action: "read", description: "View fraud policy (spend limits)", group: "fraud" },
  { key: "fraud.policy.manage", resource: "fraud.policy", action: "manage", description: "Manage fraud policy (spend limits)", group: "fraud" },
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
    description: "Manage access, numbers, carriers, trunks, routing, and settings",
    permissions: [
      "tenant.*", "member.*", "role.*", "did.*", "audit.read",
      "carrier.*", "sip_trunk.*", "routing.*", "telecom.read", "telecom.health.read",
      // Explicit (not fraud.*) — events read + policy authoring; still no
      // enforcement-control perm (those land, explicit, with their slices).
      "fraud.events.read", "fraud.policy.read", "fraud.policy.manage",
    ],
  },
  {
    key: "operator",
    name: "Operator",
    description: "Operate numbers and connectivity, view billing & health",
    permissions: [
      "tenant.read", "member.read", "did.read", "did.assign", "wallet.read", "cdr.read",
      "carrier.read", "sip_trunk.read", "routing.read", "telecom.read", "telecom.health.read",
    ],
  },
  {
    key: "auditor",
    name: "Auditor",
    description: "Read-only across the tenant",
    permissions: [
      "tenant.read", "member.read", "role.read", "did.read", "wallet.read", "cdr.read", "audit.read",
      "carrier.read", "sip_trunk.read", "routing.read", "telecom.read", "telecom.health.read",
      "fraud.events.read", "fraud.policy.read",
    ],
  },
];

/** All permission keys — used to expand wildcards at seed/eval time. */
export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);
