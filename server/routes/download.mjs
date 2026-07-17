import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { buildSafeWorkspacePath } from "../isolation.mjs";

export async function handleDownload(req, res, { WORKDIR, extractSessionId }) {
  try {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing sessionId" }));
      return;
    }

    const searchParams = new URL(req.url, "http://localhost").searchParams;
    let targetPath = searchParams.get("path") || "";

    targetPath = targetPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (targetPath.includes("..")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid path" }));
      return;
    }

    const workspaceDir = buildSafeWorkspacePath(sessionId, WORKDIR);
    const fullPath = path.join(workspaceDir, targetPath);

    if (!fullPath.startsWith(workspaceDir)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Path traversal attempt" }));
      return;
    }

    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch (e) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File or directory not found" }));
      return;
    }

    if (stats.isDirectory()) {
      // It's a directory, zip it
      const zip = new AdmZip();
      
      const addDirectoryToZip = (dirPath, zipPath) => {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
          const itemPath = path.join(dirPath, item);
          const itemZipPath = zipPath ? `${zipPath}/${item}` : item;
          const itemStats = fs.statSync(itemPath);
          if (itemStats.isDirectory()) {
            addDirectoryToZip(itemPath, itemZipPath);
          } else {
            const content = fs.readFileSync(itemPath);
            zip.addFile(itemZipPath, content);
          }
        }
      };

      addDirectoryToZip(fullPath, "");

      const zipBuffer = zip.toBuffer();
      const folderName = path.basename(fullPath) || "workspace";
      
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${folderName}.zip"`,
        "Content-Length": zipBuffer.length
      });
      res.end(zipBuffer);
    } else {
      // It's a file
      const fileName = path.basename(fullPath);
      const content = fs.readFileSync(fullPath);
      
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": content.length
      });
      res.end(content);
    }
  } catch (e) {
    console.error("[Download] Error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}
