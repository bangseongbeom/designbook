import { basename, extname } from "node:path";
import {
  isClassDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isVariableDeclaration,
  Node,
  SourceFile,
} from "typescript/unstable/ast";
import {
  Checker,
  Project,
  Signature,
  SignatureKind,
  Symbol,
  SymbolFlags,
  Type,
} from "typescript/unstable/async";
import { getProps, PropInfo } from "./props.js";

export interface ComponentInfo {
  exportName: string;
  isDefault: boolean;
  description?: string;
  examples: string[];
  props: PropInfo[];
}

/** Returns the components exported from the source file. */
export async function getComponents(
  project: Project,
  sourceFile: SourceFile,
): Promise<ComponentInfo[]> {
  const { checker } = project;
  const moduleSymbol = await checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return [];

  const components: ComponentInfo[] = [];

  for (const exportSymbol of await checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exportSymbol.flags & SymbolFlags.Alias
        ? await checker.getAliasedSymbol(exportSymbol)
        : exportSymbol;
    // Skip type-only symbols and re-exports from other files.
    if (!(symbol.flags & SymbolFlags.Value)) continue;
    if (symbol.valueDeclaration?.path !== sourceFile.path) continue;

    const declaration = await symbol.valueDeclaration.resolve(project);
    const isDefault = exportSymbol.name === "default";
    const exportName = isDefault
      ? (getDeclarationName(declaration) ??
        toPascalCase(
          basename(sourceFile.fileName, extname(sourceFile.fileName)),
        ))
      : exportSymbol.name;
    // Components are capitalized, unlike other functions.
    if (!/^[A-Z]/.test(exportName)) continue;

    const signature = await getComponentSignature(checker, symbol);
    if (!signature) continue;

    const tags = await checker.getJsDocTagsOfSymbol(symbol);
    const component: ComponentInfo = {
      exportName,
      isDefault,
      examples: tags.flatMap((tag) =>
        tag.name === "example" && tag.text ? [tag.text] : [],
      ),
      props: await getProps(project, signature, declaration),
    };
    const description = await checker.getDocumentationCommentOfSymbol(symbol);
    if (description) component.description = description;

    components.push(component);
  }

  return components;
}

function toPascalCase(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function getDeclarationName(declaration: Node | undefined): string | undefined {
  if (
    declaration &&
    (isFunctionDeclaration(declaration) ||
      isClassDeclaration(declaration) ||
      isVariableDeclaration(declaration)) &&
    declaration.name &&
    isIdentifier(declaration.name)
  )
    return declaration.name.text;
}

async function getComponentSignature(
  checker: Checker,
  symbol: Symbol,
): Promise<Signature | undefined> {
  const type = await checker.getTypeOfSymbol(symbol);
  if (!type) return undefined;

  return (
    (await getFunctionComponentSignature(checker, type)) ??
    (await getClassComponentSignature(checker, type))
  );
}

async function getFunctionComponentSignature(
  checker: Checker,
  type: Type,
): Promise<Signature | undefined> {
  const [signature] = await checker.getSignaturesOfType(
    type,
    SignatureKind.Call,
  );
  return signature;
}

async function getClassComponentSignature(
  checker: Checker,
  type: Type,
): Promise<Signature | undefined> {
  for (const signature of await checker.getSignaturesOfType(
    type,
    SignatureKind.Construct,
  )) {
    const instanceType = await checker.getReturnTypeOfSignature(signature);
    if (
      instanceType &&
      (await checker.getPropertyOfType(instanceType, "render")) &&
      (await checker.getPropertyOfType(instanceType, "props"))
    )
      return signature;
  }

  return undefined;
}
