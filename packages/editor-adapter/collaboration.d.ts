export function mergeXml(
  base: string,
  local: string,
  remote: string,
  Parser?: any,
  Serializer?: any,
  conditional?: boolean,
): { xml: string; conflicts: string[] };
export function equivalentXml(a: string, b: string, Parser?: any): boolean;
