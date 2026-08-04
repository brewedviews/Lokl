"use client";

/** Warn-and-clear confirm shown when adding an item conflicts with the
 *  store already in the bag (one store per bag). Paired with useStoreConflict
 *  so ProductCard and ProductActions render this identically. */
import type { CartConflict } from "@/types";

interface Props {
  conflict: CartConflict | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function StoreConflictDialog({ conflict, onConfirm, onCancel }: Props) {
  if (!conflict) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[70] flex items-end md:items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="store-conflict-dialog"
        className="bg-white rounded-3xl w-full max-w-md p-6"
      >
        <h3 className="font-display text-xl font-bold text-[#0A1F5C] mb-2">Start a new bag?</h3>
        <p className="text-sm text-[#595959] mb-6">
          Your bag has items from{" "}
          <span className="font-semibold text-[#0A1F5C]">{conflict.existing_store_name}</span>.
          Start a new bag with{" "}
          <span className="font-semibold text-[#0A1F5C]">{conflict.new_store_name}</span>?
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            data-testid="conflict-cancel"
            className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC] font-semibold text-[#0A1F5C]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            data-testid="conflict-clear-add"
            className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold"
          >
            Clear bag & add
          </button>
        </div>
      </div>
    </div>
  );
}
