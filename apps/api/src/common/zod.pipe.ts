import { Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/** Validates a request body against a Zod schema; ZodError → 400 problem+json via ProblemFilter. */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
