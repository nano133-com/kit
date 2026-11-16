// Serves the try-on demo on 127.0.0.1 (a private port, default 18911): builds demo.ts with esbuild (code splitting, so the viewer is a chunk of
// its own, as in a game) into a temporary folder, and serves it with the shop's stylesheet. Usage: node test/tryon-demo/serve.mjs [port]
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] ?? 18911);
const out = mkdtempSync(join(tmpdir(), "n133-tryon-demo-"));
await build({ entryPoints: [join(here, "demo.ts")], bundle: true, splitting: true, format: "esm", outdir: out, minify: false, sourcemap: false, logLevel: "warning" });
const files = { "/": join(here, "index.html"), "/style.css": join(here, "../../src/shop/panel/style.css") };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const file = files[path] ?? join(out, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(out) && !Object.values(files).includes(file)) return void res.writeHead(404).end();
  if (!existsSync(file)) return void res.writeHead(404).end("not found");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`try-on demo: http://127.0.0.1:${port}/ (pid ${process.pid})`));
