import argon2 from "argon2";
import type { NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import type { AppConfig } from "./config.js";
import { sendError } from "./errors.js";

export interface EditorAuth {
  authenticate(email: string, password: string): Promise<string | null>;
  requireEditor(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void>;
}

export async function createEditorAuth(
  config: Pick<
    AppConfig,
    "EDITOR_EMAIL" | "EDITOR_PASSWORD" | "EDITOR_TOKEN_SECRET"
  >,
): Promise<EditorAuth> {
  const passwordHash = await argon2.hash(config.EDITOR_PASSWORD, {
    type: argon2.argon2id,
  });
  const secret = new TextEncoder().encode(config.EDITOR_TOKEN_SECRET);
  return {
    async authenticate(email, password) {
      if (email.toLowerCase() !== config.EDITOR_EMAIL.toLowerCase()) {
        await argon2.verify(passwordHash, password).catch(() => false);
        return null;
      }
      if (!(await argon2.verify(passwordHash, password))) return null;
      return new SignJWT({ role: "editor" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(config.EDITOR_EMAIL)
        .setIssuedAt()
        .setExpirationTime("2h")
        .sign(secret);
    },
    async requireEditor(request, response, next) {
      const authorization = request.header("authorization");
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : null;
      if (!token) {
        sendError(response, 401, "unauthorized", "Editor login required.");
        return;
      }
      try {
        const verified = await jwtVerify(token, secret);
        if (verified.payload.role !== "editor") throw new Error("invalid role");
        next();
      } catch {
        sendError(
          response,
          401,
          "unauthorized",
          "Editor session is invalid or expired.",
        );
      }
    },
  };
}

export function requireMutationOrigin(expectedOrigin: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    if (request.header("origin") !== expectedOrigin) {
      sendError(
        response,
        401,
        "unauthorized",
        "Request origin is not allowed.",
      );
      return;
    }
    next();
  };
}
