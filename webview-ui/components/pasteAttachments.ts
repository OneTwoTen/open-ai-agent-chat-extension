import { Attachment } from "../../src/shared/protocol";

interface PastedPayload {
  name?: string;
  type?: string;
  dataUrl?: string;
  text?: string;
  index?: number;
  now?: number;
}

export function attachmentFromPastedPayload(payload: PastedPayload): Attachment {
  const mimeType = payload.type || mimeTypeFromName(payload.name) || "application/octet-stream";
  const path = payload.name?.trim() || pastedName(mimeType, payload.index ?? 0, payload.now);

  if (mimeType.startsWith("image/")) {
    if (!payload.dataUrl) {
      throw new Error("Image paste payload is missing data URL.");
    }
    return {
      path,
      content: `[Image: ${path}]`,
      imageUrl: payload.dataUrl,
      mimeType,
    };
  }

  if (mimeType.startsWith("text/") && payload.text !== undefined) {
    return {
      path,
      content: payload.text.length > 40_000 ? payload.text.slice(0, 40_000) + "\n[...truncated]" : payload.text,
      mimeType,
    };
  }

  if (!payload.dataUrl) {
    throw new Error("Pasted file payload is missing data URL.");
  }
  return {
    path,
    content: `[File: ${path}]`,
    dataBase64: dataUrlToBase64(payload.dataUrl),
    mimeType,
  };
}

export async function attachmentFromClipboardFile(
  file: File,
  index: number,
  now = Date.now()
): Promise<Attachment> {
  const base = {
    name: file.name,
    type: file.type,
    index,
    now,
  };
  if (file.type.startsWith("text/")) {
    return attachmentFromPastedPayload({ ...base, text: await readFileAsText(file) });
  }
  return attachmentFromPastedPayload({ ...base, dataUrl: await readFileAsDataUrl(file) });
}

export function pastedName(mimeType: string, index: number, now = Date.now()): string {
  return `pasted-${now}-${index + 1}.${extensionForMimeType(mimeType)}`;
}

function dataUrlToBase64(dataUrl: string): string {
  const marker = ";base64,";
  const idx = dataUrl.indexOf(marker);
  return idx >= 0 ? dataUrl.slice(idx + marker.length) : dataUrl;
}

function extensionForMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
  };
  return map[mimeType] ?? "bin";
}

function mimeTypeFromName(name?: string): string | undefined {
  const ext = name?.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
  };
  return ext ? map[ext] : undefined;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read pasted file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read pasted text file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}
