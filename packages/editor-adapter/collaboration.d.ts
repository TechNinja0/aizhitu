export function mergeXml(
  base: string,
  local: string,
  remote: string,
  Parser?: any,
  Serializer?: any,
  conditional?: boolean,
): { xml: string; conflicts: string[] };
export function equivalentXml(a: string, b: string, Parser?: any): boolean;

export function limitHistory(
  recent: Array<{ before: string; after: string }>,
  other: Array<{ before: string; after: string }>,
  maxBytes?: number,
  maxCount?: number,
): void;
