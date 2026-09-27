declare module "multer" {
  interface MulterInstance {
    single(name: string): import("express").RequestHandler;
  }
  interface MulterFactory {
    (options: {
      storage: unknown;
      limits: { fileSize: number; files: number; fields: number };
    }): MulterInstance;
    memoryStorage(): unknown;
  }
  const multer: MulterFactory;
  export default multer;
}

declare module "jose" {
  export function jwtVerify(
    token: string,
    secret: Uint8Array,
  ): Promise<{ payload: Record<string, unknown> }>;
  export class SignJWT {
    constructor(payload: Record<string, unknown>);
    setProtectedHeader(value: Record<string, unknown>): this;
    setSubject(value: string): this;
    setIssuedAt(): this;
    setExpirationTime(value: string): this;
    sign(secret: Uint8Array): Promise<string>;
  }
}

declare module "cloudinary" {
  export interface UploadApiResponse {
    public_id: string;
    format: string;
    type: string;
  }
  export const v2: {
    config(value: Record<string, unknown>): void;
    url(publicId: string, options: Record<string, unknown>): string;
    utils: {
      private_download_url(
        publicId: string,
        format: string,
        options: Record<string, unknown>,
      ): string;
    };
    api: {
      ping(): Promise<Record<string, unknown>>;
    };
    uploader: {
      upload_stream(
        options: Record<string, unknown>,
        callback: (
          error: Error | undefined,
          result: UploadApiResponse | undefined,
        ) => void,
      ): { end(bytes: Buffer): void };
      destroy(
        publicId: string,
        options: Record<string, unknown>,
      ): Promise<{ result: string }>;
    };
  };
}

declare namespace Express {
  interface Request {
    file?: { buffer: Buffer };
  }
}
