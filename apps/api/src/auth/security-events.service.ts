import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { RequestContext } from "@/common/request-context";

/** Auth-domain audit trail: security events + login attempts (constitution: audit all mutations). */
@Injectable()
export class SecurityEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(type: string, ctx: RequestContext, userId?: string | null, metadata?: Record<string, unknown>): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        type,
        userId: userId ?? null,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }

  async recordLoginAttempt(params: {
    emailTried: string;
    userId?: string | null;
    success: boolean;
    failureReason?: string;
    ctx: RequestContext;
  }): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        emailTried: params.emailTried,
        userId: params.userId ?? null,
        success: params.success,
        failureReason: params.failureReason ?? null,
        ipAddress: params.ctx.ipAddress,
        userAgent: params.ctx.userAgent,
      },
    });
  }

  listLoginHistory(userId: string) {
    return this.prisma.loginAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, success: true, failureReason: true, ipAddress: true, userAgent: true, createdAt: true },
    });
  }

  listSecurityEvents(userId: string) {
    return this.prisma.securityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, metadata: true, ipAddress: true, createdAt: true },
    });
  }
}
