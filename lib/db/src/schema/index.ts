import { pgTable, text, integer, numeric, timestamp, boolean, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  userType: text("user_type").notNull(),
  wilaya: text("wilaya").notNull().default(""),
  commune: text("commune").notNull().default(""),
  accountStatus: text("account_status").notNull().default("pending"),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  freeTrialClaimed: boolean("free_trial_claimed").notNull().default(false),
  firstApprovalGranted: boolean("first_approval_granted").notNull().default(false),
  createdAt: timestamp("created_at"),
});

export const driverStatusTable = pgTable("driver_status", {
  driverId: text("driver_id").primaryKey(),
  currentStatus: text("current_status").notNull().default("مغلق"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const driverDetailsTable = pgTable("driver_details", {
  driverId: text("driver_id").primaryKey(),
  wilaya: text("wilaya").notNull().default(""),
  commune: text("commune").notNull().default(""),
  truckFrontPhotoUrl: text("truck_front_photo_url"),
  driverLicenseUrl: text("driver_license_url"),
  truckVideoUrl: text("truck_video_url"),
  truckSidePhotoUrl: text("truck_side_photo_url"),
  isLegacyDriver: boolean("is_legacy_driver").notNull().default(false),
  trialGrantedAt: timestamp("trial_granted_at"),
});

export const ordersTable = pgTable("orders", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  driverId: text("driver_id"),
  waterVolume: text("water_volume").notNull(),
  barrelCount: integer("barrel_count").notNull().default(0),
  totalPrice: numeric("total_price").notNull(),
  latitude: text("latitude"),
  longitude: text("longitude"),
  status: text("status").notNull().default("معلق"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const subscriptionPaymentsTable = pgTable("subscription_payments", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: text("driver_id").notNull(),
  receiptImage: text("receipt_image").notNull(),
  months: integer("months").notNull().default(1),
  status: text("status").notNull().default("pending"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  reviewedAt: timestamp("reviewed_at"),
});

export const ratingsTable = pgTable("ratings", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: text("order_id").notNull(),
  raterUserId: text("rater_user_id").notNull(),
  ratedUserId: text("rated_user_id").notNull(),
  raterType: text("rater_type").notNull(),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  disputeReason: text("dispute_reason"),
  isDisputed: boolean("is_disputed").notNull().default(false),
  disputeCount: integer("dispute_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const savedLocationsTable = pgTable("saved_locations", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  label: text("label").notNull(),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const announcementsTable = pgTable("announcements", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  targetAudience: text("target_audience").notNull().default("all"),
  badgeText: text("badge_text"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const announcementReadsTable = pgTable("announcement_reads", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  announcementId: text("announcement_id").notNull(),
  userId: text("user_id").notNull(),
  userType: text("user_type").notNull(),
  readAt: timestamp("read_at").notNull().default(sql`now()`),
});

export const supportMessagesTable = pgTable("support_messages", {
  id:          text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:      text("user_id"),
  message:     text("message").notNull(),
  senderType:  text("sender_type").notNull().default("user"),
  adminId:     text("admin_id"),
  status:      text("status").notNull().default("pending"),
  createdAt:   timestamp("created_at").notNull().default(sql`now()`),
});

export const userDevicesTable = pgTable("user_devices", {
  id:          text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:      text("user_id").notNull(),
  deviceId:    text("device_id").notNull(),
  deviceLabel: text("device_label").notNull().default(""),
  firstSeenAt: timestamp("first_seen_at").notNull().default(sql`now()`),
  lastSeenAt:  timestamp("last_seen_at").notNull().default(sql`now()`),
});

/**
 * user_appeals — formerly driver-only but now used for both drivers ("rejected")
 * and any user type ("banned").
 *
 * Table/column names kept as driver_appeals / driver_id to avoid a risky
 * rename migration while data exists.  The driver_id column stores any user's
 * id — not exclusively drivers.
 *
 * reason: "rejected" | "banned" — set at submission time so the admin panel
 * can distinguish document-rejection appeals from ban appeals.
 */
export const driverAppealsTable = pgTable("driver_appeals", {
  id:            text("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId:      text("driver_id").notNull(), // stores any user's id (driver or consumer)
  message:       text("message").notNull(),
  status:        text("status").notNull().default("pending"),
  adminResponse: text("admin_response"),
  createdAt:     timestamp("created_at").notNull().default(sql`now()`),
  reviewedAt:    timestamp("reviewed_at"),
  reason:        text("reason"),              // "rejected" | "banned" — nullable for legacy rows
});

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  subscription: jsonb("subscription").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

/**
 * One row per driver — always their most recent GPS position.
 * Upserted by the driver frontend every 5 s while actively delivering.
 * Read by the consumer frontend via Supabase Realtime postgres_changes.
 */
export const driverLocationsTable = pgTable("driver_locations", {
  driverId: text("driver_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
