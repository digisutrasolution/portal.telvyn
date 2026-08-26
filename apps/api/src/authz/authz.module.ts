import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { AuthModule } from "@/auth/auth.module";
import { AuthzController } from "./authz.controller";
import { TenancyService } from "./tenancy.service";
import { RolesService } from "./roles.service";
import { AuditService } from "./audit.service";
import { TenantGuard } from "./tenant.guard";
import { PermissionGuard } from "./permission.guard";

@Module({
  imports: [AuthModule],
  controllers: [AuthzController],
  providers: [PrismaService, TenancyService, RolesService, AuditService, TenantGuard, PermissionGuard],
  exports: [TenantGuard, PermissionGuard, AuditService],
})
export class AuthzModule {}
