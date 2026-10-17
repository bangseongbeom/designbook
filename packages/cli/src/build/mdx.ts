import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import MagicString from "magic-string";
import { fromMarkdown } from "mdast-util-from-markdown";
import { codeToHtml } from "shiki";
import { ComponentInfo } from "./components.js";
import { ComponentDoc } from "./index.js";
import { PropInfo } from "./props.js";

const startMarker = "{/* designbook-start */}";
const endMarker = "{/* designbook-end */}";

export type WriteStatus = "created" | "updated" | "unchanged" | "skipped";

/** Creates the MDX file, or replaces only its generated block. */
export async function writeMDX(doc: ComponentDoc): Promise<WriteStatus> {
  const block = await renderBlock(doc);

  let source: string;
  try {
    source = await readFile(doc.mdxPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await mkdir(dirname(doc.mdxPath), { recursive: true });
      await writeFile(doc.mdxPath, `${renderFrontmatter(doc)}\n\n${block}\n`);
      return "created";
    } else throw error;
  }

  const start = source.indexOf(startMarker);
  const endMarkerIndex = start === -1 ? -1 : source.indexOf(endMarker, start);
  // Without both markers, the file is the user's to maintain.
  if (endMarkerIndex === -1) return "skipped";
  const end = endMarkerIndex + endMarker.length;

  const updated = new MagicString(source)
    .overwrite(start, end, block)
    .toString();
  if (updated === source) return "unchanged";

  await writeFile(doc.mdxPath, updated);
  return "updated";
}

function renderFrontmatter(doc: ComponentDoc): string {
  const primary = getPrimaryComponent(doc);
  const lines = [
    "---",
    `title: ${JSON.stringify(toStartCase(primary.exportName))}`,
  ];
  const description = primary.description?.split("\n")[0]?.trim();
  if (description) lines.push(`description: ${JSON.stringify(description)}`);
  lines.push("---");
  return lines.join("\n");
}

/** Renders the generated block, from `startMarker` to `endMarker`. */
async function renderBlock(doc: ComponentDoc): Promise<string> {
  const lines = [startMarker, ""];

  const designbookImports: string[] = [];
  if (doc.components.some(canPreview))
    designbookImports.push("DesignbookPreview");
  if (doc.components.some((component) => component.props.length > 0))
    designbookImports.push("DesignbookTypeTable");
  if (designbookImports.length > 0)
    lines.push(
      `import { ${designbookImports.join(", ")} } from "@designbook/fumadocs";`,
    );
  lines.push(
    `import ${renderImportClause(doc.components)} from ${JSON.stringify(doc.relativeSpecifier)};`,
    "",
  );

  for (const component of doc.components)
    lines.push(...(await renderComponentSection(doc, component)));

  lines.push(endMarker);
  return lines.join("\n");
}

/** The default export, or the first component. */
function getPrimaryComponent(doc: ComponentDoc): ComponentInfo {
  const [first] = doc.components;
  if (!first) throw new Error(`No components in ${doc.sourceFileName}`);
  return doc.components.find((component) => component.isDefault) ?? first;
}

