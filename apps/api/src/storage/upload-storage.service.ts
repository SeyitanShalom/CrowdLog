import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

type UploadFile = {
  mimetype: string;
  buffer: Buffer;
};

const UPLOAD_URL_PREFIX = "/uploads/";
const DEFAULT_STORAGE_BUCKET = "attendance-uploads";
const TEMP_UPLOAD_DIRECTORY = resolve(tmpdir(), "crowdlog-uploads");

@Injectable()
export class UploadStorageService {
  private client: SupabaseClient | undefined;

  async uploadFile(objectKey: string, file: UploadFile) {
    this.ensureSafeObjectKey(objectKey);

    const { error } = await this.supabase()
      .storage
      .from(this.bucketName())
      .upload(objectKey, file.buffer, {
        contentType: file.mimetype || "application/octet-stream",
        upsert: false,
      });

    if (error) {
      throw new ServiceUnavailableException(
        `Could not save uploaded file to Supabase Storage: ${error.message}`,
      );
    }

    return this.fileUrlForObjectKey(objectKey);
  }

  async downloadFile(fileUrl: string) {
    const objectKey = this.objectKeyFromFileUrl(fileUrl);

    if (!objectKey) {
      throw new NotFoundException("Uploaded file not found.");
    }

    const { data, error } = await this.supabase()
      .storage
      .from(this.bucketName())
      .download(objectKey);

    if (error || !data) {
      throw new NotFoundException("Uploaded file not found.");
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async downloadToTempFile(fileUrl: string) {
    const objectKey = this.objectKeyFromFileUrl(fileUrl);

    if (!objectKey) {
      return undefined;
    }

    const content = await this.downloadFile(fileUrl);
    await mkdir(TEMP_UPLOAD_DIRECTORY, { recursive: true });

    const filePath = join(
      TEMP_UPLOAD_DIRECTORY,
      `${Date.now()}-${randomUUID()}-${objectKey}`,
    );

    await writeFile(filePath, content);

    return filePath;
  }

  async cleanupTempFile(filePath: string | undefined) {
    if (!filePath) {
      return;
    }

    await rm(filePath, { force: true }).catch(() => {
      // Temp-file cleanup should not hide the extraction result or error.
    });
  }

  async deleteFile(fileUrl: string) {
    const objectKey = this.objectKeyFromFileUrl(fileUrl);

    if (!objectKey) {
      return;
    }

    const { error } = await this.supabase()
      .storage
      .from(this.bucketName())
      .remove([objectKey]);

    if (error) {
      throw new ServiceUnavailableException(
        `Could not delete uploaded file from Supabase Storage: ${error.message}`,
      );
    }
  }

  fileUrlForObjectKey(objectKey: string) {
    this.ensureSafeObjectKey(objectKey);

    return `${UPLOAD_URL_PREFIX}${objectKey}`;
  }

  objectKeyFromFileUrl(fileUrl: string) {
    if (!fileUrl.startsWith(UPLOAD_URL_PREFIX)) {
      return undefined;
    }

    const objectKey = fileUrl.slice(UPLOAD_URL_PREFIX.length);

    if (!objectKey || objectKey !== basename(objectKey)) {
      return undefined;
    }

    return objectKey;
  }

  private supabase() {
    if (this.client) {
      return this.client;
    }

    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      process.env.SUPABASE_STORAGE_SERVICE_ROLE_KEY?.trim();

    if (!supabaseUrl || !serviceRoleKey) {
      throw new ServiceUnavailableException(
        "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      );
    }

    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    return this.client;
  }

  private bucketName() {
    return (
      process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_STORAGE_BUCKET
    );
  }

  private ensureSafeObjectKey(objectKey: string) {
    if (!objectKey || objectKey !== basename(objectKey)) {
      throw new ServiceUnavailableException("Invalid upload object key.");
    }
  }
}
