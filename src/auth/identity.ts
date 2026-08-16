/**
 * Phase 1 Foundation + Phase 4 Hardening: Identity resolution middleware.
 *
 * Resolves the current Telegram user to their database-backed User record
 * and optional Admin record. Sets ctx.user and ctx.admin (if applicable)
 * on the context.
 *
 * This middleware runs on EVERY update (after session, before conversations).
 * It does NOT reject any requests — it just populates the context. Authorization
 * decisions are made by the permission functions in auth/permissions.ts.
 *
 * The existing authAdmin middleware is preserved for backward compatibility.
 * This new middleware provides the canonical identity that future phases
 * will use.
 *
 * Phase 4 Hardening changes:
 *   - resolveIdentity now loads `User.isActive` (previously absent). This
 *     is critical because Phase 4 introduced `User.isActive` as the
 *     authoritative active/inactive flag for staff. Without loading it,
 *     permission checks could not consult it, and a deactivated staff
 *     member would still pass `hasPermission({role: TEACHER}, ...)`.
 *   - The resolved user object now carries `isActive`. Downstream
 *     permission functions in auth/permissions.ts consult this field
 *     via the `isUserActive` parameter.
 *   - The legacy Admin record (when present) is also loaded with its
 *     own `isActive` for backward compatibility. The effective-role
 *     resolution in permissions.ts combines both, but `User.isActive`
 *     is the authoritative gate: if the User is inactive, the user
 *     loses ALL staff permissions regardless of the Admin record.
 */

import type { NextFunction } from "grammy";
import type { BotContext } from "../types";
import { prisma } from "../database/prisma";

// Extend BotContext with the resolved user identity
declare module "../types" {
  interface AuthFlavor {
    /** The resolved User record (always set if ctx.from exists). */
    resolvedUser?: {
      id: number;
      telegramId: bigint;
      fullName: string | null;
      phone: string | null;
      schoolId: number | null;
      neighborhoodId: number | null;
      role: string;
      // Phase 4 Hardening: the authoritative active/inactive flag for
      // staff users. Defaults to true for parents/students (they're
      // never deactivated). When false, all staff permissions are
      // revoked by permissions.ts.
      isActive: boolean;
    };
    /** The resolved Admin record (set only if the user is an admin). */
    resolvedAdmin?: {
      id: number;
      telegramId: bigint;
      fullName: string | null;
      role: string;
      schoolId: number | null;
      neighborhoodId: number | null;
      isActive: boolean;
    } | null;
  }
}

export async function resolveIdentity(ctx: BotContext, next: NextFunction): Promise<void> {
  if (!ctx.from) {
    await next();
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  // Load User record (don't create — just resolve).
  // Phase 4 Hardening: explicitly select `isActive` so that permission
  // checks can consult it. Previously it was omitted, which meant a
  // deactivated staff member still passed every `hasPermission` check
  // because their role field was unchanged by deactivation.
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      id: true,
      telegramId: true,
      fullName: true,
      phone: true,
      schoolId: true,
      neighborhoodId: true,
      role: true,
      isActive: true,
    },
  });

  if (user) {
    ctx.resolvedUser = user;
  }

  // Load Admin record (if exists). This is the LEGACY admin table — it
  // coexists with User.role during the migration period. Permission
  // resolution combines both, with User.isActive as the authoritative
  // active/inactive gate.
  const admin = await prisma.admin.findUnique({
    where: { telegramId },
    select: {
      id: true,
      telegramId: true,
      fullName: true,
      role: true,
      schoolId: true,
      neighborhoodId: true,
      isActive: true,
    },
  });

  ctx.resolvedAdmin = admin || undefined;

  await next();
}
