import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // dist/index.cjs serves dist/public; fall back to <cwd>/dist/public.
  const candidates = [
    typeof __dirname !== "undefined" ? path.resolve(__dirname, "public") : "",
    path.resolve(process.cwd(), "dist", "public"),
  ].filter(Boolean);
  const distPath = candidates.find((dir) => fs.existsSync(path.join(dir, "index.html")));

  if (!distPath) {
    throw new Error(
      `Could not find the build directory (${candidates.join(" or ")}). Run "npm run build" first.`,
    );
  }

  // Build assets have a content hash in their names: cache them "forever".
  app.use("/assets", express.static(path.join(distPath, "assets"), { immutable: true, maxAge: "1y" }));
  // A missing chunk (e.g. an old tab after a new deploy) must be a 404, not index.html.
  app.use("/assets", (_req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });
  app.use(express.static(distPath, { index: false, maxAge: "1h" }));

  // SPA fallback: index.html must always be revalidated so new deploys show up.
  app.use("*", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
