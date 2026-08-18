CREATE INDEX `idx_vch_source_local` ON `vehicle_charge_history` (`source`,`start_time_local`);
--> statement-breakpoint
CREATE INDEX `idx_aech_source_local` ON `aggregate_ev_charge_history` (`source`,`start_time_local`);
--> statement-breakpoint
CREATE INDEX `idx_aech_source_utc` ON `aggregate_ev_charge_history` (`source`,`start_time_utc`);
