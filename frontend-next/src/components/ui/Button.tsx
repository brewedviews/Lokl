/**
 * Button — primary interactive element. Visual parity with the legacy
 * shadcn button used across the consumer surface (rounded-full, navy primary,
 * marigold accent for destructive). All token colors come from globals.css.
 */
"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-primary text-white hover:bg-brand-primary/90 active:bg-brand-primary/80",
  secondary:
    "border border-card-border bg-card-surface text-brand-primary hover:border-brand-primary",
  ghost:
    "text-brand-primary hover:bg-brand-primary/5",
  destructive:
    "text-brand-accent hover:bg-brand-accent/10",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "text-sm px-4 py-2",
  md: "text-base px-6 py-3",
  lg: "text-lg px-8 py-4",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", isLoading = false, className, children, disabled, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled ?? isLoading}
        aria-busy={isLoading || undefined}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-all rounded-full",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          VARIANT[variant],
          SIZE[size],
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading…</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";
