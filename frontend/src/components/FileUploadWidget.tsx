import { useState } from "react";
import { files } from "../lib/api";
import type { ParsedCsv } from "../lib/csv";
import { parseCsvText } from "../lib/csv";

interface FileUploadWidgetProps {
  nodeId: string;
  onUploadPath: (path: string) => void; // Called with server-side path after upload
  onPreviewUpdate?: (table: ParsedCsv) => void; // Update the live preview
}

export function FileUploadWidget({ nodeId: _nodeId, onUploadPath, onPreviewUpdate }: FileUploadWidgetProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      // Upload using new v1 endpoint
      const data = await files.upload(file);
      setUploadedPath(data.path);
      onUploadPath(data.path);

      // Also update preview with file contents (for CSV only)
      if (file.type === "text/csv" || file.name.endsWith(".csv")) {
        const text = await file.text();
        const table = parseCsvText(text);
        onPreviewUpdate?.(table);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      // Clear the input so the same file can be selected again
      event.currentTarget.value = "";
    }
  };

  return (
    <div className="file-upload-widget">
      <label className="file-upload-label">
        <input
          type="file"
          accept=".csv,.parquet,.parq"
          onChange={handleFileSelect}
          disabled={uploading}
          className="file-upload-input"
        />
        <span className="file-upload-button">
          {uploading ? "Uploading..." : "Choose File"}
        </span>
      </label>

      {uploadedPath && (
        <p className="file-upload-success">
          ✓ Uploaded: <code>{uploadedPath.split("/").pop()}</code>
        </p>
      )}

      {error && <p className="file-upload-error">❌ {error}</p>}
    </div>
  );
}
