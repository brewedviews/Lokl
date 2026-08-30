/**
 * Upload an image to Cloudinary via the backend `/api/merchant/upload-image`
 * endpoint. Returns `{image_url, public_id}` for storage with the product /
 * storefront. Throws on failure with a user-facing message.
 *
 * Mongo stores ONLY `{image_url, public_id}` — never base64.
 */
import { apiClient, getToken } from "@/lib/api-client";

export type UploadAssetType = "product" | "store_logo" | "store_banner" | "kyc" | "brand_logo";

export interface UploadedImage {
  image_url: string;
  public_id: string;
  width?: number;
  height?: number;
}

/**
 * `/api/merchant/*` always classifies as the "merchant" auth scope in
 * api-client.ts's URL-based token routing, so a call from an admin-only
 * session (no merchant JWT ever cached there) would send no bearer token at
 * all and 401 — even though the backend endpoint itself already accepts
 * both merchant and admin roles. `callerScope: "admin"` opts into the
 * explicit-Authorization override api-client.ts's interceptor documents,
 * forcing the admin JWT instead. Defaults to "merchant" — every existing
 * call site is unaffected.
 */
type CallerScope = "merchant" | "admin";

function authHeaderFor(callerScope: CallerScope): Record<string, string> {
  if (callerScope !== "admin") return {};
  const token = getToken("admin");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function uploadImage(
  file: File,
  assetType: UploadAssetType,
  callerScope: CallerScope = "merchant",
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
    {
      headers: {
        "Content-Type": "multipart/form-data",
        ...authHeaderFor(callerScope),
      },
      // Secondary hardening only — NOT the fix for the event-loop-blocking
      // incident (see backend/services/cloudinary_service.py). The default
      // client's 15s timeout is tuned for typical JSON calls; a multi-MB
      // image on a slow merchant connection can legitimately take longer
      // to actually transfer, so this one call gets its own headroom.
      timeout: 30_000,
    },
  );
  return r.data;
}

export async function deleteUploadedImage(publicId: string, callerScope: CallerScope = "merchant"): Promise<boolean> {
  if (!publicId) return true;
  try {
    const r = await apiClient.delete<{ ok: boolean }>(
      `/api/merchant/upload-image?public_id=${encodeURIComponent(publicId)}`,
      { headers: authHeaderFor(callerScope) },
    );
    return r.data.ok;
  } catch {
    return false;
  }
}
