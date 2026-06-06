/**
 * `/admin/login` now redirects to `/admin` because the actual login form is
 * embedded inside `admin/layout.tsx` (rendered when the user is not yet
 * authenticated). This file used to be a placeholder shipped to preview —
 * iter18 testing flagged that anything programmatically routing to
 * `/admin/login` (e.g. `router.replace("/admin/login")` in legacy code paths)
 * was landing on a dead page.
 */
import { redirect } from "next/navigation";

export default function AdminLoginRedirectPage() {
  redirect("/admin");
}
