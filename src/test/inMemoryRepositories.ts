import type { ImageProcessor, ProcessedImage } from "../domain/assets/imageIntake";
import type { Artwork, Asset, Project, ProjectSummary } from "../domain/project";
import type { ArtworkLibraryRepository } from "../domain/repositories/artworkLibraryRepository";
import { AssetNotFoundError, type AssetRepository } from "../domain/repositories/assetRepository";
import type { ProjectRepository } from "../domain/repositories/projectRepository";
import {
  projectSnapshotKey,
  SNAPSHOTS_PER_PROJECT,
  type ProjectSnapshotRecord,
  type ProjectSnapshotRepository,
  type ProjectSnapshotSummary
} from "../domain/repositories/projectSnapshotRepository";
import { parseArtwork, parseAsset } from "../domain/schema/artworkSchema";
import { parseProject } from "../domain/schema/projectSchema";

export class InMemoryProjectRepository implements ProjectRepository {
  projects = new Map<string, Project>();

  async load(id: string): Promise<Project> {
    const project = this.projects.get(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  }

  async save(project: Project): Promise<void> {
    parseProject(project);
    this.projects.set(project.id, project);
  }

  async list(): Promise<ProjectSummary[]> {
    return [...this.projects.values()]
      .map(({ id, title, updatedAt, floor, checklistArtworkIds }) => ({
        id,
        title,
        updatedAt,
        roomCount: floor.rooms.length,
        artworkCount: checklistArtworkIds.length
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    this.projects.delete(id);
  }
}

// Match the production repository's validate-on-save behavior.
export class InMemoryArtworkLibraryRepository implements ArtworkLibraryRepository {
  artworks = new Map<string, Artwork>();

  async list(): Promise<Artwork[]> {
    return [...this.artworks.values()];
  }

  async get(id: string): Promise<Artwork> {
    const artwork = this.artworks.get(id);
    if (!artwork) throw new Error(`Artwork not found: ${id}`);
    return artwork;
  }

  async save(artwork: Artwork): Promise<void> {
    parseArtwork(artwork);
    this.artworks.set(artwork.id, artwork);
  }

  async delete(id: string): Promise<void> {
    this.artworks.delete(id);
  }
}

// Mirrors the IndexedDB snapshot repo's add semantics (fingerprint dedupe
// against the newest, prune to SNAPSHOTS_PER_PROJECT) over a plain sorted map.
export class InMemoryProjectSnapshotRepository implements ProjectSnapshotRepository {
  records = new Map<string, ProjectSnapshotRecord>();

  private keysFor(projectId: string): string[] {
    return [...this.records.keys()]
      .filter((key) => key.startsWith(`${projectId}:`))
      .sort();
  }

  async add(record: ProjectSnapshotRecord): Promise<void> {
    const keys = this.keysFor(record.projectId);
    const newestKey = keys[keys.length - 1];
    if (newestKey && this.records.get(newestKey)?.fingerprint === record.fingerprint) {
      return;
    }

    this.records.set(projectSnapshotKey(record.projectId, record.createdAt), record);

    const allKeys = this.keysFor(record.projectId);
    const excess = allKeys.length - SNAPSHOTS_PER_PROJECT;
    for (let i = 0; i < excess; i += 1) {
      this.records.delete(allKeys[i]);
    }
  }

  async listByProject(projectId: string): Promise<ProjectSnapshotSummary[]> {
    return this.keysFor(projectId)
      .map((key) => {
        const record = this.records.get(key)!;
        return {
          key,
          createdAt: record.createdAt,
          projectTitle: record.projectTitle,
          fingerprint: record.fingerprint
        };
      })
      .reverse();
  }

  async get(key: string): Promise<ProjectSnapshotRecord | undefined> {
    return this.records.get(key);
  }

  async deleteByProject(projectId: string): Promise<void> {
    for (const key of this.keysFor(projectId)) {
      this.records.delete(key);
    }
  }
}

// Match production validation while keeping Blobs directly inspectable.
export class InMemoryAssetRepository implements AssetRepository {
  assets = new Map<string, Asset>();
  blobs = new Map<string, Blob>();

  async saveAsset(
    asset: Asset,
    blobs: { original: Blob; display: Blob; thumbnail: Blob }
  ): Promise<void> {
    parseAsset(asset);
    this.assets.set(asset.id, asset);
    this.blobs.set(asset.originalKey, blobs.original);
    this.blobs.set(asset.displayKey, blobs.display);
    this.blobs.set(asset.thumbnailKey, blobs.thumbnail);
  }

  async getAsset(id: string): Promise<Asset> {
    const asset = this.assets.get(id);
    if (!asset) throw new AssetNotFoundError(id);
    return asset;
  }

  async getBlob(key: string): Promise<Blob> {
    const blob = this.blobs.get(key);
    if (!blob) throw new Error(`Asset blob not found: ${key}`);
    return blob;
  }

  async delete(id: string): Promise<void> {
    this.assets.delete(id);
  }
}

// Deterministic substitute for browser image decoding, which jsdom lacks.
export class FakeImageProcessor implements ImageProcessor {
  processedFilenames: string[] = [];

  // Tests can override hashes to model matching or distinct file contents.
  constructor(
    private readonly failingFilenames: ReadonlySet<string> = new Set(),
    private readonly hashForName: ReadonlyMap<string, string> = new Map()
  ) {}

  async process(file: File): Promise<ProcessedImage> {
    this.processedFilenames.push(file.name);

    if (this.failingFilenames.has(file.name)) {
      throw new Error(`${file.name} could not be read as an image.`);
    }

    return {
      widthPx: 100,
      heightPx: 100,
      sha256: this.hashForName.get(file.name) ?? `sha256-${file.name}`,
      byteSize: file.size,
      original: new Blob([`original:${file.name}`]),
      display: new Blob([`display:${file.name}`]),
      thumbnail: new Blob([`thumbnail:${file.name}`])
    };
  }
}

export function makeImageFile(name: string, type = "image/jpeg"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}
