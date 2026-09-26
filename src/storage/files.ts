/**
 * Reading and writing files on the user's device.
 *
 * Where the File System Access API is available (Chromium browsers), the app can
 * save repeatedly to the same file. Elsewhere it falls back to a download.
 */

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface WritableFileHandle {
  name: string;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}

type WindowWithPicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<WritableFileHandle>;
};

export type FileHandle = WritableFileHandle;

export function supportsSaveInPlace(): boolean {
  return typeof (window as WindowWithPicker).showSaveFilePicker === 'function';
}

/** The user dismissed a file picker. */
export class PickerCancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'PickerCancelledError';
  }
}

export function downloadFile(content: string, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function pickSaveFile(suggestedName: string, description: string, extension: string, mimeType: string): Promise<FileHandle> {
  const picker = (window as WindowWithPicker).showSaveFilePicker;
  if (!picker) throw new Error('Save picker unavailable');
  try {
    return await picker({ suggestedName, types: [{ description, accept: { [mimeType]: [extension] } }] });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new PickerCancelledError();
    throw error;
  }
}

export async function writeFile(handle: FileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export const MAX_OPEN_FILE_BYTES = 200 * 1024 * 1024;

export async function readFileText(file: File): Promise<string> {
  if (file.size > MAX_OPEN_FILE_BYTES) throw new Error('This file is too large to open.');
  return file.text();
}

interface OpenFilePickerHandle extends WritableFileHandle {
  getFile(): Promise<File>;
}

type WindowWithOpenPicker = Window & {
  showOpenFilePicker?: (options?: {
    types?: { description: string; accept: Record<string, string[]> }[];
    multiple?: boolean;
  }) => Promise<OpenFilePickerHandle[]>;
};

export function supportsOpenPicker(): boolean {
  return typeof (window as WindowWithOpenPicker).showOpenFilePicker === 'function';
}

/** Opens a file with the File System Access API so later saves can overwrite it. */
export async function pickOpenFile(description: string, extensions: string[]): Promise<{ file: File; handle: FileHandle }> {
  const picker = (window as WindowWithOpenPicker).showOpenFilePicker;
  if (!picker) throw new Error('Open picker unavailable');
  try {
    const [handle] = await picker({ types: [{ description, accept: { 'application/json': extensions } }] });
    if (!handle) throw new PickerCancelledError();
    return { file: await handle.getFile(), handle };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new PickerCancelledError();
    throw error;
  }
}
