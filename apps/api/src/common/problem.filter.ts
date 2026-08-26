import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/**
 * RFC 7807 problem+json error filter (API.md contract). Never leaks stack
 * traces or internals; unexpected errors are logged server-side and surfaced
 * as a generic 500.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger("Problem");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = "Internal server error";
    let detail: string | undefined;
    let issues: unknown[] | undefined;

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      title = "Validation failed";
      issues = exception.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        title = body;
      } else if (typeof body === "object" && body !== null) {
        const b = body as Record<string, unknown>;
        title = typeof b.error === "string" ? b.error : (typeof b.message === "string" ? b.message : title);
        detail = Array.isArray(b.message) ? b.message.join("; ") : typeof b.message === "string" && b.message !== title ? b.message : undefined;
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }

    res
      .status(status)
      .type("application/problem+json")
      .json({ title, status, ...(detail ? { detail } : {}), ...(issues ? { issues } : {}) });
  }
}
