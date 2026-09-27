ALTER TABLE "attendance_record_values"
ADD COLUMN "validation_issues" JSONB NOT NULL DEFAULT '[]';
