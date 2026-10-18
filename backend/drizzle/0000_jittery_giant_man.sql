CREATE TABLE `quiz_documents` (
	`key` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quiz_events` (
	`key` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quiz_events_game` ON `quiz_events` (`game_id`);