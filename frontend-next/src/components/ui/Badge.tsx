/**
 * Badge — small status pill. Used in product cards (trusted, fast-selling),
 * order timeline rows, and admin tables. Visual reference: legacy shadcn
 * Badge with the brand color palette.
 */
import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "accent" | "primary" | "muted" | "success" | "error";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANTS: Record<BadgeVariant, string> = {
  accent:  "bg-brand-accent/10 text-brand-accent",
  primary: "bg-brand-primary/10 text-brand-primary",
  muted:   "bg-card-border text-text-muted",
  success: "bg-green-50 text-green-700",
  error:   "bg-red-50 text-red-700",
};

export function Badge({ variant = "accent", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full",
        "text-xs font-semibold uppercase tracking-wider",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
