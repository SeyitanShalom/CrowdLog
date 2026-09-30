import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PDF_RENDER_DIRECTORY = resolve(process.cwd(), ".tmp", "pdf-pages");

export type RenderedPdfPage = {
  pageNumber: number;
  fileName: string;
  filePath: string;
  fileType: "image/png";
  cleanupDirectory: string;
};

export type PdfRenderResult =
  | {
      rendered: true;
      pages: RenderedPdfPage[];
    }
  | {
      rendered: false;
      reason: string;
    };

@Injectable()
export class PdfPageRenderer {
  async renderPages({
    filePath,
    fileName,
    pageStart,
    pageCount,
  }: {
    filePath: string | undefined;
    fileName: string;
    pageStart: number;
    pageCount: number;
  }): Promise<PdfRenderResult> {
    if (!filePath) {
      return {
        rendered: false,
        reason: "PDF rendering requires a local uploaded file.",
      };
    }

    const outputDirectory = join(PDF_RENDER_DIRECTORY, randomUUID());
    const outputPrefix = join(outputDirectory, "page");

    await mkdir(outputDirectory, { recursive: true });

    try {
      await execFileAsync(
        "pdftoppm",
        [
          "-png",
          "-r",
          "200",
          "-f",
          String(pageStart),
          "-l",
          String(pageStart + pageCount - 1),
          filePath,
          outputPrefix,
        ],
        {
          maxBuffer: 1024 * 1024 * 5,
          windowsHide: true,
        },
      );

      const renderedFiles = (await readdir(outputDirectory))
        .filter((name) => name.toLowerCase().endsWith(".png"))
        .sort((left, right) => this.pageNumber(left) - this.pageNumber(right));

      if (renderedFiles.length === 0) {
        await this.cleanup(outputDirectory);

        return {
          rendered: false,
          reason: "PDF renderer did not produce any page images.",
        };
      }

      const baseName = basename(fileName, extname(fileName)) || "document";

      return {
        rendered: true,
        pages: renderedFiles.map((renderedFile) => {
          const pageNumber = this.pageNumber(renderedFile);

          return {
            pageNumber,
            fileName: `${baseName}-page-${pageNumber}.png`,
            filePath: join(outputDirectory, renderedFile),
            fileType: "image/png",
            cleanupDirectory: outputDirectory,
          };
        }),
      };
    } catch (error) {
      await this.cleanup(outputDirectory);

      return {
        rendered: false,
        reason: error instanceof Error ? error.message : "PDF rendering failed.",
      };
    }
  }

  async cleanupRenderedPages(pages: RenderedPdfPage[]) {
    const directories = new Set(pages.map((page) => page.cleanupDirectory));

    await Promise.all(
      Array.from(directories).map((directory) => this.cleanup(directory)),
    );
  }

  private pageNumber(fileName: string) {
    const match = fileName.match(/-(\d+)\.png$/i);

    return match ? Number(match[1]) : 0;
  }

  private async cleanup(directory: string) {
    await rm(directory, { recursive: true, force: true }).catch(() => {
      // Temporary render cleanup is best effort.
    });
  }
}
