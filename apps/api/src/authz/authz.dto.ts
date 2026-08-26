import { z } from "zod";

export const UpdateTenantDto = z.object({ name: z.string().trim().min(1).max(160) });

export const SetMemberRolesDto = z.object({
  roleIds: z.array(z.string().uuid()).max(20),
});

export const CreateRoleDto = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,48}$/, "key must be lower_snake_case"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280).optional(),
  permissions: z.array(z.string().trim().min(1).max(64)).min(1).max(64),
});

export type UpdateTenantInput = z.infer<typeof UpdateTenantDto>;
export type SetMemberRolesInput = z.infer<typeof SetMemberRolesDto>;
export type CreateRoleInput = z.infer<typeof CreateRoleDto>;
