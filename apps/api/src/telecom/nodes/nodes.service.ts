import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { X509Certificate } from "node:crypto";
import { HealthStatus, Prisma, TelecomCredentialType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { TelecomCredentialService, type CredentialScopeCtx } from "../secrets/telecom-credential.service";
import type { AttachNodeCredentialInput, CreateNodeInput, UpdateNodeInput } from "../infra.dto";

// A safe credential reference — NEVER the encrypted secret (secretEnc is omitted).
const NODE_INCLUDE = {
  health: true,
  credential: { select: { id: true, type: true, label: true, hint: true, tenantId: true } },
} satisfies Prisma.TelecomNodeInclude;
type NodeWithHealth = Prisma.TelecomNodeGetPayload<{ include: typeof NODE_INCLUDE }>;

/** SHA-256 fingerprint of a client cert, normalized (lowercase hex, no colons) to match the mTLS authenticator. */
function certFingerprint(pem: string): string {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    throw new BadRequestException("Invalid certificate PEM");
  }
  return cert.fingerprint256.toLowerCase().replace(/:/g, "");
}

/**
 * Platform telecom nodes (ADR-0010). Configuration is durable; the health
 * snapshot is runtime (starts UNKNOWN, populated by the health framework in a
 * later phase). Platform-global — not tenant-scoped.
 */
@Injectable()
export class NodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: TelecomCredentialService,
  ) {}

  private view(n: NodeWithHealth) {
    return {
      id: n.id,
      name: n.name,
      engineId: n.engineId,
      regionId: n.regionId,
      zone: n.zone,
      environment: n.environment,
      hostRef: n.hostRef,
      status: n.status,
      version: n.version,
      maxCps: n.maxCps,
      maxConcurrentCalls: n.maxConcurrentCalls,
      health: n.health
        ? { status: n.health.status, latencyMs: n.health.latencyMs, lastHeartbeatAt: n.health.lastHeartbeatAt }
        : { status: HealthStatus.UNKNOWN, latencyMs: null, lastHeartbeatAt: null },
      // Safe node-agent credential reference (never the secret); `hint` is the cert fingerprint.
      credential: n.credential
        ? { id: n.credential.id, type: n.credential.type, label: n.credential.label, hint: n.credential.hint, scope: n.credential.tenantId === null ? "SYSTEM" : "TENANT" }
        : null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
  }

  async list() {
    const rows = await this.prisma.telecomNode.findMany({
      where: { deletedAt: null },
      include: NODE_INCLUDE,
      orderBy: { name: "asc" },
      take: 500,
    });
    return rows.map((n) => this.view(n));
  }

  async get(id: string) {
    const n = await this.prisma.telecomNode.findFirst({ where: { id, deletedAt: null }, include: NODE_INCLUDE });
    if (!n) throw new NotFoundException("Node not found");
    return this.view(n);
  }

  /**
   * Attach (or rotate) the node's NODE_AGENT mTLS credential (ADR-0020). Takes the
   * node's PUBLIC client certificate; the private key stays on the node. The server
   * derives the fingerprint (→ credential hint, what the heartbeat authenticator
   * matches) and vaults the PEM. Rotation: a prior node-agent credential is
   * soft-deleted so the node has exactly one active identity.
   */
  async attachCredential(scope: CredentialScopeCtx, id: string, input: AttachNodeCredentialInput) {
    const node = await this.prisma.telecomNode.findFirst({ where: { id, deletedAt: null }, select: { id: true, credentialId: true } });
    if (!node) throw new NotFoundException("Node not found");
    const fingerprint = certFingerprint(input.certificate);
    const cred = await this.vault.create(scope, {
      type: TelecomCredentialType.NODE_AGENT,
      label: input.label ?? `node-agent ${fingerprint.slice(0, 12)}`,
      hint: fingerprint, // non-secret matcher for the heartbeat authenticator
      secret: input.certificate, // the public cert, vaulted (not exposed in responses)
    });
    await this.prisma.$transaction([
      this.prisma.telecomNode.update({ where: { id }, data: { credentialId: cred.id } }),
      ...(node.credentialId ? [this.prisma.telecomCredential.update({ where: { id: node.credentialId }, data: { deletedAt: new Date() } })] : []),
    ]);
    return this.get(id);
  }

  /** Detach the node's credential (idempotent); the credential row is soft-deleted. */
  async detachCredential(id: string) {
    const node = await this.prisma.telecomNode.findFirst({ where: { id, deletedAt: null }, select: { id: true, credentialId: true } });
    if (!node) throw new NotFoundException("Node not found");
    if (node.credentialId) {
      await this.prisma.$transaction([
        this.prisma.telecomNode.update({ where: { id }, data: { credentialId: null } }),
        this.prisma.telecomCredential.update({ where: { id: node.credentialId }, data: { deletedAt: new Date() } }),
      ]);
    }
  }

  async getHealth(id: string) {
    const view = await this.get(id);
    return view.health;
  }

  async create(input: CreateNodeInput) {
    await this.assertEngineExists(input.engineId);
    if (input.regionId) await this.assertRegionExists(input.regionId);
    // Relation connects (not scalar FKs) because we also nest the health create.
    const n = await this.prisma.telecomNode.create({
      data: {
        name: input.name,
        engine: { connect: { id: input.engineId } },
        region: input.regionId ? { connect: { id: input.regionId } } : undefined,
        zone: input.zone,
        environment: input.environment,
        hostRef: input.hostRef,
        status: input.status,
        version: input.version,
        maxCps: input.maxCps,
        maxConcurrentCalls: input.maxConcurrentCalls,
        // Honest UNKNOWN health snapshot (1:1) — populated by the health framework (12I).
        health: { create: { status: HealthStatus.UNKNOWN } },
      },
      include: NODE_INCLUDE,
    });
    return this.view(n);
  }

  async update(id: string, input: UpdateNodeInput) {
    await this.getRaw(id);
    if (input.regionId) await this.assertRegionExists(input.regionId);
    const n = await this.prisma.telecomNode.update({ where: { id }, data: { ...input }, include: NODE_INCLUDE });
    return this.view(n);
  }

  async remove(id: string) {
    await this.getRaw(id);
    await this.prisma.telecomNode.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async getRaw(id: string) {
    const n = await this.prisma.telecomNode.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!n) throw new NotFoundException("Node not found");
    return n;
  }

  private async assertEngineExists(id: string): Promise<void> {
    const e = await this.prisma.telecomEngine.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!e) throw new BadRequestException("Referenced engine does not exist");
  }

  private async assertRegionExists(id: string): Promise<void> {
    const r = await this.prisma.region.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!r) throw new BadRequestException("Referenced region does not exist");
  }
}
