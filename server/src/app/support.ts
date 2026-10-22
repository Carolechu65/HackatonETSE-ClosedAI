import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DomainError } from "../../../src/domain/errors.ts";
import type { Db } from "../persistence/database.ts";
export { DomainError };
export const id = () => randomUUID();
export const secret = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new DomainError("INVALID_ARGUMENT", "Cuerpo o campos no válidos.");
  return value as Record<string, unknown>;
}
export function string(value: unknown, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new DomainError("INVALID_ARGUMENT", "Texto vacío o demasiado largo.");
  return value.trim();
}
export function identifier(value: unknown): string {
  const text = string(value);
  if (!/^[A-Za-z0-9_:.-]+$/.test(text))
    throw new DomainError("INVALID_ARGUMENT", "Identificador inválido.");
  return text;
}
export function member(
  db: Db,
  user: string,
  group: string,
): { role: "owner" | "member" } {
  const row = db
    .prepare(
      "SELECT role FROM memberships WHERE group_id=? AND user_id=? AND active=1",
    )
    .get(group, user) as { role: "owner" | "member" } | undefined;
  if (!row) throw new DomainError("FORBIDDEN", "No perteneces a este piso.");
  return row;
}
export function event(
  db: Db,
  user: string,
  group: string,
  request: string | null,
  kind: "upsert" | "revoke",
  now: number,
): void {
  db.prepare(
    "INSERT INTO change_events(user_id,group_id,request_id,kind,created_at) VALUES (?,?,?,?,?)",
  ).run(user, group, request, kind, now);
}
