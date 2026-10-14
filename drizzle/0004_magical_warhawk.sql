ALTER TABLE `quizzes` ADD `owner_username` text DEFAULT 'ming' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `owner_username` text DEFAULT 'ming' NOT NULL;