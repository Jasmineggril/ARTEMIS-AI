import crypto from "crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Returns true if the plain-text password matches the stored hash.
 *  Supports both legacy SHA-256 hashes and modern bcrypt hashes.
 *  When a legacy hash is matched it is transparently re-hashed with bcrypt. */
export async function verifyPassword(
  password: string,
  storedHash: string,
  userId: number,
  upgradeHash?: (userId: number, newHash: string) => Promise<void>,
): Promise<boolean> {
  // bcrypt hashes always start with $2b$ or $2a$
  if (storedHash.startsWith("$2")) {
    return bcrypt.compare(password, storedHash);
  }

  // Legacy SHA-256 path
  const sha256 = crypto.createHash("sha256").update(password).digest("hex");
  if (sha256 !== storedHash) return false;

  // Password matched — silently upgrade to bcrypt
  const newHash = await hashPassword(password);
  if (upgradeHash) {
    try {
      await upgradeHash(userId, newHash);
    } catch {
      // Non-fatal: hash upgrade fails silently; next login will retry
    }
  }
  return true;
}
