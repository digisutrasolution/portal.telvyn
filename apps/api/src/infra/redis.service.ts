import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { loadEnv } from "@/config/env";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(loadEnv().REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    // Errors surface per-command; a down Redis makes security checks fail CLOSED.
    this.client.on("error", () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
