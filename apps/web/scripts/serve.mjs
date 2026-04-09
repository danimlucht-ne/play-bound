import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function isHtmlRequest(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("text/html") || accept.includes("application/xhtml+xml");
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = contentTypes[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(filePath).pipe(res);
}

function safePathname(urlPathname) {
  const cleanPath = decodeURIComponent(urlPathname.split("?")[0]);
  const normalized = path.normalize(cleanPath).replace(/^(\.\.(\/|\\|$))+/, "");
  return normalized === path.sep ? "index.html" : normalized.replace(/^[/\\]+/, "");
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = safePathname(url.pathname);

  if (pathname === "playbound-icon.png") {
    res.writeHead(307, { location: "/playbound_icon.svg" });
    res.end();
    return;
  }
  if (pathname === "playbound-banner.png") {
    res.writeHead(307, { location: "/playbound_banner.svg" });
    res.end();
    return;
  }

  const target = path.resolve(rootDir, pathname);
  if (!target.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    sendFile(res, target);
    return;
  }

  if (isHtmlRequest(req)) {
    sendFile(res, path.join(rootDir, "index.html"));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, host, () => {
  console.log(`PlayBound test server running at http://${host}:${port}`);
});
