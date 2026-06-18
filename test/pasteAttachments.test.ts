import { describe, expect, it } from "vitest";
import { attachmentFromPastedPayload } from "../webview-ui/components/pasteAttachments";

describe("paste attachments", () => {
  it("turns a pasted image payload into an image attachment", () => {
    expect(
      attachmentFromPastedPayload({
        type: "image/png",
        dataUrl: "data:image/png;base64,AAAA",
        index: 0,
        now: 123,
      })
    ).toEqual({
      path: "pasted-123-1.png",
      content: "[Image: pasted-123-1.png]",
      imageUrl: "data:image/png;base64,AAAA",
      mimeType: "image/png",
    });
  });

  it("turns a pasted PDF payload into a file-analysis attachment", () => {
    expect(
      attachmentFromPastedPayload({
        name: "clip.pdf",
        type: "application/pdf",
        dataUrl: "data:application/pdf;base64,BBBB",
      })
    ).toEqual({
      path: "clip.pdf",
      content: "[File: clip.pdf]",
      dataBase64: "BBBB",
      mimeType: "application/pdf",
    });
  });
});
