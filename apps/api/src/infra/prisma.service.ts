import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { withTenantScope, type ScopedPrisma } from "./scoped-prisma";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * Tenant-scoped view of the client (ADR-0004). Services handling tenant-owned
   * models MUST use `prisma.scoped.*`; it injects the server-derived tenantId
   * and refuses unscoped access. The base client is used only for global
   * entities (User, Session, Tenant lookup by id at login).
   */
  readonly scoped: ScopedPrisma;

  constructor() {
    super();
    this.scoped = withTenantScope(this);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
