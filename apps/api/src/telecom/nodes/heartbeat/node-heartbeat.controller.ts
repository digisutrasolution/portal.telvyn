import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { RateLimitService, RATE_RULES } from "@/auth/rate-limit.service";
import { HeartbeatAuthenticator } from "./heartbeat-authenticator";
import { NodeHeartbeatService } from "./node-heartbeat.service";

/**
 * Node heartbeat ingest (ADR-0020, Phase 12O-2ba). A MACHINE endpoint: it is NOT
 * behind the human JWT/tenant/permission guards — its only authentication is the
 * node-agent mTLS client certificate, resolved by the `HeartbeatAuthenticator`
 * seam (which fails closed until a real mTLS terminator is wired). Rate-limited
 * per node and fail-closed on a Redis outage. Shares the `v1/telecom/nodes` prefix
 * with `NodesController` but carries none of its guards.
 */
@Controller("v1/telecom/nodes")
export class NodeHeartbeatController {
  constructor(
    private readonly heartbeat: NodeHeartbeatService,
    private readonly auth: HeartbeatAuthenticator,
    private readonly rate: RateLimitService,
  ) {}

  @Post(":id/heartbeat")
  @HttpCode(202)
  async beat(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    // Rate-limit first (per node), fail-closed if Redis is down (503).
    await this.rate.consume(RATE_RULES.nodeHeartbeat, id);
    const identity = await this.auth.verify(req); // null unless a real mTLS terminator verified the client cert
    const correlationId = randomUUID();
    const ack = await this.heartbeat.ingest(id, identity, correlationId);
    return { status: "accepted", nodeId: ack.nodeId, acceptedAt: ack.acceptedAt, correlationId };
  }
}
