import {
  templateXml,
  templateSvg,
  templates,
  type DiagramTemplate,
} from "../../../packages/diagram-templates";
import type { PersonalTemplate } from "../../../packages/diagram-templates/personal";
import type { Metadata } from "../../../packages/document-core/types";
import { workspaceApi } from "./SharedWorkspace";
export type TemplateChoice = DiagramTemplate | PersonalTemplate;
export const isPersonal = (
  template: TemplateChoice,
): template is PersonalTemplate =>
  "kind" in template && template.kind === "personal";
const previews = new Map(
  templates.map((t) => [
    t.id,
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(templateSvg(t))}`,
  ]),
);
export const previewFor = (t: TemplateChoice) =>
  isPersonal(t) ? t.preview : previews.get(t.id);
export const countsFor = (t: TemplateChoice) =>
  isPersonal(t)
    ? { nodes: t.nodeCount, edges: t.edgeCount }
    : { nodes: t.nodes.length, edges: t.edges.length };
export async function resolveTemplateXml(
  template: TemplateChoice | null,
  title: string,
  metadata?: Metadata,
): Promise<string> {
  if (!template || !isPersonal(template))
    return templateXml(template, title, metadata);
  return (
    await workspaceApi(`templates/${template.id}/instantiate`, {
      title,
      metadata,
    })
  ).xml;
}
