-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "template_field_type" AS ENUM ('text', 'email', 'phone', 'number', 'signature', 'date', 'select');

-- CreateEnum
CREATE TYPE "attendance_document_status" AS ENUM ('uploaded', 'processing', 'extracted', 'reviewed', 'approved', 'failed');

-- CreateEnum
CREATE TYPE "attendance_record_status" AS ENUM ('draft', 'needs_review', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "event_date" TIMESTAMP(3),
    "owner_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_templates" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_fields" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "template_field_type" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "options" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_documents" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT,
    "file_url" TEXT NOT NULL,
    "status" "attendance_document_status" NOT NULL DEFAULT 'uploaded',
    "raw_ocr_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "document_id" TEXT,
    "row_number" INTEGER,
    "data_json" JSONB NOT NULL DEFAULT '{}',
    "confidence_score" DOUBLE PRECISION,
    "status" "attendance_record_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_record_values" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "raw_value" TEXT,
    "normalized_value" TEXT,
    "confidence" DOUBLE PRECISION,
    "bounding_box" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_record_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "events_owner_id_idx" ON "events"("owner_id");

-- CreateIndex
CREATE INDEX "attendance_templates_event_id_idx" ON "attendance_templates"("event_id");

-- CreateIndex
CREATE INDEX "template_fields_template_id_idx" ON "template_fields"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_fields_template_id_key_key" ON "template_fields"("template_id", "key");

-- CreateIndex
CREATE INDEX "attendance_documents_event_id_idx" ON "attendance_documents"("event_id");

-- CreateIndex
CREATE INDEX "attendance_records_event_id_idx" ON "attendance_records"("event_id");

-- CreateIndex
CREATE INDEX "attendance_records_document_id_idx" ON "attendance_records"("document_id");

-- CreateIndex
CREATE INDEX "attendance_record_values_field_id_idx" ON "attendance_record_values"("field_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_record_values_record_id_field_id_key" ON "attendance_record_values"("record_id", "field_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_templates" ADD CONSTRAINT "attendance_templates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "attendance_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_documents" ADD CONSTRAINT "attendance_documents_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "attendance_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record_values" ADD CONSTRAINT "attendance_record_values_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record_values" ADD CONSTRAINT "attendance_record_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "template_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
