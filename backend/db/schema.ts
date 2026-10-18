import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const documents = sqliteTable("quiz_documents", {
 key: text("key").primaryKey(), version: integer("version").notNull(), data: text("data").notNull(), updatedAt: text("updated_at").notNull()
});
export const events = sqliteTable("quiz_events", {
 key: text("key").primaryKey(), gameId: text("game_id").notNull(), kind: text("kind").notNull(), payload: text("payload").notNull(), createdAt: text("created_at").notNull()
}, table => [index("quiz_events_game").on(table.gameId)]);
