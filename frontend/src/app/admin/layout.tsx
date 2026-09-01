import type { Metadata } from "next";
import { AdminLayoutClient } from "./AdminLayoutClient";

// Internal console — never indexed, never shared as a link preview. Server
// component specifically so it CAN export metadata/robots (the previous
// client-only layout.tsx couldn't; see AdminLayoutClient's doc comment).
export const metadata: Metadata = {
  title: {
    // `absolute` opts every admin route out of the root layout's "%s | Lokl"
    // template — without it, a page here that falls back to `default`
    // (rather than setting its own title) renders as "Lokl Admin | Lokl",
    // because Next.js still applies an ancestor template to a resolved
    // default unless a segment explicitly opts out (confirmed empirically:
    // /admin rendered "Lokl Admin | Lokl" until this was added).
    default: "Lokl Admin",
    absolute: "Lokl Admin",
    template: "%s | Lokl Admin",
  },
  description: "Lokl internal admin console.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
