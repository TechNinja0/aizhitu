export type PersonalTemplate = {
  kind: "personal";
  id: string;
  name: string;
  description: string;
  category: "architecture" | "flow" | "data" | "planning";
  tags: string[];
  preview: string;
  nodeCount: number;
  edgeCount: number;
  updatedAt: number;
};
