// Excel (.xlsx) files for the importer: read in the browser and turned into
// the same tab-separated text as pasting the cells, so one importer handles
// both. The reader loads only when someone picks a spreadsheet.

/** A cell as text: dates as 2027-04-29, whole numbers without ".0", tabs and line breaks flattened. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  return String(v).replace(/[\t\r\n]+/g, ' ').trim();
}

/** Rows of cells → tab-separated text, skipping empty rows and trailing empty columns. */
export function cellsToTsv(rows: unknown[][]): string {
  return rows
    .map((r) => r.map(cellText))
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => { let n = r.length; while (n > 0 && r[n - 1] === '') n--; return r.slice(0, n).join('\t'); })
    .join('\n');
}

export const isXlsx = (f: File) => /\.xlsx$/i.test(f.name);

export async function xlsxSheetNames(file: File): Promise<string[]> {
  const { readSheetNames } = await import('read-excel-file');
  return readSheetNames(file);
}

export async function xlsxSheetToTsv(file: File, sheet: string): Promise<string> {
  const { default: readXlsxFile } = await import('read-excel-file');
  return cellsToTsv(await readXlsxFile(file, { sheet }));
}
