import { randomUUID } from "node:crypto";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const newId = () => randomUUID();
const now = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  username: text("username").notNull(),
  normalizedUsername: text("normalized_username").notNull().unique(),
  createdAt: now("created_at").notNull().defaultNow(),
});

export const passwordCredentials = pgTable("password_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  updatedAt: now("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    idleExpiresAt: now("idle_expires_at").notNull(),
    absoluteExpiresAt: now("absolute_expires_at").notNull(),
    lastSeenAt: now("last_seen_at").notNull(),
    revokedAt: now("revoked_at"),
    createdAt: now("created_at").notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_revoked_at_idx").on(table.userId, table.revokedAt)],
);

export const authRateLimits = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  action: text("action").notNull(),
  windowStartedAt: now("window_started_at").notNull(),
  attemptCount: integer("attempt_count").notNull(),
  blockedUntil: now("blocked_until"),
  updatedAt: now("updated_at").notNull().defaultNow(),
});
