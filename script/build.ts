import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // Operational CLIs shipped in the production image (no tsx at runtime).
  for (const [entry, out] of [["scripts/db/migrate.ts", "dist/migrate.cjs"], ["scripts/sync-inpe.ts", "dist/sync-inpe.cjs"], ["scripts/sync-sisfogo.ts", "dist/sync-sisfogo.cjs"], ["scripts/ops/create-admin.ts", "dist/create-admin.cjs"], ["scripts/load-ibge-municipalities.ts", "dist/load-municipalities.cjs"], ["scripts/load-ibge-boundaries.ts", "dist/load-boundaries.cjs"], ["scripts/sync-inmet.ts", "dist/sync-inmet.cjs"], ["scripts/sync-inpe-risk.ts", "dist/sync-inpe-risk.cjs"]]) {
    await esbuild({
      entryPoints: [entry], platform: "node", bundle: true, format: "cjs", outfile: out,
      define: { "process.env.NODE_ENV": '"production"' }, minify: true, external: externals, logLevel: "warning",
    });
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
