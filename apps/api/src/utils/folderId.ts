const FOLDER_PATTERNS = [/\/folders\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/];

export function extractDriveFolderId(input: string): string {
  for (const pattern of FOLDER_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  const fallback = input.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(fallback)) {
    return fallback;
  }

  throw new Error("Unable to extract Google Drive folder ID from input");
}
