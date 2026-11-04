/**
 * Bundled synthetic receipts for the demo (Section 23). Generated deterministically in code
 * so no binary fixtures or real documents are committed. All content is fictional.
 */
import { deflateSync } from "node:zlib";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A small greyscale PNG with a receipt-like pattern of "text lines". */
export function syntheticReceiptPng(width = 240, height = 360): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width, 0xf7);
    row[0] = 0; // filter: none
    const line = Math.floor(y / 14);
    const inText = y % 14 >= 4 && y % 14 <= 9 && y > 20 && y < height - 20;
    if (inText) {
      const len = 60 + ((line * 53) % 140);
      for (let x = 20; x < 20 + len && x < width - 20; x++) row[1 + x] = (x + line) % 7 === 0 ? 0xf7 : 0x30;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Minimal static PDF with fictional receipt text; no scripts, actions or embedded files. */
export function syntheticReceiptPdf(lines: string[] = ["SAMPLE RECEIPT - DEMONSTRATION ONLY", "Store Cedar (fictional)", "Clearpeak CP27Q monitor  CAD 205.00", "Shipping                 CAD   0.00", "Total before tax         CAD 205.00"]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = ["BT", "/F1 12 Tf", "50 750 Td", ...lines.flatMap((l, i) => (i === 0 ? [`(${esc(l)}) Tj`] : ["0 -18 Td", `(${esc(l)}) Tj`])), "ET"].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export function sampleReceipt(id: string): { bytes: Buffer; contentType: "image/png" | "application/pdf" } | null {
  if (id === "sample-receipt-png") return { bytes: syntheticReceiptPng(), contentType: "image/png" };
  if (id === "sample-receipt-pdf") return { bytes: syntheticReceiptPdf(), contentType: "application/pdf" };
  return null;
}
