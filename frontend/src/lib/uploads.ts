/**
 * Upload an image to Cloudinary via the backend `/api/merchant/upload-image`
 * endpoint. Returns `{image_url, public_id}` for storage with the product /
 * storefront. Throws on failure with a user-facing message.
 *
 * Mongo stores ONLY `{image_url, public_id}` — never base64.
 */
import { apiClient } from "@/lib/api-client";

export type UploadAssetType = "product" | "store_logo" | "store_banner" | "kyc" | "brand_logo";

export interface UploadedImage {
  image_url: string;
  public_id: string;
  width?: number;
  height?: number;
}

export async function uploadImage(
  file: File,
  assetType: UploadAssetType,
): Promise<UploadedImage> {
  if (!file) throw new Error("No file selected");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image too large (max 5 MB)");
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("Only JPEG, PNG and WebP images are allowed");
  }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("asset_type", assetType);
  const r = await apiClient.post<UploadedImage>(
    "/api/merchant/upload-image",
    fd,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return r.data;
}

export async function deleteUploadedImage(publicId: string): Promise<boolean> {
  if (!publicId) return true;
  try {
    const r = await apiClient.delete<{ ok: boolean }>(
      `/api/merchant/upload-image?public_id=${encodeURIComponent(publicId)}`,
    );
    return r.data.ok;
  } catch {
    return false;
  }
}
