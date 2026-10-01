import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, eq, and, gt, isNull } from "@repo/database";
import { sessionsTable, usersTable } from "@repo/database/schema";
import type { SignInInput, SignUpInput, UserPublic } from "./model";

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function toUserPublic(user: typeof usersTable.$inferSelect): UserPublic {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    profileImageUrl: user.profileImageUrl ?? null,
  };
}

class AuthService {
  async signUp(input: SignUpInput): Promise<UserPublic> {
    const passwordHash = await bcrypt.hash(input.password, 12);

    const created = await db
      .insert(usersTable)
      .values({
        fullName: input.fullName,
        email: input.email.toLowerCase(),
        passwordHash,
      })
      .returning();

    return toUserPublic(created[0]!);
  }

  async signIn(input: SignInInput): Promise<UserPublic> {
    const email = input.email.toLowerCase();
    const found = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    const user = found[0];
    if (!user?.passwordHash) throw new Error("Invalid credentials");

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new Error("Invalid credentials");

    const updated = await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .returning();

    return toUserPublic(updated[0]!);
  }

  async createSession(params: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
    expiresInDays?: number;
  }): Promise<{ token: string; expiresAt: Date }> {
    const expiresInDays = params.expiresInDays ?? 30;
    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    await db.insert(sessionsTable).values({
      userId: params.userId,
      tokenHash,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      expiresAt,
    });

    return { token, expiresAt };
  }

  async getSessionByToken(token: string): Promise<{ user: UserPublic } | null> {
    const tokenHash = sha256Hex(token);
    const rows = await db
      .select({
        sessionId: sessionsTable.id,
        user: usersTable,
      })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
      .where(
        and(
          eq(sessionsTable.tokenHash, tokenHash),
          gt(sessionsTable.expiresAt, new Date()),
          isNull(sessionsTable.revokedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return { user: toUserPublic(row.user) };
  }

  async revokeSession(token: string): Promise<void> {
    const tokenHash = sha256Hex(token);
    await db
      .update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(sessionsTable.tokenHash, tokenHash));
  }
}

export default AuthService;

