import { hash, verify } from '@node-rs/argon2';
import type { ServerConfig } from '../config.ts';

export async function hashPassword(password: string, config: ServerConfig): Promise<string> {
  return hash(password, {
    memoryCost: config.argon2.memoryCost,
    timeCost: config.argon2.timeCost,
    parallelism: config.argon2.parallelism,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
