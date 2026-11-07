import { createClerkClient, type User } from "@clerk/backend";
import { db, eq } from "@repo/database";
import { usersTable } from "@repo/database/schema";
import type { UserPublic } from "./model";

export class IdentityAccessError extends Error {
  constructor(
    public readonly reason: "ACCOUNT_LINK_REQUIRED" | "ACCOUNT_DISABLED" | "EMAIL_REQUIRED",
  ) {
    super(reason);
  }
}

export type ClerkProfile = Pick<
  User,
  | "id"
  | "externalId"
  | "primaryEmailAddressId"
  | "emailAddresses"
  | "firstName"
  | "lastName"
  | "imageUrl"
  | "banned"
  | "locked"
>;

// Do not select legacy password hashes for authenticated application requests.
const localIdentity = {
  id: usersTable.id,
  clerkUserId: usersTable.clerkUserId,
  fullName: usersTable.fullName,
  email: usersTable.email,
  role: usersTable.role,
  profileImageUrl: usersTable.profileImageUrl,
  deletedAt: usersTable.deletedAt,
};

function publicUser(user: UserPublic & { deletedAt: Date | null }): UserPublic {
  if (user.deletedAt) throw new IdentityAccessError("ACCOUNT_DISABLED");
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    profileImageUrl: user.profileImageUrl,
  };
}

export class ClerkIdentityService {
  constructor(
    private readonly fetchProfile: (userId: string) => Promise<ClerkProfile> = (userId) =>
      createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }).users.getUser(userId),
  ) {}

  async resolveUser(clerkUserId: string): Promise<UserPublic> {
    const [existing] = await db
      .select(localIdentity)
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (existing) return publicUser(existing);

    const profile = await this.fetchProfile(clerkUserId);
    if (profile.id !== clerkUserId || profile.banned || profile.locked)
      throw new IdentityAccessError("ACCOUNT_DISABLED");
    // Imports finish the reviewed mapping step; never auto-link an account by email.
    if (profile.externalId) throw new IdentityAccessError("ACCOUNT_LINK_REQUIRED");
    const email = profile.emailAddresses.find(
      (entry) => entry.id === profile.primaryEmailAddressId,
    );
    const address = email?.emailAddress.trim().toLowerCase();
    if (!address || address.length > 255) throw new IdentityAccessError("EMAIL_REQUIRED");
    const fullName =
      [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
      address.split("@")[0] ||
      "Member";
    const [created] = await db
      .insert(usersTable)
      .values({
        clerkUserId,
        email: address,
        fullName: fullName.slice(0, 80),
        emailVerified: email?.verification?.status === "verified",
        profileImageUrl: profile.imageUrl || null,
        role: "CREATOR",
      })
      .onConflictDoNothing()
      .returning(localIdentity);
    if (created) return publicUser(created);
    const [winner] = await db
      .select(localIdentity)
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (winner) return publicUser(winner);
    throw new IdentityAccessError("ACCOUNT_LINK_REQUIRED");
  }
}
