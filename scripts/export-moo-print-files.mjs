import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const repoRoot = process.cwd();
const assetDir = path.join(repoRoot, "public/assets/outreach/moo-test-batch");
const desktopDir =
  "/Users/alexmercer/Desktop/Streetlight MOO Test Batch PDFs";
const workDir = path.join(repoRoot, "tmp/moo-print-export");
const iccDir = path.join(repoRoot, "tmp/icc");
const cmykProfile = path.join(iccDir, "GRACoL2006_Coated1v2.icc");
const cmykProfileUrl =
  "https://registry.color.org/profile-registry/profiles/GRACoL2006_Coated1v2.icc";
const srgbProfile = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";

const jobs = [
  {
    label: "business card front",
    svgName: "moo-business-card-front.svg",
    previewName: "moo-business-card-front-upload-300dpi.png",
    outputName: "moo-business-card-front-upload.pdf",
    desktopName: "Streetlight_MOO_business-card_FRONT_upload.pdf",
    background: "#111716",
    widthPt: "263.52",
    heightPt: "155.52",
    previewWidthPx: 1098,
    previewHeightPx: 648,
    exportWidthPx: 2196,
    exportHeightPx: 1296,
    exportDensity: 600,
  },
  {
    label: "business card back",
    svgName: "moo-business-card-back.svg",
    previewName: "moo-business-card-back-upload-300dpi.png",
    outputName: "moo-business-card-back-upload.pdf",
    desktopName: "Streetlight_MOO_business-card_BACK_upload.pdf",
    background: "#f7f3e5",
    widthPt: "263.52",
    heightPt: "155.52",
    previewWidthPx: 1098,
    previewHeightPx: 648,
    exportWidthPx: 2196,
    exportHeightPx: 1296,
    exportDensity: 600,
  },
  {
    label: "US Letter flyer",
    svgName: "moo-us-letter-flyer.svg",
    previewName: "moo-us-letter-flyer-upload-300dpi.png",
    outputName: "moo-us-letter-flyer-upload.pdf",
    desktopName: "Streetlight_MOO_US-letter-flyer_upload.pdf",
    background: "#f7f3e5",
    widthPt: "623.52",
    heightPt: "803.52",
    previewWidthPx: 2598,
    previewHeightPx: 3348,
    exportWidthPx: 2598,
    exportHeightPx: 3348,
    exportDensity: 300,
  },
];

function pdfString(value) {
  return Buffer.from(value, "binary");
}

function buildSingleImagePdf({ jpegBytes, widthPx, heightPx, widthPt, heightPt }) {
  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  objects.push({
    dict: `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`,
    stream: jpegBytes,
  });

  const content = Buffer.from(
    `q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ\n`,
    "binary",
  );
  objects.push({ dict: `<< /Length ${content.length} >>`, stream: content });

  const chunks = [pdfString("%PDF-1.4\n")];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(pdfString(`${index + 1} 0 obj\n`));
    const object = objects[index];
    if (typeof object === "string") {
      chunks.push(pdfString(`${object}\nendobj\n`));
    } else {
      chunks.push(pdfString(`${object.dict}\nstream\n`), object.stream);
      chunks.push(pdfString("\nendstream\nendobj\n"));
    }
  }

  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(pdfString(`xref\n0 ${objects.length + 1}\n`));
  chunks.push(pdfString("0000000000 65535 f \n"));
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(
      pdfString(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`),
    );
  }
  chunks.push(
    pdfString(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

async function downloadFile(url, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await new Promise((resolve, reject) => {
    const file = [];
    https
      .get(url, (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          downloadFile(response.headers.location, destination)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }
        response.on("data", (chunk) => file.push(chunk));
        response.on("end", async () => {
          await fs.writeFile(destination, Buffer.concat(file));
          resolve();
        });
      })
      .on("error", reject);
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

async function ensureToolsAndProfiles() {
  run("gs", ["--version"]);
  run("pdfimages", ["-v"]);

  if (!existsSync(cmykProfile)) {
    console.log(`Downloading ${path.basename(cmykProfile)}...`);
    await downloadFile(cmykProfileUrl, cmykProfile);
  }
}

async function exportJob(job) {
  const svgPath = path.join(assetDir, job.svgName);
  const previewPng = path.join(assetDir, job.previewName);
  const rgbPdf = path.join(workDir, job.outputName.replace(".pdf", "-rgb.pdf"));
  const cmykPdf = path.join(assetDir, job.outputName);
  const desktopPdf = path.join(desktopDir, job.desktopName);

  await sharp(svgPath, { density: 300, limitInputPixels: false })
    .resize(job.previewWidthPx, job.previewHeightPx)
    .png()
    .toFile(previewPng);

  const jpeg = await sharp(svgPath, {
    density: job.exportDensity,
    limitInputPixels: false,
  })
    .resize(job.exportWidthPx, job.exportHeightPx)
    .flatten({ background: job.background })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();

  await fs.writeFile(
    rgbPdf,
    buildSingleImagePdf({
      jpegBytes: jpeg,
      widthPx: job.exportWidthPx,
      heightPx: job.exportHeightPx,
      widthPt: job.widthPt,
      heightPt: job.heightPt,
    }),
  );

  run("gs", [
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.4",
    "-sProcessColorModel=DeviceCMYK",
    "-sColorConversionStrategy=CMYK",
    "-sColorConversionStrategyForImages=CMYK",
    `-sDefaultRGBProfile=${srgbProfile}`,
    `-sDefaultCMYKProfile=${cmykProfile}`,
    "-dOverrideICC=false",
    "-dAutoRotatePages=/None",
    "-dDownsampleColorImages=false",
    "-dDownsampleGrayImages=false",
    "-dDownsampleMonoImages=false",
    `-sOutputFile=${cmykPdf}`,
    rgbPdf,
  ]);

  await fs.copyFile(cmykPdf, desktopPdf);

  const imageInfo = run("pdfimages", ["-list", cmykPdf]);
  if (!imageInfo.includes(" cmyk ")) {
    throw new Error(`${cmykPdf} did not verify as CMYK via pdfimages.`);
  }

  console.log(`Exported ${job.label}:`);
  console.log(`- ${cmykPdf}`);
  console.log(`- ${desktopPdf}`);
}

await ensureToolsAndProfiles();
await fs.mkdir(desktopDir, { recursive: true });
await fs.mkdir(workDir, { recursive: true });

for (const job of jobs) {
  await exportJob(job);
}
