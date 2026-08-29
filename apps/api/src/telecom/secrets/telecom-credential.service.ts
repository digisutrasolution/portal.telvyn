import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { TelecomCredential, TelecomCredentialType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { loadEnv } from "@/config/env";
import { encryptSecret, decryptSecret } from "@/common/crypto.util";
import { authorizeDualNatureWrite, ownerTenantIdForCreate } from "@/authz/tenant-scope";

export interface CredentialScopeCtx {
  tenantId: string;
  isPlatform: boolean;
}

/** SAFE credential view — id + non-secret metadata only. NEVER `secretEnc`. */
export interface CredentialSafeView {
  id: string;
  type: TelecomCredentialType;
  label: string;
  hint: string | null;
  scope: "SYSTEM" | "TENANT";
  rotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Telecom credential vault (ADR-0009). Secret material lives ONLY here, at
 * rest as AES-256-GCM. The rest of the system holds a `credentialId` reference
 * and, at most, safe metadata. Decryption happens ONLY in `revealForAdapter`,
 * the narrowest server-side boundary — never surfaced through any API, DTO,
 * log, or audit entry.
 */
@Injectable()
export class TelecomCredentialService {
  private readonly env = loadEnv();

  constructor(private readonly prisma: PrismaService) {}

  private safeView(c: TelecomCredential): CredentialSafeView {
    return {
      id: c.id,
      type: c.type,
      label: c.label,
      hint: c.hint,
      scope: c.tenantId === null ? "SYSTEM" : "TENANT",
      rotatedAt: c.rotatedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  /** Create a vault entry owned per context (platform → system/null, else tenant). */
  async create(
    ctx: CredentialScopeCtx,
    input: { type: TelecomCredentialType; label: string; hint?: string; secret: string },
  ): Promise<CredentialSafeView> {
    const c = await this.prisma.telecomCredential.create({
      data: {
        tenantId: ownerTenantIdForCreate(ctx),
        type: input.type,
        label: input.label,
        hint: input.hint,
        secretEnc: encryptSecret(input.secret, this.env.APP_ENCRYPTION_KEY),
      },
    });
    return this.safeView(c);
  }

  /** Safe metadata for a credential the caller may see (own or system). */
  async getSafeView(id: string, ctx: CredentialScopeCtx): Promise<CredentialSafeView> {
    const c = await this.prisma.telecomCredential.findFirst({ where: { id, deletedAt: null } });
    // Visible = own tenant or system; a foreign-tenant credential is "not found".
    if (!c || (c.tenantId !== null && c.tenantId !== ctx.tenantId)) throw new NotFoundException("Credential not found");
    return this.safeView(c);
  }

  /**
   * Authorize attaching an EXISTING credential to a carrier/trunk owned by the
   * caller. Returns the id on success; enforces ownership/scope server-side:
   *   - own credential  → allowed
   *   - system credential → only a PLATFORM caller
   *   - another tenant's → NotFound (IDOR-safe)
   */
  async assertAttachable(credentialId: string, ctx: CredentialScopeCtx): Promise<string> {
    const c = await this.prisma.telecomCredential.findFirst({
      where: { id: credentialId, deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!c) throw new NotFoundException("Credential not found");
    const decision = authorizeDualNatureWrite(c.tenantId, ctx);
    if (decision === "not_found") throw new NotFoundException("Credential not found");
    if (decision === "forbidden_system") throw new ForbiddenException("Cannot attach a system credential to this resource");
    return c.id;
  }

  /**
   * ADAPTER BOUNDARY ONLY — decrypt a credential's secret for an outbound
   * engine/carrier call. Never call this from a controller or return its value
   * to a client. Secrets are not cached; each call decrypts on demand.
   */
  async revealForAdapter(credentialId: string): Promise<{ type: TelecomCredentialType; secret: string }> {
    const c = await this.prisma.telecomCredential.findFirst({
      where: { id: credentialId, deletedAt: null },
      select: { type: true, secretEnc: true },
    });
    if (!c) throw new NotFoundException("Credential not found");
    return { type: c.type, secret: decryptSecret(c.secretEnc, this.env.APP_ENCRYPTION_KEY) };
  }
}
