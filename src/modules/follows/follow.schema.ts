import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const userIdParamsSchema = z.object({ userId: objectIdSchema });
export const requestIdParamsSchema = z.object({ id: objectIdSchema });
export const usernameParamsSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(30),
});

export const pageQuerySchema = z.object({
  cursor: objectIdSchema.optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(50).default(20).catch(20),
});

export const connectionsQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(50).optional().catch(undefined),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;
export type ConnectionsQuery = z.infer<typeof connectionsQuerySchema>;
