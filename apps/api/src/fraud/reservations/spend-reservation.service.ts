import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Currency, type SpendLimitPeriod, type SpendReservation } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { RedisService } from "@/infra/redis.service";
import type { TenantContext } from "@/authz/tenant-context";

/**
 * Spend-reservation ledger (Phase 12R-6, ADR-0021) — holds a call's estimated
 * cost against a tenant's DAILY/MONTHLY spend caps while the call is in flight,
 * so a burst of concurrent authorizations cannot each pass a period cap and
 * collectively blow through it. The durable `SpendReservation` rows are the
 * source of truth (audit, idempotency, settle/release/expire lifecycle); a
 * Redis per-period micros gauge is the hot total the decision reads, kept
 * reconcilable from the rows.
 *
 * **Fail-closed read**: `readReserved` throws on a Redis outage so the decision
 * denies rather than evaluating a period cap against an unknown reserved total.
 * The write side mirrors the velocity service: `reserve` fails closed (undoing
 * the durable hold if the gauge cannot be raised); `settle`/`release`/`expire`
 * adjust the gauge best-effort (a stuck gauge self-heals on the window roll).
 *
 * NOTE: nothing places a reservation at call time yet — the engine-wired
 * call-authorization path that reserves on authorize and settles/releases on
 * call end is a later slice (12R-8), and the TTL sweeper (`expireDue`) is wired
 * to a job later. This slice builds and tests the mechanism and wires the READ
 * into the decision so the period-spend check and its fail-closed behaviour are
 * real. Settled actuals fold into the billing ledger (Phase 13); until then a
 * period cap reflects in-flight reservations only.
 */

/** Periods that accumulate reserved spend over a window (PER_CALL is not one). */
const RESERVE_PERIODS = ["DAILY", "MONTHLY"] as const satisfies readonly SpendLimitPeriod[];
type ReservePeriod = (typeof RESERVE_PERIODS)[number];

/** INCRBY then set the window TTL only when the key has none yet (first hit). */
const INCR_LUA =
  "local v = redis.call('incrby', KEYS[1], ARGV[1]); if redis.call('ttl', KEYS[1]) < 0 then redis.call('expire', KEYS[1], ARGV[2]) end; return v";
/** DECRBY with a floor at zero so a double-release never drives the gauge negative. */
const DECR_LUA =
  "local v = redis.call('decrby', KEYS[1], ARGV[1]); if tonumber(v) < 0 then redis.call('set', KEYS[1], 0); return 0 end; return v";

export interface ReserveInput {
  /** Dedupes retries of the same call-authorization attempt (one hold per key). */
  idempotencyKey: string;
  /** Estimated cost of this call in integer micros. */
  amountMicros: number;
  currency?: Currency;
  /** Ties the hold to the call attempt. */
  correlationId?: string;
  /** How long the hold stays ACTIVE before the sweeper returns it. */
  ttlSeconds: number;
}

export interface SpendReservationView {
  id: string;
  idempotencyKey: string;
  amountMicros: number;
  settledMicros: number | null;
  currency: Currency;
  status: SpendReservation["status"];
  correlationId: string | null;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class SpendReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private key(tenantId: string, period: ReservePeriod): string {
    return `fraud:spend:${tenantId}:${period}`;
  }

  /**
   * Current reserved micros per window period. Fail-closed: throws
   * ServiceUnavailable if Redis cannot be read, so the decision denies rather
   * than evaluating a period cap against an unknown reserved total.
   */
  async readReserved(tenantId: string): Promise<Partial<Record<SpendLimitPeriod, number>>> {
    try {
      const [daily, monthly] = await this.redis.client.mget(this.key(tenantId, "DAILY"), this.key(tenantId, "MONTHLY"));
      return { DAILY: toMicros(daily), MONTHLY: toMicros(monthly) };
    } catch {
      throw new ServiceUnavailableException("spend reservation ledger unavailable");
    }
  }

  /** The active tenant's reservation for this key, or null — the enforcing hook's idempotency lookup. */
  async find(_ctx: TenantContext, idempotencyKey: string): Promise<SpendReservationView | null> {
    const row = await this.prisma.scoped.spendReservation.findFirst({ where: { idempotencyKey } });
    return row ? this.view(row) : null;
  }

  /**
   * Hold `amountMicros` for the active tenant. Idempotent on `idempotencyKey`:
   * an existing hold for the key is returned unchanged (never double-counted).
   * Fail-closed: if the hot gauge cannot be raised, the durable hold is undone
   * (RELEASED) and the call denies. Intended for the future call path.
   */
  async reserve(ctx: TenantContext, input: ReserveInput): Promise<SpendReservationView> {
    const existing = await this.prisma.scoped.spendReservation.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return this.view(existing);

    let row: SpendReservation;
    try {
      row = await this.prisma.scoped.spendReservation.create({
        data: {
          tenantId: ctx.tenantId, // server-derived; scoped client re-asserts it
          idempotencyKey: input.idempotencyKey,
          amountMicros: BigInt(input.amountMicros),
          currency: input.currency ?? "USD",
          correlationId: input.correlationId ?? null,
          expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
        },
      });
    } catch (e) {
      // Lost a race for the same key — return the winner's hold (idempotent).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const won = await this.prisma.scoped.spendReservation.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
        if (won) return this.view(won);
      }
      throw e;
    }

