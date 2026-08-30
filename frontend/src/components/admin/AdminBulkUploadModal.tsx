"use client";

/**
 * Admin bulk product upload — Download template -> Upload -> Detect &
 * validate -> Preview (select rows) -> Confirm import -> Summary.
 *
 * Reuses the exact same parsing/validation pipeline as the merchant bulk
 * flow server-side (server.py's `_parse_bulk_file`/`_row_to_product`/
 * `xlsx_template`); this component is purely the preview/selection/
 * confirm UI around `adminApi.bulkDetectProducts`/`bulkImportProducts`.
 * No product is created until the admin explicitly confirms — `detect`
 * only ever previews.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { adminApi, type AdminBulkDetectResult, type AdminBulkImportResult, type AdminBulkPreviewRow } from "@/lib/api/admin";
import { downloads } from "@/lib/downloads";
import { getErrorMessage } from "@/lib/api-error";
import { useAdminAuthStore } from "@/stores";

type Phase = "upload" | "preview" | "result";

const STATUS_STYLE: Record<AdminBulkPreviewRow["status"], string> = {
  valid: "bg-green-50 text-green-700 border-green-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

export function AdminBulkUploadModal({
  merchantId, onClose, onImported,
}: {
  merchantId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const adminToken = useAdminAuthStore((s) => s.token);
  const [phase, setPhase] = useState<Phase>("upload");
  const [busy, setBusy] = useState(false);
  const [detect, setDetect] = useState<AdminBulkDetectResult | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<AdminBulkImportResult | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const d = await adminApi.bulkDetectProducts(merchantId, file);
      setDetect(d);
      setSelectedRows(new Set(d.rows.filter((r) => r.status !== "error").map((r) => r.row)));
      setPhase("preview");
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const toggleRow = (row: number) => {
    setSelectedRows((s) => {
      const next = new Set(s);
      if (next.has(row)) next.delete(row); else next.add(row);
      return next;
    });
  };

  const confirmImport = async () => {
    if (!detect) return;
    setBusy(true);
    try {
      const r = await adminApi.bulkImportProducts(merchantId, detect.import_id, Array.from(selectedRows));
      setResult(r);
      setPhase("result");
      onImported();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full md:max-w-3xl md:rounded-3xl rounded-t-3xl max-h-[92vh] flex flex-col" data-testid="admin-bulk-upload-modal">
        <div className="px-5 pt-5 pb-3 border-b border-[#E5E2DC] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A2B4C]">Bulk upload products</h2>
            <p className="text-xs text-[#595959] mt-0.5">
              {phase === "upload" && "Download the template, fill it in, then upload."}
              {phase === "preview" && `${detect?.total_rows ?? 0} rows detected — review before importing.`}
              {phase === "result" && "Import complete."}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#F5F5F5] flex items-center justify-center text-[#595959]">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === "upload" && (
            <div className="space-y-4">
              <button
                onClick={() => void downloads.adminProductsTemplate(adminToken).catch((e) => toast.error(getErrorMessage(e)))}
                data-testid="admin-bulk-download-template"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C]"
              >
                Download template
              </button>
              <label className="block border-2 border-dashed border-[#E5E2DC] hover:border-[#1A2B4C] rounded-2xl p-10 text-center cursor-pointer">
                {busy ? <Loader2 className="mx-auto animate-spin text-[#595959]" /> : <Upload className="mx-auto text-[#595959]" />}
                <div className="text-sm font-semibold text-[#1A2B4C] mt-2">Upload Excel or CSV</div>
                <div className="text-xs text-[#94A3B8] mt-1">Up to 500 rows per file</div>
                <input
                  data-testid="admin-bulk-file-input"
                  type="file" accept=".xlsx,.csv" className="hidden" disabled={busy}
                  onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
            </div>
          )}

          {phase === "preview" && detect && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-xs font-semibold">
                <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 size={13} /> {detect.valid_count} valid</span>
                <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13} /> {detect.warning_count} warnings</span>
                <span className="inline-flex items-center gap-1 text-red-700"><XCircle size={13} /> {detect.error_count} errors</span>
              </div>
              <div className="border border-[#E5E2DC] rounded-2xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-[#FDFBF7] text-left text-[10px] uppercase text-[#595959]">
                    <tr>
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Product name</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detect.rows.map((r) => (
                      <tr key={r.row} className="border-t border-[#E5E2DC]" data-testid={`admin-bulk-row-${r.row}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            disabled={r.status === "error"}
                            checked={selectedRows.has(r.row)}
                            onChange={() => toggleRow(r.row)}
                            data-testid={`admin-bulk-row-select-${r.row}`}
                            className="w-4 h-4 accent-[#E68910]"
                          />
                        </td>
                        <td className="px-3 py-2 text-[#94A3B8]">{r.row}</td>
                        <td className="px-3 py-2 font-semibold text-[#1A2B4C]">{r.name || "—"}</td>
                        <td className="px-3 py-2 text-[#595959]">{r.category || "—"}</td>
                        <td className="px-3 py-2 text-right">{r.price != null ? `₹${r.price.toLocaleString()}` : "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                        </td>
                        <td className="px-3 py-2 text-[#595959]">{r.messages.join("; ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {phase === "result" && result && (
            <div className="space-y-3">
              <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${result.status === "completed" ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                {result.successful_rows} of {result.successful_rows + result.failed_rows} products imported
              </div>
              {result.row_errors.length > 0 && (
                <div className="space-y-1.5">
                  {result.row_errors.map((e, i) => (
                    <div key={i} className="text-xs rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-red-700">
                      Row {e.row}: {e.message}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-[#94A3B8]">
                Products were created paused, without images. Add photos via the product edit flow to go live.
                Import id: <span className="font-mono">{result.import_id}</span>
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#E5E2DC] flex gap-2">
          {phase === "preview" && (
            <>
              <button onClick={onClose} className="flex-1 py-3 bg-white border border-[#E5E2DC] text-[#595959] rounded-xl font-semibold text-sm">
                Cancel
              </button>
              <button
                onClick={() => void confirmImport()}
                disabled={busy || selectedRows.size === 0}
                data-testid="admin-bulk-confirm-import"
                className="flex-1 py-3 bg-[#E68910] text-white rounded-xl font-bold text-sm disabled:opacity-50"
              >
                {busy ? "Importing…" : `Import ${selectedRows.size} product${selectedRows.size === 1 ? "" : "s"}`}
              </button>
            </>
          )}
          {phase === "result" && (
            <button onClick={onClose} data-testid="admin-bulk-done" className="w-full py-3 bg-[#1A2B4C] text-white rounded-xl font-bold text-sm">
              Done
            </button>
          )}
          {phase === "upload" && (
            <button onClick={onClose} className="w-full py-3 bg-white border border-[#E5E2DC] text-[#595959] rounded-xl font-semibold text-sm">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