/** Splits an identifier into capitalized words (e.g. `HTMLInputField` to `HTML Input Field`). */
function toStartCase(name: string): string {
  return name
    .replace(/(?<=[a-z\d])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ")
    .split(/[\s_$]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function renderImportClause(components: ComponentInfo[]): string {
  const defaultComponent = components.find((component) => component.isDefault);
  const named = components
    .filter((component) => !component.isDefault)
    .map((component) => component.exportName);

  return [
    defaultComponent?.exportName,
    named.length > 0 ? `{ ${named.join(", ")} }` : undefined,
  ]
    .filter((clause) => clause !== undefined)
    .join(", ");
}

async function renderComponentSection(
  doc: ComponentDoc,
  component: ComponentInfo,
): Promise<string[]> {
  const { exportName } = component;
  const lines = [`## ${exportName}`, ""];

  if (component.description) lines.push(escapeMDX(component.description), "");

  if (component.examples.length > 0)
    for (const example of component.examples)
      lines.push(...renderExample(doc, component, example));
  else {
    const requiredProps = getRequiredProps(component);
    const children = component.props.find(
      (prop) => prop.name === "children" && prop.required,
    );

    if (canPreview(component)) {
      // An expression keeps MDX from parsing the text as Markdown.
      const previewChildren =
        children?.dummy === undefined ? undefined : `{${children.dummy}}`;
      lines.push(
        "<DesignbookPreview>",
        `  ${renderElement(exportName, requiredProps, previewChildren)}`,
        "</DesignbookPreview>",
        "",
      );
    }

    lines.push(
      ...renderCodeBlock(
        doc,
        component,
        renderElement(
          exportName,
          requiredProps,
          children && renderChildren(children),
        ),
      ),
    );
  }

  if (component.props.length > 0)
    lines.push(await renderTypeTable(component.props), "");

  return lines;
}

/** Renders an `@example` with a preview. Non-JSX code blocks aren't previewed, and an example without a code fence is a single `tsx` block. */
function renderExample(
  doc: ComponentDoc,
  component: ComponentInfo,
  text: string,
): string[] {
  const caption = /^<caption>(.*?)<\/caption>\s*\n/.exec(text);
  const body = caption ? text.slice(caption[0].length) : text;
  const markdown =
    (caption ? `${caption[1]}\n\n` : "") +
    (/^\s*[`~]{3}/m.test(body) ? body : "```tsx\n" + body + "\n```");

  return fromMarkdown(markdown).children.flatMap((node) => {
    const raw = markdown.slice(
      node.position?.start.offset,
      node.position?.end.offset,
    );
    if (node.type !== "code") return [escapeMDX(raw), ""];
    if (node.lang && !["tsx", "jsx"].includes(node.lang)) return [raw, ""];

    const code = node.value;
    return [
      "<DesignbookPreview>",
      // A fragment expression keeps MDX from parsing the JSX as Markdown.
      "  {<>",
      // Indents each line, except blank ones to avoid trailing whitespace.
      ...code.split("\n").map((line) => (line === "" ? line : `    ${line}`)),
      "  </>}",
      "</DesignbookPreview>",
      "",
      ...renderCodeBlock(doc, component, code),
    ];
  });
}

/** Required props excluding `children`, which is passed as element children. */
function getRequiredProps(component: ComponentInfo): PropInfo[] {
  return component.props.filter(
    (prop) => prop.required && prop.name !== "children",
  );
}

function canPreview(component: ComponentInfo): boolean {
  return (
    component.examples.length > 0 ||
    component.props.every((prop) => !prop.required || prop.dummy !== undefined)
  );
}

function renderCodeBlock(
  doc: ComponentDoc,
  component: ComponentInfo,
  code: string,
): string[] {
  const components = getComponentsToImport(doc, component, code);
  return [
    "```tsx",
    `import ${renderImportClause(components)} from ${JSON.stringify(doc.displaySpecifier)};`,
    "",
    code,
    "```",
    "",
  ];
}

/** Returns the target component, and the others used in the code. */
function getComponentsToImport(
  doc: ComponentDoc,
  targetComponent: ComponentInfo,
  code: string,
): ComponentInfo[] {
  const words = new Set(code.match(/[\w$]+/g));
  return doc.components.filter(
    (component) =>
      component === targetComponent || words.has(component.exportName),
  );
}

function renderElement(
  name: string,
  requiredProps: PropInfo[],
  children: string | undefined,
): string {
  const attributes = requiredProps
    .map((prop) => ` ${renderAttribute(prop)}`)
    .join("");
  return children === undefined
    ? `<${name}${attributes} />`
    : `<${name}${attributes}>${children}</${name}>`;
}

/** Renders the dummy as an attribute, or a placeholder if there's no dummy. */
function renderAttribute({ name, dummy }: PropInfo): string {
  // `data-node` -> `data-node={dataNode}`
  if (dummy === undefined) return `${name}={${toCamelCase(name)}}`;
  // `"a\nb"` -> `"a\\nb"`
  // `"&lt;"` -> `"<"`
  return /^"[^"\\&]*"$/.test(dummy) ? `${name}=${dummy}` : `${name}={${dummy}}`;
}

function toCamelCase(name: string): string {
  return name.replace(/-(\w)/g, (_, char: string) => char.toUpperCase());
}

/** Renders the dummy as JSX children, or a placeholder if there's no dummy. */
function renderChildren({ dummy }: PropInfo): string {
  if (dummy === undefined) return "{children}";
  // `"{x}"` -> `x`
  // `"&lt;"` -> `"<"`
  return /^"[^"\\&{}<>]*"$/.test(dummy)
    ? (JSON.parse(dummy) as string)
    : `{${dummy}}`;
}

/** Renders the type table, with its code highlighted at build time. */
async function renderTypeTable(props: PropInfo[]): Promise<string> {
  const entries = await Promise.all(
    props.map(async ({ name, ...prop }) => [
      name,
      {
        ...prop,
        type: await highlightCode(prop.type),
        typeDescription: await highlightCode(prop.typeDescription),
        default: prop.default && (await highlightCode(prop.default)),
      },
    ]),
  );
  const type = JSON.stringify(Object.fromEntries(entries), null, 2);
  // `client:load` is for Astro. Without it, the table's rows can't be expanded.
  return `<DesignbookTypeTable client:load type={${type}} />`;
}

function highlightCode(code: string): Promise<string> {
  return codeToHtml(code, {
    lang: "ts",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    structure: "inline",
  });
}

/** Escapes characters MDX would parse as JSX or expressions, outside code spans. */
function escapeMDX(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/[{}<]/g, (char) => `\\${char}`),
    )
    .join("");
}
