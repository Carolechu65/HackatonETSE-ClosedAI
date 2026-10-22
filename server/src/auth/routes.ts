import argon2 from "argon2";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../persistence/database.ts";
import {
  DomainError,
  hash,
  id,
  object,
  secret,
  string,
} from "../app/support.ts";
export function authenticate(
  db: Db,
  request: FastifyRequest,
  now: number,
): string {
  const header = request.headers.authorization;
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header))
    throw new DomainError("UNAUTHENTICATED", "Inicia sesión.");
  const session = db
    .prepare(
      "SELECT user_id FROM sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?",
    )
    .get(hash(header.slice(7)), now) as { user_id: string } | undefined;
  if (!session)
    throw new DomainError(
      "UNAUTHENTICATED",
      "La sesión ha caducado o se ha cerrado.",
    );
  return session.user_id;
}
export function authRoutes(
  app: FastifyInstance,
  db: Db,
  now: () => number,
  sessionDurationMs: number,
): void {
  const session = (userId: string) => {
    const token = secret(),
      expiresAtEpochMs = now() + sessionDurationMs;
    db.prepare("INSERT INTO sessions VALUES (?,?,?,NULL)").run(
      hash(token),
      userId,
      expiresAtEpochMs,
    );
    return { userId, token, expiresAtEpochMs };
  };
  const credentials = (body: unknown) => {
    const data = object(body, ["email", "password", "displayName"]);
    const email = string(data.email, 254).toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof data.password !== "string" ||
      data.password.length < 10 ||
      data.password.length > 256
    )
      throw new DomainError(
        "INVALID_ARGUMENT",
        "Usa un correo válido y una contraseña de 10 a 256 caracteres.",
      );
    return {
      email,
      password: data.password,
      displayName:
        data.displayName === undefined
          ? "Compañero"
          : string(data.displayName, 80),
    };
  };
  app.post(
    "/v1/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const data = credentials(req.body);
      const passwordHash = await argon2.hash(data.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      return db.transaction(() => {
        if (db.prepare("SELECT 1 FROM users WHERE email=?").get(data.email))
          throw new DomainError(
            "VERSION_CONFLICT",
            "No se pudo crear la cuenta con ese correo.",
          );
        const userId = id();
        db.prepare(
          "INSERT INTO users(id,email,password_hash,display_name) VALUES (?,?,?,?)",
        ).run(userId, data.email, passwordHash, data.displayName);
        return session(userId);
      })();
    },
  );
  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const data = credentials(req.body);
      const user = db
        .prepare("SELECT id,password_hash FROM users WHERE email=?")
        .get(data.email) as { id: string; password_hash: string } | undefined;
      if (!user || !(await argon2.verify(user.password_hash, data.password)))
        throw new DomainError(
          "UNAUTHENTICATED",
          "Correo o contraseña incorrectos.",
        );
      return session(user.id);
    },
  );
  app.get("/v1/auth/me", async (req) => {
    const uid = authenticate(db, req, now());
    return db
      .prepare(
        "SELECT id AS userId,email,display_name AS displayName FROM users WHERE id=?",
      )
      .get(uid);
  });
  app.post("/v1/auth/logout", async (req) => {
    authenticate(db, req, now());
    db.prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=?").run(
      now(),
      hash(req.headers.authorization!.slice(7)),
    );
    return { ok: true };
  });
}
