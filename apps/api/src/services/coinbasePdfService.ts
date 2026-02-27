import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type ExtractedRow = {
  Date: string;
  Description: string;
  Amount: string;
};

type Section = "none" | "payments" | "transactions";

type ParsingTx = {
  date: string;
  amount: string | null;
  descriptionParts: string[];
};

const DATE_PATTERN = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/;
const MONEY_PATTERN = /-?\$[\d,]+\.\d{2}/g;
const DESCRIPTION_CUTOFF_PATTERNS = [
  /Total new charges in this period/i,
  /Fees - Total fees charged in this period/i,
  /Interest charged - Total interest for this period/i,
  /Year-to-date summary/i,
  /Interest charge calculation/i,
  /Important disclosures/i,
  /How to make payments:/i,
  /How to avoid paying interest on purchases:/i,
  /Calculation of Balance Subject to Interest Charge:/i,
  /Your Rights If You Are Dissatisfied With Your Credit Card Purchases/i,
  /Billing Rights Summary/i,
  /What To Do If You Think You Find A Mistake On Your Statement:/i,
];

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function isFooterOrHeader(line: string): boolean {
  return (
    /Page\s+\d+\s+of\s+\d+/i.test(line) ||
    line.includes("Coinbase One Card is offered through") ||
    line === "Coinbase One Card" ||
    line.includes("@gmail.com") ||
    /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(line)
  );
}

function stripNoise(line: string): string {
  return normalizeSpace(
    line
      .replace(/Coinbase One Card/gi, "")
      .replace(/See Important Disclosures.*$/gi, "")
      .replace(/\b\w{3}\s+\d{1,2}\s+[–-]\s+\w{3}\s+\d{1,2},\s+\d{4}\b/g, "")
      .replace(/^Date\s+Description\s+Amount$/i, ""),
  );
}

function maybeStartSection(line: string): Section | null {
  if (/^Payments and credits$/i.test(line)) return "payments";
  if (/^Transactions$/i.test(line)) return "transactions";
  return null;
}

function sectionTerminated(section: Section, line: string): boolean {
  if (section === "payments" && /^Total payments and credits/i.test(line)) return true;
  if (section === "transactions" && /^Total transactions/i.test(line)) return true;
  if (
    section === "transactions" &&
    (
      /^Total new charges in this period/i.test(line) ||
      /^Fees - Total fees charged in this period/i.test(line) ||
      /^Interest charged - Total interest for this period/i.test(line) ||
      /^Year-to-date summary/i.test(line) ||
      /^Interest charge calculation/i.test(line) ||
      /^Important disclosures/i.test(line) ||
      /^How to make payments:/i.test(line) ||
      /^How to avoid paying interest on purchases:/i.test(line) ||
      /^Calculation of Balance Subject to Interest Charge:/i.test(line) ||
      /^Your Rights If You Are Dissatisfied With Your Credit Card Purchases/i.test(line) ||
      /^Billing Rights Summary/i.test(line) ||
      /^What To Do If You Think You Find A Mistake On Your Statement:/i.test(line)
    )
  ) return true;
  return false;
}

function stripDescriptionTailNoise(input: string): string {
  let cut = input.length;
  for (const pattern of DESCRIPTION_CUTOFF_PATTERNS) {
    const match = input.match(pattern);
    if (match?.index != null) {
      cut = Math.min(cut, match.index);
    }
  }
  return normalizeSpace(input.slice(0, cut));
}

function finalizeTransaction(section: Section, tx: ParsingTx | null, out: ExtractedRow[]): void {
  if (section === "payments") return;
  if (!tx?.amount) return;
  const description = stripDescriptionTailNoise(normalizeSpace(tx.descriptionParts.join(" ")));
  if (!description) return;
  if (description.length > 220) {
    console.warn(`[coinbase-pdf] Dropping suspiciously long description (${description.length} chars): ${description.slice(0, 140)}...`);
    return;
  }

  out.push({
    Date: tx.date,
    Description: description,
    Amount: tx.amount,
  });
}

export function parseCoinbaseStatementText(fullText: string): ExtractedRow[] {
  const lines = fullText
    .split("\n")
    .map((line) => normalizeSpace(line))
    .filter((line) => line.length > 0);

  const out: ExtractedRow[] = [];
  let section: Section = "none";
  let current: ParsingTx | null = null;
  let linesInSection = 0;
  let sectionSwitches = 0;

  for (const rawLine of lines) {
    const sectionStart = maybeStartSection(rawLine);
    if (sectionStart) {
      finalizeTransaction(section, current, out);
      section = sectionStart;
      current = null;
      linesInSection = 0;
      sectionSwitches += 1;
      continue;
    }

    if (section === "none") {
      continue;
    }
    linesInSection += 1;

    if (sectionTerminated(section, rawLine)) {
      finalizeTransaction(section, current, out);
      current = null;
      section = "none";
      continue;
    }

    if (isFooterOrHeader(rawLine)) {
      continue;
    }

    const line = stripNoise(rawLine);
    if (!line) {
      continue;
    }

    const dateMatch = line.match(DATE_PATTERN);
    if (dateMatch) {
      finalizeTransaction(section, current, out);

      const remainder = line.slice(dateMatch[0].length).trim();
      const moneyMatches = remainder.match(MONEY_PATTERN);
      const amount = moneyMatches?.[moneyMatches.length - 1] ?? null;
      const description = normalizeSpace(
        amount ? remainder.replace(amount, "") : remainder,
      );

      current = {
        date: dateMatch[0],
        amount,
        descriptionParts: description ? [description] : [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const moneyMatches = line.match(MONEY_PATTERN);
    if (moneyMatches?.length) {
      current.amount = moneyMatches[moneyMatches.length - 1];
      const withoutAmount = normalizeSpace(line.replace(current.amount, ""));
      if (withoutAmount) {
        current.descriptionParts.push(withoutAmount);
      }
      continue;
    }

    current.descriptionParts.push(line);
  }

  finalizeTransaction(section, current, out);
  console.info(`[coinbase-pdf] Parsed text lines=${lines.length}, sectionSwitches=${sectionSwitches}, extractedRows=${out.length}, trailingSectionLines=${linesInSection}`);
  return out;
}

export async function extractCoinbaseRowsFromPdf(pdfBuffer: Buffer): Promise<ExtractedRow[]> {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer), useWorkerFetch: false, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  console.info(`[coinbase-pdf] Reading PDF pages=${pdf.numPages}, bytes=${pdfBuffer.length}`);

  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const items = textContent.items
      .map((item) => {
        if (!("str" in item) || !("transform" in item)) {
          return null;
        }
        return {
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
        };
      })
      .filter((item): item is { str: string; x: number; y: number } => Boolean(item))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const lines: string[] = [];
    let currentY: number | null = null;
    let lineParts: string[] = [];

    for (const item of items) {
      if (currentY === null || Math.abs(item.y - currentY) <= 2.8) {
        lineParts.push(item.str);
        currentY = currentY ?? item.y;
      } else {
        lines.push(normalizeSpace(lineParts.join(" ")));
        lineParts = [item.str];
        currentY = item.y;
      }
    }

    if (lineParts.length > 0) {
      lines.push(normalizeSpace(lineParts.join(" ")));
    }

    pageTexts.push(lines.join("\n"));
  }

  const rows = parseCoinbaseStatementText(pageTexts.join("\n"));
  console.info(`[coinbase-pdf] Extracted ${rows.length} rows from PDF`);
  return rows;
}
