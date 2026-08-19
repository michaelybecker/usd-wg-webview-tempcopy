import type { RenderableTexture } from "../usd/types";
import type { MaterialXResolvedResource } from "./types";

export class MaterialXAssetResolver {
  private readonly resourceUrls = new Map<string, string>();

  resolve(uri: string, materialXPath: string, resources: RenderableTexture[]): MaterialXResolvedResource | null {
    const basePath = normalizeAssetPath(materialXPath).split("/").slice(0, -1).join("/");
    const exactCandidates = exactAssetPathCandidates(uri, basePath);
    const exactResource = resources.find((candidate) =>
      [...exactAssetPathCandidates(candidate.path)].some((path) => exactCandidates.has(path))
    );
    const resource = exactResource ?? findUnambiguousBasenameMatch(resources, exactCandidates);
    if (!resource?.data?.length) {
      return null;
    }

    let url = this.resourceUrls.get(resource.path);
    if (!url) {
      const bytes = resource.data instanceof Uint8Array ? resource.data : new Uint8Array(resource.data);
      url = objectUrlFromBytes(bytes, resource.mimeType);
      this.resourceUrls.set(resource.path, url);
    }
    return { ...resource, url };
  }

  resolveUrl(uri: string, materialXPath: string, resources: RenderableTexture[]): string | null {
    return this.resolve(uri, materialXPath, resources)?.url ?? null;
  }

  revokeUrls(): void {
    for (const url of this.resourceUrls.values()) {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    }
    this.resourceUrls.clear();
  }
}

function objectUrlFromBytes(bytes: Uint8Array, mimeType: string): string {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

export function normalizeAssetPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const packageMember = extractPackageMemberPath(normalized);
  if (packageMember) {
    const prefix = normalized.slice(0, normalized.indexOf("["));
    return `${normalizePathSegments(prefix)}[${normalizePathSegments(packageMember)}]`;
  }
  return normalizePathSegments(normalized);
}

export function assetPathCandidates(path: string, basePath = ""): Set<string> {
  const candidates = exactAssetPathCandidates(path, basePath);
  for (const candidate of [...candidates]) {
    candidates.add(candidate.split("/").pop() ?? candidate);
  }
  return candidates;
}

function exactAssetPathCandidates(path: string, basePath = ""): Set<string> {
  const candidates = new Set<string>();
  const add = (candidate: string) => {
    const normalized = normalizeAssetPath(candidate);
    if (!normalized) {
      return;
    }
    candidates.add(normalized);

    const packageMember = extractPackageMemberPath(normalized);
    if (packageMember && packageMember !== normalized) {
      candidates.add(packageMember);
    }
  };

  add(path);
  if (basePath) {
    add(`${basePath}/${path}`);
  }
  return candidates;
}

function findUnambiguousBasenameMatch(
  resources: RenderableTexture[],
  exactCandidates: Set<string>
): RenderableTexture | null {
  const basenames = new Set(
    [...exactCandidates].map((candidate) => candidate.split("/").pop() ?? candidate)
  );
  const matches = resources.filter((resource) =>
    [...exactAssetPathCandidates(resource.path)].some((path) => basenames.has(path.split("/").pop() ?? path))
  );
  return matches.length === 1 ? matches[0] : null;
}

function normalizePathSegments(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function extractPackageMemberPath(path: string): string | null {
  const openBracket = path.indexOf("[");
  const closeBracket = path.lastIndexOf("]");
  if (openBracket === -1 || closeBracket <= openBracket) {
    return null;
  }
  return normalizeAssetPath(path.slice(openBracket + 1, closeBracket));
}
