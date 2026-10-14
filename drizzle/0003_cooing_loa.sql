ALTER TABLE `room_questions` ADD `category` text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_questions` ADD `used_at` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `current_category` text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `current_eligible_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `selection_mode` text DEFAULT 'random' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `last_survivor_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `room_questions` SET `category` = 'tiebreaker' WHERE `is_tiebreaker` = 1;--> statement-breakpoint
UPDATE `room_questions`
SET `used_at` = `created_at`
WHERE exists (
  SELECT 1 FROM `rooms`
  WHERE `rooms`.`code` = `room_questions`.`room_code`
    AND `rooms`.`current_position` IS NOT NULL
    AND `room_questions`.`position` <= `rooms`.`current_position`
);--> statement-breakpoint
UPDATE `rooms`
SET `current_eligible_json` = (
  SELECT coalesce(json_group_array(`participants`.`id`), '[]')
  FROM `participants`
  WHERE `participants`.`room_code` = `rooms`.`code`
    AND `participants`.`status` = 'active'
)
WHERE `rooms`.`status` IN ('question', 'closed')
  AND `rooms`.`current_eligible_json` = '[]';--> statement-breakpoint
UPDATE `rooms`
SET `last_survivor_ids_json` = (
  SELECT coalesce(json_group_array(`participants`.`id`), '[]')
  FROM `participants`
  WHERE `participants`.`room_code` = `rooms`.`code`
    AND `participants`.`status` = 'active'
)
WHERE `rooms`.`status` IN ('question', 'closed', 'revealed')
  AND `rooms`.`last_survivor_ids_json` = '[]'
  AND exists (
    SELECT 1 FROM `participants`
    WHERE `participants`.`room_code` = `rooms`.`code`
      AND `participants`.`status` = 'active'
  );--> statement-breakpoint
UPDATE `rooms`
SET `last_survivor_ids_json` = (
  SELECT coalesce(json_group_array(`participants`.`id`), '[]')
  FROM `participants`
  WHERE `participants`.`room_code` = `rooms`.`code`
    AND `participants`.`eliminated_round` = `rooms`.`round_number`
)
WHERE `rooms`.`status` = 'revealed'
  AND `rooms`.`last_survivor_ids_json` = '[]'
  AND NOT exists (
    SELECT 1 FROM `participants`
    WHERE `participants`.`room_code` = `rooms`.`code`
      AND `participants`.`status` = 'active'
  );
