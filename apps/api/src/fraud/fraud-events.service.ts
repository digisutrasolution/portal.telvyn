import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, type FraudEventSeverity, type FraudEventType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { AuditService } from "@/authz/audit.service";
import { getTenantContext, type TenantContext } from "@/authz/tenant-context";
import type { RequestContext } from "@/common/request-context";
import { cursorArgs, toPage } from "@/common/pagination";

/**
 * Fraud-event foundation (Phase 12R-1, ADR-0021). The append-only, tenant-scoped
 * store of fraud-relevant occurrences + a read API. NO enforcement lives here —
 * no spend/velocity/geo/destination control, no kill-switch, no call
 * authorization, no engine wiring. Reads and writes go through the tenant-scoping
 * Prisma client (`prisma.scoped`), so the server-derived tenantId is injected and
 * unscoped access is refused (ADR-0004, deny-by-default, IDOR-safe).
 */

/** Bounds for the structured metadata blob (never secrets / unnecessary PII). */
const MAX_METADATA_BYTES = 4096;
const MAX_METADATA_KEYS = 50;

export interface RecordFraudEventInput {
  type: FraudEventType;
  severity?: FraudEventSeverity;
  /** The control that raised it, e.g. "velocity" | "spend" | "geo" | "kill-switch". */
  source: string;
  /** Short machine reason code, e.g. "DAILY_SPEND_EXCEEDED". */
  code: string;
  /** Safe human-readable text (bounded; never secrets/PII). */
  reason?: string | null;
  /** Ties to a call attempt / request (future producers). */
  correlationId?: string | null;
  /** The user whose action raised it; omit for system-raised events. */
  actorId?: string | null;
  metadata?: unknown;
}

export interface FraudEventListQuery {
  limit: number;
  cursor?: string;
  type?: FraudEventType;
  severity?: FraudEventSeverity;
}

@Injectable()
export class FraudEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Record an append-only fraud event for the ACTIVE tenant context. Internal
   * only in this slice — there is no public creation endpoint. When an
   * authenticated actor's action raised the event, pass `auditWith` and one
   * AuditService entry is written alongside (ADR-0021 §4); system-raised events
   * (no actor) write the FraudEvent ONLY — never an AuditLog per event — so the
   * high-volume call-authorization path cannot firehose the audit log (ADR-0010).
   */
  async record(input: RecordFraudEventInput, auditWith?: { ctx: TenantContext; req: RequestContext }): Promise<void> {
    // tenantId is server-derived (from the active context); the scoped client
    // re-asserts it at runtime. Deny-by-default: no context → no fraud event.
    const ctx = auditWith?.ctx ?? getTenantContext();
    if (!ctx) throw new Error("fraud event recorded without a tenant context");
    const metadata = normalizeMetadata(input.metadata);
    await this.prisma.scoped.fraudEvent.create({
      data: {
        tenantId: ctx.tenantId,
        type: input.type,
        severity: input.severity ?? "WARNING",
        source: input.source.slice(0, 64),
        code: input.code.slice(0, 64),
        reason: input.reason ? input.reason.slice(0, 500) : null,
        correlationId: input.correlationId ?? null,
        actorId: auditWith?.ctx.userId ?? input.actorId ?? null,
        ...(metadata !== undefined ? { metadata } : {}),
      },
    });

    if (auditWith) {
      await this.audit.log({
        ctx: auditWith.ctx,
        req: auditWith.req,
        action: "fraud.event.recorded",
        resource: "fraud_event",
        // Reference-only — never the raw metadata, which may hold context detail.
        metadata: { type: input.type, source: input.source, code: input.code, severity: input.severity ?? "WARNING" },
      });
    }
  }

  /**
   * The active tenant's own fraud events, newest first, cursor-paginated. The
   * scoped client filters by the server-derived tenantId; the safe view never
   * echoes tenantId. Optional type/severity filters.
   */
  async list(query: FraudEventListQuery) {
    const where: Prisma.FraudEventWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
    };
    const rows = await this.prisma.scoped.fraudEvent.findMany({ where, ...cursorArgs(query.limit, query.cursor) });
    const { items, nextCursor } = toPage(rows, query.limit);
    return {
      items: items.map((e) => ({
        id: e.id,
        type: e.type,
        severity: e.severity,
        source: e.source,
        code: e.code,
        reason: e.reason,
        correlationId: e.correlationId,
        actorId: e.actorId,
        metadata: e.metadata,
        createdAt: e.createdAt,
      })),
      nextCursor,
    };
  }
}

/** Validate the metadata blob: a bounded, plain JSON object or nothing. */
export function normalizeMetadata(meta: unknown): Prisma.InputJsonValue | undefined {
  if (meta === undefined || meta === null) return undefined;
  if (typeof meta !== "object" || Array.isArray(meta)) {
    throw new BadRequestException("fraud event metadata must be a JSON object");
  }
  const keys = Object.keys(meta as Record<string, unknown>);
  if (keys.length > MAX_METADATA_KEYS) {
    throw new BadRequestException("fraud event metadata has too many keys");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(meta);
  } catch {
    throw new BadRequestException("fraud event metadata is not serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    throw new BadRequestException("fraud event metadata is too large");
  }
  return meta as Prisma.InputJsonValue;
}
