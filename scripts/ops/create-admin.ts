/**
 * Bootstrap (or promote) a platform administrator and print a single-use link
 * for that person to define their own password. No password is typed here,
 * printed or stored in plain text.
 *
 *   npm run admin:create -- --email pessoa@exemplo.org --name "Nome" --org "Organização" --base https://homolog.exemplo.org
 *   docker compose run --rm api node dist/create-admin.cjs --email … --name … --org … --base https://$APP_DOMAIN
 *
 * Existing user: promoted to platform_admin (memberships untouched) and gets a new link.
 * New user: account + organisation (owner) created. The link is valid for 72 h.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { users, organizations, organizationMembers, passwordResetTokens } from "@shared/schema";
import { hashPassword } from "../../server/auth";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]?.trim() : undefined;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name");
  const orgName = arg("org");
  const base = (arg("base") ?? process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email inválido.");
  if (!/^https?:\/\/[^/]+$/.test(base)) throw new Error("--base deve ser a URL pública, ex.: https://homolog.seu-dominio.com.br");

  const token = crypto.randomBytes(32).toString("base64url");
  const result = await db.transaction(async (tx) => {
    let [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    let created = false;
    if (user) {
      await tx.update(users).set({ role: "platform_admin" }).where(eq(users.id, user.id));
    } else {
      if (!name || name.length < 2) throw new Error("Usuário novo: informe --name.");
      if (!orgName || orgName.length < 2) throw new Error("Usuário novo: informe --org.");
      [user] = await tx.insert(users).values({
        email, name, firstName: name.split(" ")[0], role: "platform_admin",
        password: await hashPassword(crypto.randomBytes(32).toString("base64url")), // unusable until the link is used
      }).returning({ id: users.id });
      const slug = `${orgName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${crypto.randomBytes(3).toString("hex")}`;
      const [org] = await tx.insert(organizations).values({ name: orgName, slug, type: "outro" }).returning({ id: organizations.id });
      await tx.insert(organizationMembers).values({ organizationId: org.id, userId: user.id, role: "owner" });
      created = true;
    }
    const expiresAt = new Date(Date.now() + 72 * 3_600_000);
    await tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt });
    return { created, expiresAt };
  });
  console.log(JSON.stringify({
    email, created: result.created, platformRole: "platform_admin",
    link: `${base}/reset-password?token=${token}`,
    expiresAt: result.expiresAt.toISOString(),
    note: "Link de uso único para definir a senha. Envie apenas à própria pessoa.",
  }, null, 2));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool?.end());
