export type ReviewItem = {
  id: string;
  objectId?: string;
  kind: "text" | "relationship" | "shape" | "region";
  message: string;
  sourceRect?: { x: number; y: number; width: number; height: number };
  status: "needsReview" | "confirmed";
  reviewedContentHash?: string;
};
export type Metadata = {
  profileVersion: string;
  documentId: string;
  generationMode: "faithful" | "relayout" | "manual";
  reviewItems: ReviewItem[];
  source?: { sha256: string; width: number; height: number };
  provenance?: Record<string, string>;
};
export type Diagnostic = {
  code: string;
  severity: "error" | "warning";
  objectId?: string;
  path?: string;
  message: string;
  repairHint?: string;
};
export type CellSnapshot = {
  id: string;
  parent: string;
  kind: "node" | "edge" | "root" | "layer";
  label: string;
  style: string;
  source?: string;
  target?: string;
  role?: string;
  geometry: Record<string, string>;
};
export type Validation = {
  ok: boolean;
  profileVersion: string;
  fileHash: string;
  contentHash: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  stats: { nodes: number; edges: number; cells: number };
  xml?: string;
  metadata?: Metadata;
  cells?: CellSnapshot[];
};
export const LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  xmlBytes: 50 * 1024 * 1024,
  objects: 1000,
  cells: 3000,
  xmlDepth: 64,
  groupDepth: 10,
  metadataBytes: 1024 * 1024,
  reviewItems: 2000,
  imageBytes: 12 * 1024 * 1024,
  singlePixels: 16_000_000,
  totalPixels: 32_000_000,
  pngSide: 8192,
  pngPixels: 32_000_000,
  pdfSide: 14400,
} as const;
export const PROFILE = "1.0";
export const FONT = "Noto Sans SC";