    try {
      const now = new Date();
      await this.redis.client.eval(INCR_LUA, 1, this.key(ctx.tenantId, "DAILY"), String(input.amountMicros), String(secondsUntilEndOfUtcDay(now)));
      await this.redis.client.eval(INCR_LUA, 1, this.key(ctx.tenantId, "MONTHLY"), String(input.amountMicros), String(secondsUntilEndOfUtcMonth(now)));
    } catch {
      // Gauge unreachable — undo the durable hold so it is not counted twice on retry.
      await this.prisma.spendReservation.update({ where: { id: row.id }, data: { status: "RELEASED", releasedAt: new Date() } }).catch(() => undefined);
      throw new ServiceUnavailableException("spend reservation ledger unavailable");
    }
    return this.view(row);
  }

  /** Record the actual cost of a completed call and release its hold from the gauge. No-op if not ACTIVE (idempotent). */
  async settle(_ctx: TenantContext, idempotencyKey: string, settledMicros: number): Promise<void> {
    const row = await this.prisma.scoped.spendReservation.findFirst({ where: { idempotencyKey } });
    if (!row || row.status !== "ACTIVE") return;
    await this.prisma.spendReservation.update({
      where: { id: row.id },
      data: { status: "SETTLED", settledMicros: BigInt(settledMicros), settledAt: new Date() },
    });
    await this.releaseGauge(row.tenantId, row.amountMicros);
  }

  /** Return a hold whose call was never placed / failed / cancelled. No-op if not ACTIVE (idempotent). */
  async release(_ctx: TenantContext, idempotencyKey: string): Promise<void> {
    const row = await this.prisma.scoped.spendReservation.findFirst({ where: { idempotencyKey } });
    if (!row || row.status !== "ACTIVE") return;
    await this.prisma.spendReservation.update({ where: { id: row.id }, data: { status: "RELEASED", releasedAt: new Date() } });
    await this.releaseGauge(row.tenantId, row.amountMicros);
  }

  /**
   * TTL sweeper — a SYSTEM (cross-tenant) job: mark ACTIVE holds past their TTL
   * as EXPIRED and return each one's SPEND gauge hold. Uses the base (unscoped)
   * client because it spans tenants. Returns the tenantId of every reservation it
   * expired (one entry per hold — a tenant with several overdue holds appears
   * several times), so the caller can also return the matching concurrent-call
   * gauge hold (the FraudSweeperService does, 12R-9).
   */
  async expireDue(now: Date = new Date(), batch = 500): Promise<string[]> {
    const due = await this.prisma.spendReservation.findMany({
      where: { status: "ACTIVE", expiresAt: { lte: now } },
      take: batch,
    });
    const expiredTenantIds: string[] = [];
    for (const row of due) {
      const res = await this.prisma.spendReservation.updateMany({
        where: { id: row.id, status: "ACTIVE" }, // guard against a concurrent settle/release
        data: { status: "EXPIRED" },
      });
      if (res.count === 1) {
        expiredTenantIds.push(row.tenantId);
        await this.releaseGauge(row.tenantId, row.amountMicros);
      }
    }
    return expiredTenantIds;
  }

  /** Lower the hot gauge for a returned hold across every window. Best-effort. */
  private async releaseGauge(tenantId: string, amountMicros: bigint): Promise<void> {
    try {
      await Promise.all(
        RESERVE_PERIODS.map((p) => this.redis.client.eval(DECR_LUA, 1, this.key(tenantId, p), String(amountMicros))),
      );
    } catch {
      /* best-effort — a stuck gauge self-heals on the window roll or a reconcile. */
    }
  }

  private view(r: SpendReservation): SpendReservationView {
    return {
      id: r.id,
      idempotencyKey: r.idempotencyKey,
      amountMicros: Number(r.amountMicros), // bounded ≤1e15 → JSON-safe
      settledMicros: r.settledMicros === null ? null : Number(r.settledMicros),
      currency: r.currency,
      status: r.status,
      correlationId: r.correlationId,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    };
  }
}

function toMicros(raw: string | null): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whole seconds until the next UTC midnight (≥1). */
export function secondsUntilEndOfUtcDay(now: Date): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}
/** Whole seconds until the first instant of the next UTC month (≥1). */
export function secondsUntilEndOfUtcMonth(now: Date): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}
