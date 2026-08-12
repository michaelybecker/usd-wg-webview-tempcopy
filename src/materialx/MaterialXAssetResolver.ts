import type { RenderableTexture } from "../usd/types";
import type { MaterialXResolvedResource } from "./types";

export class MaterialXAssetResolver {
  private readonly resourceUrls = new Map<string, string>();

  resolve(uri: string, materialXPath: string, resources: RenderableTexture[]): MaterialXResolvedResource | null {
    const normalizedUri = normalizeAssetPath(uri);
    const basePath = normalizeAssetPath(materialXPath).split("/").slice(0, -1).join("/");
    const candidates = assetPathCandidates(normalizedUri, basePath);

    const resource = resources.find((candidate) => {
      const path = normalizeAssetPath(candidate.path);
      for (const resourceCandidate of assetPathCandidates(path)) {
        if (candidates.has(resourceCandidate)) {
          return true;
        }
      }
      return false;
    });
    if (!resource?.data?.length) {
      return null;
    }

    let url = this.resourceUrls.get(resource.path);
    if (!url) {
      url = URL.createObjectURL(new Blob([resource.data as BlobPart], { type: resource.mimeType }));
      this.resourceUrls.set(resource.path, url);
    }
    return { ...resource, url };
  }

  resolveUrl(uri: string, materialXPath: string, resources: RenderableTexture[]): string | null {
    return this.resolve(uri, materialXPath, resources)?.url ?? null;
  }

  revokeUrls(): void {
    for (const url of this.resourceUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.resourceUrls.clear();
  }
}

export function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function assetPathCandidates(path: string, basePath = ""): Set<string> {
  const candidates = new Set<string>();
  const add = (candidate: string) => {
    const normalized = normalizeAssetPath(candidate);
    if (!normalized) {
      return;
    }
    candidates.add(normalized);
    candidates.add(normalized.split("/").pop() ?? normalized);

    const packageMember = extractPackageMemberPath(normalized);
    if (packageMember && packageMember !== normalized) {
      candidates.add(packageMember);
      candidates.add(packageMember.split("/").pop() ?? packageMember);
    }
  };

  add(path);
  if (basePath) {
    add(`${basePath}/${path}`);
  }

  return candidates;
}

function extractPackageMemberPath(path: string): string | null {
  const openBracket = path.indexOf("[");
  const closeBracket = path.lastIndexOf("]");
  if (openBracket === -1 || closeBracket <= openBracket) {
    return null;
  }
  return normalizeAssetPath(path.slice(openBracket + 1, closeBracket));
}
