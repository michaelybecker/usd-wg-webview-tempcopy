const USD_EXTENSIONS = new Set(["usd", "usda", "usdc", "usdz"]);

// Names that conventionally identify a USD assembly/root layer.
const ROOT_NAME_KEYWORDS = [
  "root", "scene", "world", "main", "stage", "master", "assembly", "all", "top",
];

// Prefer generic .usd (assembly wrapper) over text .usda over binary .usdc.
// .usdz is a package, not typically a root reference target, so ranks last.
const EXTENSION_RANK: Record<string, number> = { usd: 3, usda: 2, usdc: 1, usdz: 0 };

export async function collectDroppedFiles(event: DragEvent): Promise<File[]> {
  const items = Array.from(event.dataTransfer?.items ?? []);

  if (!items.length) {
    return Array.from(event.dataTransfer?.files ?? []);
  }

  const files: File[] = [];

  for (const item of items) {
    const entry = getEntry(item);
    if (entry) {
      files.push(...(await collectEntryFiles(entry)));
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }

  return files;
}

export function pickLikelyRootFile(files: File[]): File | undefined {
  const usdFiles = files.filter(isUsdFile);
  if (!usdFiles.length) return files[0];

  // Work only among the shallowest USD files — deeper files are payloads/assets.
  const minDepth = Math.min(...usdFiles.map(depthOf));
  const candidates = usdFiles.filter((f) => depthOf(f) === minDepth);

  // Rule 1: single USD file at the root level — unambiguous.
  if (candidates.length === 1) return candidates[0];

  // Rule 2: filename (sans extension) matches its immediate parent folder name.
  // e.g. kitchen_set/kitchen_set.usd  →  strong assembly signal.
  const folderMatch = candidates.find(fileMatchesFolderName);
  if (folderMatch) return folderMatch;

  // Rule 3: keyword name > extension preference > alphabetical.
  return [...candidates].sort(compareByConvention)[0];
}

function depthOf(file: File): number {
  return pathOf(file).split("/").length;
}

function fileMatchesFolderName(file: File): boolean {
  const parts = pathOf(file).split("/");
  if (parts.length < 2) return false;
  const folderName = parts[parts.length - 2].toLowerCase();
  const baseName = parts[parts.length - 1].replace(/\.[^.]+$/, "").toLowerCase();
  return baseName === folderName;
}

function rootKeywordScore(file: File): number {
  const base = file.name.replace(/\.[^.]+$/, "").toLowerCase();
  const idx = ROOT_NAME_KEYWORDS.indexOf(base);
  // indexOf returns -1 when absent; we flip sign so higher = better matches sort first.
  return idx === -1 ? -1 : ROOT_NAME_KEYWORDS.length - idx;
}

function compareByConvention(a: File, b: File): number {
  const keywordDiff = rootKeywordScore(b) - rootKeywordScore(a);
  if (keywordDiff !== 0) return keywordDiff;

  const extDiff = (EXTENSION_RANK[extensionOf(b.name)] ?? 0) - (EXTENSION_RANK[extensionOf(a.name)] ?? 0);
  if (extDiff !== 0) return extDiff;

  return pathOf(a).localeCompare(pathOf(b));
}

export function isUsdFile(file: File): boolean {
  return USD_EXTENSIONS.has(extensionOf(file.name));
}

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function pathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

function getEntry(item: DataTransferItem): FileSystemEntry | null {
  const maybeWebkitItem = item as DataTransferItem & {
    webkitGetAsEntry?: () => FileSystemEntry | null;
    getAsEntry?: () => FileSystemEntry | null;
  };

  return (
    maybeWebkitItem.getAsEntry?.() ??
    maybeWebkitItem.webkitGetAsEntry?.() ??
    null
  );
}

async function collectEntryFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry);
    defineRelativePath(file, entry.fullPath.replace(/^\//, ""));
    return [file];
  }

  if (entry.isDirectory) {
    const children = await readDirectory(entry as FileSystemDirectoryEntry);
    const childFiles = await Promise.all(children.map(collectEntryFiles));
    return childFiles.flat();
  }

  return [];
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readDirectory(
  entry: FileSystemDirectoryEntry
): Promise<FileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: FileSystemEntry[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

    if (!batch.length) {
      break;
    }

    entries.push(...batch);
  }

  return entries;
}

function defineRelativePath(file: File, path: string): void {
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: path,
  });
}
