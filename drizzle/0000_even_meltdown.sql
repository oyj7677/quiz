CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`participant_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`position` integer NOT NULL,
	`answer_json` text NOT NULL,
	`is_correct` integer,
	`submitted_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answers_room_round_participant_idx` ON `answers` (`room_code`,`round_number`,`participant_id`);--> statement-breakpoint
CREATE INDEX `answers_room_round_idx` ON `answers` (`room_code`,`round_number`);--> statement-breakpoint
CREATE TABLE `host_auth` (
	`username` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `host_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`nickname` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`eliminated_round` integer,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_room_idx` ON `participants` (`room_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_token_hash_idx` ON `participants` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_room_nickname_idx` ON `participants` (`room_code`,`nickname`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`questions_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`position` integer NOT NULL,
	`question_json` text NOT NULL,
	`is_tiebreaker` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_questions_room_position_idx` ON `room_questions` (`room_code`,`position`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`quiz_id` text,
	`status` text NOT NULL,
	`current_position` integer,
	`round_number` integer DEFAULT 0 NOT NULL,
	`accepting_answers` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE set null
);
