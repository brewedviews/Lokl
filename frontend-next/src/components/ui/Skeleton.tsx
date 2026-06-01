/**
 * Skeleton — pulsing placeholder used while React Query is loading.
 * Layout-specific helpers mirror the real components they substitute for,
 * keeping the page from shifting when the data arrives.
 */
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-card bg-card-border", className)}
      aria-hidden="true"
    />
  );
}

/** Matches ProductCardV2: square image + two title lines + price row. */
export function ProductCardSkeleton() {
  return (
    <div className="bg-card-surface border border-card-border rounded-card p-3">
      <Skeleton className="w-full aspect-square mb-3" />
      <Skeleton className="h-4 w-3/4 mb-2" />
      <Skeleton className="h-3 w-1/2 mb-2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

/** Matches StoreCardV2: avatar + 3-line text block. */
export function StoreCardSkeleton() {
  return (
    <div className="bg-card-surface border border-card-border rounded-card-lg p-5 flex gap-4">
      <Skeleton className="w-16 h-16 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}

/** Matches an order list row: thumbnail + 2 lines + status badge. */
export function OrderRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 bg-card-surface border border-card-border rounded-card">
      <Skeleton className="w-12 h-12 rounded-card flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

/** CustomerAccount profile-header substitute. */
export function ProfileSkeleton() {
  return (
    <div className="bg-card-surface border border-card-border rounded-card-lg p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <Skeleton className="w-14 h-14 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}
