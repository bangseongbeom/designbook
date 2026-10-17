import { TypeNode, TypeTable } from "fumadocs-ui/components/type-table";
import { ReactNode } from "react";

/** This interface is needed because the code is highlighted at build time as HTML strings, not `ReactNode`s. */
interface DesignbookTypeNode extends TypeNode {
  type: string;
  typeDescription?: string;
  default?: string;
}

/** Renders a type table. The highlighting must be done at build time. */
export function DesignbookTypeTable({
  type,
}: {
  type: Record<string, DesignbookTypeNode>;
}): ReactNode {
  return (
    <TypeTable
      type={Object.fromEntries(
        Object.entries(type).map(([name, node]) => [
          name,
          {
            ...node,
            type: <Code html={node.type} />,
            typeDescription: node.typeDescription && (
              <Code html={node.typeDescription} />
            ),
            default: node.default && <Code html={node.default} />,
          },
        ]),
      )}
    />
  );
}

function Code({ html }: { html: string }): ReactNode {
  return (
    <span className="shiki whitespace-pre-wrap">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}
