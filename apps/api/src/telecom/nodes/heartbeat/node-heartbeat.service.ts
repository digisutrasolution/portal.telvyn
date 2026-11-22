import { ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { TelecomCredentialType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { VerifiedNodeIdentity } from "./heartbeat-authenticator";

export interface HeartbeatAck {
  nodeId: string;
  acceptedAt: Date;
}

/**
 * Node heartbeat ingest (ADR-0020, Phase 12O-2ba). A node agent proves its
 * identity with its `NODE_AGENT` mTLS client certificate; an accepted beat only
 * stamps `NodeHealth.lastHeartbeatAt` — it does NOT change health status (the
 * dead-man's-switch evaluator owns transitions, slice 3). Fail-closed and
 * identity-bound: a node can report only its OWN health.
 *
 * Observability goes to the structured logger, NOT the audit log: the audit log
 * is an actor/tenant (human) record, and a 30s machine heartbeat would both lack
 * an honest actor and firehose the OLTP audit table (ADR-0010). Accepts log at
 * `log`, rejections at `warn` (a security signal), each with nodeId + correlation.
 */
@Injectable()
export class NodeHeartbeatService {
  private readonly logger = new Logger("NodeHeartbeatService");

  constructor(private readonly prisma: PrismaService) {}

  async ingest(nodeId: string, identity: VerifiedNodeIdentity | null, correlationId: string): Promise<HeartbeatAck> {
    // 1. Fail closed: no verified mTLS identity → never accepted. Checked BEFORE any
    //    node lookup so an unauthenticated caller gets no node-existence oracle.
    if (!identity) {
      this.reject(nodeId, correlationId, "unauthenticated");
      throw new UnauthorizedException("Heartbeat not authenticated");
    }

    const node = await this.prisma.telecomNode.findFirst({
      where: { id: nodeId, deletedAt: null },
      select: { id: true, credentialId: true, credential: { select: { type: true, hint: true } } },
    });
    if (!node) {
      this.reject(nodeId, correlationId, "node-not-found");
      throw new NotFoundException("Node not found");
    }

    // 2. Identity binding: the node must carry a NODE_AGENT credential whose stored
    //    non-secret fingerprint (hint) equals the presented verified fingerprint.
    if (!node.credentialId || node.credential?.type !== TelecomCredentialType.NODE_AGENT) {
      this.reject(nodeId, correlationId, "no-node-agent-credential");
      throw new ForbiddenException("Node has no node-agent credential");
    }
    if (!node.credential.hint || node.credential.hint !== identity.fingerprint) {
      this.reject(nodeId, correlationId, "identity-mismatch");
      throw new ForbiddenException("Heartbeat identity does not match the node credential");
    }

    // 3. Stamp liveness only. A beat is not a status transition (slice 3 evaluates
    //    HEALTHY/UNKNOWN from this timestamp); latency is not measured here.
    const acceptedAt = new Date();
    await this.prisma.nodeHealth.update({ where: { nodeId }, data: { lastHeartbeatAt: acceptedAt } });
    this.logger.log(JSON.stringify({ nodeId, operation: "node.heartbeat.ingest", correlationId, accepted: true }));
    return { nodeId, acceptedAt };
  }

  private reject(nodeId: string, correlationId: string, reason: string): void {
    this.logger.warn(JSON.stringify({ nodeId, operation: "node.heartbeat.ingest", correlationId, accepted: false, reason }));
  }
}
