import { Attachment } from "../../src/shared/protocol";

export type AttachmentPreviewKind = "image" | "file";

export function attachmentPreviewKind(attachment: Attachment): AttachmentPreviewKind {
  return attachment.imageUrl && attachment.mimeType?.startsWith("image/") ? "image" : "file";
}

export function attachmentShortName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}
