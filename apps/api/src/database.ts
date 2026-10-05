import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createDatabase } from "@job-agent/database";
@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  readonly client = createDatabase(process.env.DATABASE_URL!);
  async onModuleInit() {
    await this.client.$connect();
  }
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
