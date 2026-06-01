import { ProductCardSkeleton } from "@/components/ui";

const SKEL_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export default function Loading() {
  return (
    <div className="p-6 sm:p-10 max-w-7xl mx-auto bottom-nav-safe">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {SKEL_KEYS.map((k) => <ProductCardSkeleton key={k} />)}
      </div>
    </div>
  );
}
