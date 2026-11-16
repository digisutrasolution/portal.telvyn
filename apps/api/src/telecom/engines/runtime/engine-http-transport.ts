import { Injectable } from "@nestjs/common";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { assertResolvedIpAllowed } from "./engine-endpoint";

/**
 * The single NETWORK seam for engine management calls (Phase 12M-3). A connector
 * builds a typed request; this transport performs the actual mTLS HTTPS POST.
 * Abstract so connector logic is unit-testable with a mocked transport (no live
 * egress), while the real `NodeHttpsEngineTransport` is integration-tested
 * against the disposable engine in Phase 12M-4.
 *
 * Security envelope (real impl):
 *  - **https only** (management plane is behind an mTLS gateway); client cert+key
 *    presented, server cert verified (`rejectUnauthorized: true`).
 *  - **DNS-rebinding defence**: a custom DNS lookup re-validates the resolved IP
 *    against the canonical SSRF policy + allowlist (`assertResolvedIpAllowed`)
 *    for the intended port BEFORE the socket connects.
 *  - **Bounded**: explicit connect + request timeouts; a capped response body.
 *  - Never logs secrets or raw provider errors (the connector maps failures to a
 *    safe, fixed vocabulary).
 */

export interface EngineMtls {
  cert: string;
  key: string;
  ca?: string;
}

export interface EngineHttpRequest {
  /** Absolute https URL (already SSRF-validated + normalized by the connector). */
  url: string;
  body: unknown;
  mtls: EngineMtls;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  correlationId: string;
}

export interface EngineHttpResponse {
  httpStatus: number;
  /** Parsed JSON body, or undefined if the body was empty / not JSON. */
  json: unknown;
}

/** A transport REJECTS only when no application response was received (not contacted). */
export abstract class EngineHttpTransport {
  abstract postJson(req: EngineHttpRequest): Promise<EngineHttpResponse>;
}

const MAX_BODY_BYTES = 64 * 1024;

@Injectable()
export class NodeHttpsEngineTransport extends EngineHttpTransport {
  async postJson(req: EngineHttpRequest): Promise<EngineHttpResponse> {
    const u = new URL(req.url);
    if (u.protocol !== "https:") {
      throw new Error("engine management transport requires https (mTLS)");
    }
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const port = u.port ? Number(u.port) : 443;
    const payload = Buffer.from(JSON.stringify(req.body), "utf8");

    // Rebinding defence: validate the DNS-resolved IP for THIS port before connect.
    const rebindingSafeLookup: LookupFunction = (hostname, options, cb) => {
      dnsLookup(hostname, options, (err, address, family) => {
        if (err) return cb(err, address, family);
        const ip = typeof address === "string" ? address : address[0]?.address;
        try {
          if (ip) assertResolvedIpAllowed(ip, { port });
        } catch (e) {
          return cb(e as NodeJS.ErrnoException, address, family);
        }
        cb(null, address, family);
      });
    };

    return await new Promise<EngineHttpResponse>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const request = https.request(
        {
          protocol: "https:",
          hostname: host,
          port,
          path: `${u.pathname}${u.search}` || "/",
          method: "POST",
          cert: req.mtls.cert,
          key: req.mtls.key,
          ca: req.mtls.ca,
          rejectUnauthorized: true,
          servername: host,
          headers: {
            "content-type": "application/json",
            "content-length": payload.length,
            accept: "application/json",
          },
          timeout: req.requestTimeoutMs,
          lookup: rebindingSafeLookup,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
              res.destroy();
              done(() => reject(new Error("engine response exceeded size limit")));
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json: unknown;
            try {
              json = text ? JSON.parse(text) : undefined;
            } catch {
              json = undefined;
            }
            done(() => resolve({ httpStatus: res.statusCode ?? 0, json }));
          });
          res.on("error", (e) => done(() => reject(e)));
        },
      );

      const connectTimer = setTimeout(() => {
        request.destroy(new Error("engine connect timeout"));
      }, req.connectTimeoutMs);
      request.on("socket", (s) => s.on("connect", () => clearTimeout(connectTimer)));
      request.on("timeout", () => request.destroy(new Error("engine request timeout")));
      request.on("error", (e) => {
        clearTimeout(connectTimer);
        done(() => reject(e));
      });

      request.write(payload);
      request.end();
    });
  }
}
