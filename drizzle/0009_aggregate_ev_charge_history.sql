CREATE TABLE `aggregate_ev_charge_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`start_time_utc` text NOT NULL,
	`start_time_local` text NOT NULL,
	`interval_seconds` integer NOT NULL,
	`charged_wh` real NOT NULL,
	`solar_wh` real NOT NULL,
	`battery_wh` real NOT NULL,
	`grid_wh` real NOT NULL,
	`away_wh` real NOT NULL,
	`at_home_wh` real NOT NULL,
	`imported_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_aech_source_external` ON `aggregate_ev_charge_history` (`source`,`external_id`);
--> statement-breakpoint
CREATE INDEX `idx_aech_local` ON `aggregate_ev_charge_history` (`start_time_local`);
--> statement-breakpoint
CREATE INDEX `idx_aech_utc` ON `aggregate_ev_charge_history` (`start_time_utc`);
