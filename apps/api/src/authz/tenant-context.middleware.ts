import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { seedTenantStore } from "./tenant-context";

/**
 * Seeds the tenant-context AsyncLocalStorage store for the entire request, so
 * the store set here stays active through guards and the route handler. The
 * TenantGuard fills the context in; the scoped Prisma client reads it.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    seedTenantStore(() => next());
  }
}
