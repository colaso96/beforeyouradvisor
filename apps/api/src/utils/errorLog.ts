export function errorToLogString(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  try {
    const json = JSON.stringify(error);
    if (json) return json;
  } catch {
    // Ignore JSON serialization failures and fall through.
  }

  try {
    return String(error);
  } catch {
    return "[unserializable error]";
  }
}
