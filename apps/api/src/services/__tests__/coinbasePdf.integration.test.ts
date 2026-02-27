import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCoinbasePdf, type RawRecord } from "../adapters.js";
import { extractCoinbaseRowsFromPdf } from "../coinbasePdfService.js";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_PATH = join(THIS_DIR, "coinbase.statement.pdf");
const FIXTURE_PATH = process.env.COINBASE_PDF_FIXTURE ?? DEFAULT_FIXTURE_PATH;
const HAS_FIXTURE = existsSync(FIXTURE_PATH);

describe("coinbase PDF integration", () => {
  const integrationTest = HAS_FIXTURE ? it : it.skip;

  integrationTest("parses a real Coinbase PDF fixture from disk", async () => {
    const pdfBuffer = await readFile(FIXTURE_PATH);
    const extractedRows = await extractCoinbaseRowsFromPdf(pdfBuffer);
    const normalizedRows = normalizeCoinbasePdf("integration-test-user", extractedRows as RawRecord[]);

    console.info(`[coinbase-pdf-integration] fixture=${FIXTURE_PATH}`);
    console.info(`[coinbase-pdf-integration] extracted=${extractedRows.length}, normalized=${normalizedRows.length}`);
    console.table(extractedRows.slice(0, 25));
    console.table(normalizedRows.slice(0, 25));

    expect(extractedRows.length).toBe(48);
    expect(normalizedRows.length).toBe(48);
  }, 30_000);
});

