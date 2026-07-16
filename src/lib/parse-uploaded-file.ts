// Client-side file parsing for bulk call-log import.
import * as XLSX from "xlsx";
import mammoth from "mammoth";

export type ParsedEntry = { notes: string; callDate: string | null };

const DATE_KEYS = ["date", "call date", "call_date", "when", "timestamp", "created"];
const NOTES_KEYS = ["notes", "note", "summary", "call notes", "details", "description", "content", "log", "comment", "comments"];

function findKey(row: Record<string, unknown>, candidates: string[]): string | null {
  const lower = Object.keys(row).map((k) => [k.toLowerCase().trim(), k] as const);
  for (const c of candidates) {
    const hit = lower.find(([lk]) => lk === c);
    if (hit) return hit[1];
  }
  for (const c of candidates) {
    const hit = lower.find(([lk]) => lk.includes(c));
    if (hit) return hit[1];
  }
  return null;
}

function normalizeDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === "number") {
    // Excel serial date
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + v * 86400000);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rowsToEntries(rows: Record<string, unknown>[]): ParsedEntry[] {
  if (rows.length === 0) return [];
  const sample = rows[0];
  const notesKey = findKey(sample, NOTES_KEYS);
  const dateKey = findKey(sample, DATE_KEYS);
  const out: ParsedEntry[] = [];
  for (const row of rows) {
    let notes: string;
    if (notesKey) {
      notes = String(row[notesKey] ?? "").trim();
    } else {
      // Concatenate every value into one blob
      notes = Object.entries(row)
        .map(([k, v]) => (v != null && v !== "" ? `${k}: ${v}` : ""))
        .filter(Boolean)
        .join(" | ");
    }
    if (notes.length < 5) continue;
    const callDate = dateKey ? normalizeDate(row[dateKey]) : null;
    out.push({ notes, callDate });
  }
  return out;
}

function splitPlainText(text: string): ParsedEntry[] {
  // First try the "Saela" style: date header lines like "06/29/2026 (saves)" or "6/29/26"
  // followed by per-line call entries until the next header/blank block.
  const lines = text.split(/\r?\n/);
  const headerRe = /^\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b.*$/;
  const entries: ParsedEntry[] = [];
  let currentDate: string | null = null;
  let sawHeader = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(headerRe);
    // Treat as a header only if the line is short-ish (i.e. mostly the date + optional label)
    if (h && line.length <= 40) {
      const d = new Date(h[1]);
      if (!Number.isNaN(d.getTime())) {
        currentDate = d.toISOString();
        sawHeader = true;
        continue;
      }
    }
    if (line.length >= 8) {
      entries.push({ notes: line, callDate: currentDate ?? extractInlineDate(line) });
    }
  }
  if (sawHeader && entries.length > 0) return entries;

  // Otherwise: blank-line separated blocks, then long-line fallback.
  const chunks = text
    .split(/\n\s*\n|\n-{3,}\n|\n={3,}\n/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 15);
  if (chunks.length > 1) return chunks.map((notes) => ({ notes, callDate: extractInlineDate(notes) }));
  const longLines = lines.map((l) => l.trim()).filter((l) => l.length >= 20);
  if (longLines.length > 1) return longLines.map((notes) => ({ notes, callDate: extractInlineDate(notes) }));
  const single = text.trim();
  return single.length >= 5 ? [{ notes: single, callDate: extractInlineDate(single) }] : [];
}

function extractInlineDate(text: string): string | null {
  // Try common patterns: 3/12/2025, 2025-03-12, "March 12 2025"
  const m1 = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
  const m2 = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const cand = m2?.[1] ?? m1?.[1];
  if (!cand) return null;
  const d = new Date(cand);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function parseUploadedFile(file: File): Promise<ParsedEntry[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    return rowsToEntries(rows);
  }
  if (name.endsWith(".docx")) {
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return splitPlainText(value);
  }
  // txt, md, anything else -> read as text
  const text = await file.text();
  return splitPlainText(text);
}
