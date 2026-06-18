import { describe, expect, it } from "vitest";
import { attachmentPreviewKind, attachmentShortName } from "../webview-ui/components/attachmentPreview";

describe("attachment previews", () => {
  it("marks image attachments as thumbnail previews", () => {
    expect(
      attachmentPreviewKind({
        path: "screenshots/pasted.png",
        content: "[Image: pasted.png]",
        imageUrl: "data:image/png;base64,AAAA",
        mimeType: "image/png",
      })
    ).toBe("image");
  });

  it("keeps non-image attachments as file chips", () => {
    expect(
      attachmentPreviewKind({
        path: "docs/spec.pdf",
        content: "[File: spec.pdf]",
        dataBase64: "AAAA",
        mimeType: "application/pdf",
      })
    ).toBe("file");
  });

  it("uses the basename as the preview label", () => {
    expect(attachmentShortName("docs/spec.pdf")).toBe("spec.pdf");
  });
});
