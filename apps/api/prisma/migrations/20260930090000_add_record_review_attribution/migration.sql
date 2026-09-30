ALTER TABLE "attendance_records"
ADD COLUMN "reviewed_by_user_id" TEXT,
ADD COLUMN "reviewed_at" TIMESTAMP(3);

CREATE INDEX "attendance_records_reviewed_by_user_id_idx"
ON "attendance_records"("reviewed_by_user_id");

ALTER TABLE "attendance_records"
ADD CONSTRAINT "attendance_records_reviewed_by_user_id_fkey"
FOREIGN KEY ("reviewed_by_user_id")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
