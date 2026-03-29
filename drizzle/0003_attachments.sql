CREATE TABLE `task_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	`filename` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` integer NOT NULL REFERENCES `users`(`id`),
	`created_at` text NOT NULL
);