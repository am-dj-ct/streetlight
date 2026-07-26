import {
  maxImageAttachmentBase64Length,
  maxPdfAttachmentBase64Length,
  type ChatAttachment,
} from "./chat-types";

// Everything in this module runs on the user's device. Images are downscaled
// and re-encoded to JPEG before anything leaves the browser, which keeps
// uploads small on prepaid data plans and strips EXIF metadata (including
// GPS location). PDFs cannot be cheaply re-encoded client-side, so they are
// size-capped instead. See docs/decisions/2026-07-26-inline-file-upload-v1.md.

export type AttachmentErrorCode =
  | "processing-failed"
  | "too-large"
  | "unsupported-type";

export class AttachmentError extends Error {
  code: AttachmentErrorCode;

  constructor(code: AttachmentErrorCode) {
    super(code);
    this.name = "AttachmentError";
    this.code = code;
  }
}

const targetLongEdgePx = 2000;
const jpegQuality = 0.8;
// Raw-byte cap that keeps the base64 form under maxPdfAttachmentBase64Length.
const maxPdfRawBytes = Math.floor((maxPdfAttachmentBase64Length / 4) * 3);

type SniffedKind = "heic" | "image" | "pdf" | "unknown";

function sniffFileKind(bytes: Uint8Array): SniffedKind {
  if (bytes.length < 12) {
    return "unknown";
  }

  // %PDF
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "pdf";
  }

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image";
  }

  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image";
  }

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image";
  }

  // HEIC/HEIF family: "ftyp" at offset 4 followed by a heif brand. iOS
  // normally transcodes HEIC to JPEG at selection time because our accept
  // list excludes it; this guard catches the rare raw passthrough.
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(
      bytes[8],
      bytes[9],
      bytes[10],
      bytes[11],
    );

    if (["heic", "heix", "heim", "heis", "hevc", "mif1", "msf1"].includes(brand)) {
      return "heic";
    }
  }

  return "unknown";
}

function readBlobAsBase64(source: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new AttachmentError("processing-failed"));
    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== "string") {
        reject(new AttachmentError("processing-failed"));
        return;
      }

      const separatorIndex = result.indexOf(",");

      if (separatorIndex === -1) {
        reject(new AttachmentError("processing-failed"));
        return;
      }

      resolve(result.slice(separatorIndex + 1));
    };
    reader.readAsDataURL(source);
  });
}

async function decodeImage(
  source: Blob,
): Promise<{ close: () => void; height: number; image: CanvasImageSource; width: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(source);

      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        image: bitmap,
        width: bitmap.width,
      };
    } catch {
      // Fall through to the <img> path for browsers whose createImageBitmap
      // cannot decode this source.
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(source);
    const element = new Image();

    element.onload = () => {
      resolve({
        close: () => URL.revokeObjectURL(objectUrl),
        height: element.naturalHeight,
        image: element,
        width: element.naturalWidth,
      });
    };
    element.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new AttachmentError("processing-failed"));
    };
    element.src = objectUrl;
  });
}

function encodeCanvasAsJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new AttachmentError("processing-failed"));
        }
      },
      "image/jpeg",
      jpegQuality,
    );
  });
}

async function processImageSource(source: Blob): Promise<ChatAttachment> {
  const decoded = await decodeImage(source);

  try {
    if (decoded.width === 0 || decoded.height === 0) {
      throw new AttachmentError("processing-failed");
    }

    const scale = Math.min(
      1,
      targetLongEdgePx / Math.max(decoded.width, decoded.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));

    const context = canvas.getContext("2d");

    if (!context) {
      throw new AttachmentError("processing-failed");
    }

    // JPEG has no transparency; without this, transparent PNG screenshots
    // would re-encode onto a black background.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);

    const encoded = await encodeCanvasAsJpeg(canvas);
    const dataBase64 = await readBlobAsBase64(encoded);

    if (dataBase64.length > maxImageAttachmentBase64Length) {
      throw new AttachmentError("too-large");
    }

    return {
      dataBase64,
      mediaType: "image/jpeg",
    };
  } finally {
    decoded.close();
  }
}

async function processPdfSource(source: Blob): Promise<ChatAttachment> {
  if (source.size > maxPdfRawBytes) {
    throw new AttachmentError("too-large");
  }

  const dataBase64 = await readBlobAsBase64(source);

  if (dataBase64.length > maxPdfAttachmentBase64Length) {
    throw new AttachmentError("too-large");
  }

  return {
    dataBase64,
    mediaType: "application/pdf",
  };
}

export async function processSelectedAttachment(
  selected: Blob,
): Promise<ChatAttachment> {
  const header = new Uint8Array(
    await selected.slice(0, 16).arrayBuffer(),
  );
  const kind = sniffFileKind(header);

  if (kind === "pdf") {
    return processPdfSource(selected);
  }

  if (kind === "image") {
    return processImageSource(selected);
  }

  // Unknown headers still get one decode attempt: browsers hand over image
  // types we did not sniff (e.g. transcoded output without a clean header
  // read). HEIC is excluded — no cross-browser decoder exists.
  if (kind === "unknown" && selected.type.startsWith("image/")) {
    return processImageSource(selected);
  }

  throw new AttachmentError("unsupported-type");
}

export function makeAttachmentPreviewUrl(attachment: ChatAttachment): string {
  return `data:${attachment.mediaType};base64,${attachment.dataBase64}`;
}
