import { Injectable } from "@nestjs/common";
import type { Request } from "express";

/** A verified node-agent identity, produced only by a real mTLS terminator. */
export interface VerifiedNodeIdentity {
  /** SHA-256 fingerprint of the verified client certificate (hex, lowercase, no colons). */
  fingerprint: string;
}

/**
 * The single authentication seam for node heartbeats (ADR-0020, Phase 12O-2ba) —
 * the analogue of ADR-0011's `EngineConnector`: the ONLY place a verified mTLS
 * client identity enters the control plane. Everything above it is pure logic.
 *
 * It returns a `VerifiedNodeIdentity` ONLY when a real mTLS terminator has already
 * verified the client certificate (app-terminated TLS socket, or a trusted
 * gateway that forwards a verified fingerprint). It MUST NOT derive identity from
 * anything a client can spoof (a plain header, a body field).
 */
export abstract class HeartbeatAuthenticator {
  abstract verify(req: Request): Promise<VerifiedNodeIdentity | null>;
}

/**
 * The default, honest implementation shipped today: there is **no inbound mTLS
 * terminator** in the environment yet (the app is a plain-HTTP JSON API behind a
 * TLS-terminating proxy; the only mTLS is the OUTBOUND engine gateway, ADR-0011).
 * So this authenticator **fails closed** — it never produces an identity, and
 * every heartbeat is therefore rejected (401). We do NOT pretend to have verified
 * a certificate we never saw. A real terminator is a drop-in replacement of this
 * one interface, exactly like swapping `NullEngineConnector` for a real connector.
 */
@Injectable()
export class NullHeartbeatAuthenticator extends HeartbeatAuthenticator {
  async verify(_req: Request): Promise<VerifiedNodeIdentity | null> {
    void _req;
    return null; // no verified mTLS identity → fail closed
  }
}
