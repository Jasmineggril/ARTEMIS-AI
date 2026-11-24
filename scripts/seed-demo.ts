/**
 * ARTEMIS AI — demonstration seed (development / presentations only).
 *
 *   DEMO_SEED_PASSWORD='algumaSenha1' DATABASE_URL=... npm run db:seed-demo
 *
 * Creates ONE organization named "[DEMONSTRAÇÃO] ..." with a demo owner and
 * demo areas whose names start with "[DEMO]". Nothing here is real data.
 * Refuses to run with NODE_ENV=production. Idempotent: re-running does nothing.
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { runMigrations } from "../server/migrate";
import { hashPassword } from "../server/auth";
import { users, organizations, organizationMembers, monitoredAreas } from "../shared/schema";

const DEMO_EMAIL = "demo@artemis.local";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed demonstrativo bloqueado em produção.");
  const password = process.env.DEMO_SEED_PASSWORD;
  if (!password || password.length < 8) throw new Error("Defina DEMO_SEED_PASSWORD (mín. 8 caracteres). Nenhuma senha padrão é usada.");

  await runMigrations();
  const [existing] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (existing) {
    console.log("[seed-demo] já existe — nada a fazer.");
    return;
  }
  await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: DEMO_EMAIL, password: await hashPassword(password), name: "Usuário Demonstração" }).returning();
    const [org] = await tx.insert(organizations).values({ name: "[DEMONSTRAÇÃO] Cooperativa Fictícia", slug: "demo-artemis", type: "produtor" }).returning();
    await tx.insert(organizationMembers).values({ organizationId: org.id, userId: u.id, role: "owner" });
    await tx.insert(monitoredAreas).values([
      { organizationId: org.id, createdBy: u.id, name: "[DEMO] Fazenda Chapada", operationType: "propriedade_rural", municipality: "Alto Paraíso de Goiás", state: "GO", latitude: -14.13, longitude: -47.51, areaHectares: 1200, vegetationCategory: "Cerrado", notes: "Área fictícia para demonstração." },
      { organizationId: org.id, createdBy: u.id, name: "[DEMO] Unidade Florestal Norte", operationType: "florestal", municipality: "Niquelândia", state: "GO", latitude: -14.47, longitude: -48.46, areaHectares: 850, vegetationCategory: "Eucalipto", notes: "Área fictícia para demonstração." },
    ]);
  });
  console.log(`[seed-demo] criado: ${DEMO_EMAIL} (senha definida em DEMO_SEED_PASSWORD).`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => pool?.end());
