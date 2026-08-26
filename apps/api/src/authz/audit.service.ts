import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { RequestContext } from "@/common/request-context";
import type { TenantContext } from "./tenant-context";

/** Tenant-scoped mutation audit (constitution: audit all mutations). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    ctx: TenantContext;
    req: RequestContext;
    action: string;
    resource: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // Written via the scoped client so tenantId is injected + verified.
    await this.prisma.scoped.auditLog.create({
      data: {
        actorId: params.ctx.userId,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId ?? null,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
        ipAddress: params.req.ipAddress,
        userAgent: params.req.userAgent,
      },
    });
  }

  list(limit = 100) {
    return this.prisma.scoped.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
      select: {
        id: true,
        actorId: true,
        action: true,
        resource: true,
        resourceId: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
      },
    });
  }
}
