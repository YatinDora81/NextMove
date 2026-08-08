/**
 * ui/download.ts — file in, file out.
 *
 * SEC 9.2 / SEC 6.7 promise one-click JSON and CSV export and JSON import. Both happen entirely in
 * the page: an object URL for the download, a `FileReader` for the import. No `downloads`
 * permission (SEC 9.2 least privilege — the manifest grants storage/scripting/alarms/contextMenus
 * and nothing else), and no upload of any kind.
 */

/** Trigger a browser download of in-memory text. Revokes the object URL on the next tick. */
export function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Chrome needs the URL to survive the click; a macrotask is long enough and leaks nothing.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(filename: string, value: unknown): void {
  downloadText(filename, 'application/json', JSON.stringify(value, null, 2));
}

/** `jobfill-tracker-2026-08-07.csv` — dated filenames so repeated exports do not collide. */
export function datedFilename(stem: string, extension: string, at: number = Date.now()): string {
  const date = new Date(at);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${stem}-${date.getFullYear()}-${month}-${day}.${extension}`;
}

/**
 * Open the OS file picker and resolve with the chosen file, or `null` if the user cancelled.
 * Must be called from inside a user gesture — browsers refuse a programmatic picker otherwise.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';

    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    // `cancel` is the modern signal; without it a cancelled picker never resolves.
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}

export function readFileAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
}
