import Papa from "papaparse";

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
}

export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const columns = results.meta.fields ?? [];
        resolve({ columns, rows: results.data });
      },
      error: (err: Error) => reject(err),
    });
  });
}

export function parseCsvText(text: string): ParsedCsv {
  const results = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const columns = results.meta.fields ?? [];
  return { columns, rows: results.data };
}
