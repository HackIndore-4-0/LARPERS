import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { fileTypeFromBuffer } from "file-type";
import type { AppConfig } from "./config.js";
import { ApiError } from "./errors.js";

export interface EvidenceStore {
  upload(
    bytes: Buffer,
  ): Promise<{ publicId: string; format: string; deliveryType: string }>;
  signedUrl(publicId: string, format: string, deliveryType: string): string;
  remove(publicId: string): Promise<void>;
}

export function createEvidenceStore(
  config: Pick<
    AppConfig,
    "CLOUDINARY_CLOUD_NAME" | "CLOUDINARY_API_KEY" | "CLOUDINARY_API_SECRET"
  >,
): EvidenceStore {
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
    secure: true,
  });
  return {
    async upload(bytes) {
      const kind = await fileTypeFromBuffer(bytes);
      if (
        !kind ||
        !["image/jpeg", "image/png", "image/webp"].includes(kind.mime)
      ) {
        throw new ApiError(
          400,
          "invalid_input",
          "Evidence must be a JPG, PNG, or WebP image.",
        );
      }
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: "image",
            type: "authenticated",
            folder: "sgsits-visitor-evidence",
          },
          (error, uploaded) =>
            error || !uploaded
              ? reject(error ?? new Error("Upload failed"))
              : resolve(uploaded),
        );
        stream.end(bytes);
      });
      return {
        publicId: result.public_id,
        format: result.format,
        deliveryType: result.type,
      };
    },
    signedUrl(publicId, format, deliveryType) {
      return cloudinary.utils.private_download_url(publicId, format, {
        type: deliveryType,
        resource_type: "image",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      });
    },
    async remove(publicId) {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: "image",
        type: "authenticated",
        invalidate: true,
      });
      if (result.result !== "ok" && result.result !== "not found")
        throw new Error(`Cloudinary deletion returned ${result.result}`);
    },
  };
}
