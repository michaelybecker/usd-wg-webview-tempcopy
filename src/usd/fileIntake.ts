const USD_EXTENSIONS = new Set(["usd", "usda", "usdc", "usdz"]);

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
  const usdFiles = files.filter(isUsdFile).sort(compareFilesForRoot);
  const usdaFile = usdFiles.find((file) => extensionOf(file.name) === "usda");
  return usdaFile ?? usdFiles[0] ?? files[0];
}

function compareFilesForRoot(a: File, b: File): number {
  const aPath = pathOf(a);
  const bPath = pathOf(b);
  const depthDiff = aPath.split("/").length - bPath.split("/").length;
  if (depthDiff !== 0) {
    return depthDiff;
  }
  return aPath.localeCompare(bPath);
}

function isUsdFile(file: File): boolean {
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

  return maybeWebkitItem.getAsEntry?.() ?? maybeWebkitItem.webkitGetAsEntry?.() ?? null;
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

async function readDirectory(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
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
    value: path
  });
}
