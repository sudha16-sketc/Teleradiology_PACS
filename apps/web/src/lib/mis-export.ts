import { apiClient } from "@/lib/api-client";

export async function downloadMisReport(): Promise<void> {
  const blob = await apiClient.getBlob("/analytics/mis-report", {
    timeoutMs: 300_000,
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = "MIS-Report.xlsx";
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
