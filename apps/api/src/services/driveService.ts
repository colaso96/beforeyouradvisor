import { drive } from "@googleapis/drive";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
};

const SUPPORTED_MIME = new Set(["text/csv", "application/pdf"]);

export async function listSupportedFiles(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const client = drive({ version: "v3", headers: { Authorization: `Bearer ${accessToken}` } });
  const result = await client.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  const files = result.data.files ?? [];
  return files
    .filter((file): file is { id: string; name: string; mimeType: string } =>
      Boolean(file.id && file.name && file.mimeType && SUPPORTED_MIME.has(file.mimeType)),
    )
    .map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType }));
}

export async function downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
  const client = drive({ version: "v3", headers: { Authorization: `Bearer ${accessToken}` } });
  const res = await client.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}
