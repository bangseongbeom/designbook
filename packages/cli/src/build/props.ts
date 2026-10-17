import {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  isArrayTypeNode,
  isArrowFunction,
  isCallExpression,
  isConstructorTypeNode,
  isExportAssignment,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionTypeNode,
  isIntersectionTypeNode,
  isObjectBindingPattern,
  isPropertyNameLiteral,
  isTupleTypeNode,
  isTypeLiteralNode,
  isUnionTypeNode,
  isVariableDeclaration,
  Node,
  SyntaxKind,
  TypeNode,
} from "typescript/unstable/ast";
import { createUnionTypeNode } from "typescript/unstable/ast/factory";
import {
  Emitter,
  Project,
  Signature,
  SymbolFlags,
  Type,
} from "typescript/unstable/async";
import { getDummy } from "./dummies.js";

export interface PropInfo {
  name: string;
  /** Short form of the type, e.g. `union`. */
  type: string;
  /** Full form of the type, e.g. `"sm" | "lg"`. */
  typeDescription: string;
  required?: boolean;
  description?: string;
  default?: string;
  deprecated?: boolean;
  /** JS expression of a dummy value for the prop type. Only set for required props. */
  dummy?: string;
}

export async function getProps(
  project: Project,
  signature: Signature,
  declaration: Node | undefined,
): Promise<PropInfo[]> {
  const { checker } = project;
  const type =
    signature.parameters.length > 0
      ? await checker.getParameterType(signature, 0)
      : undefined;
  const propertySymbols = (
    type ? await checker.getPropertiesOfType(type) : []
  ).filter(
    // Skip optional props inherited from libraries (e.g. DOM attributes from `@types/react`).
    (propertySymbol) =>
      !(propertySymbol.flags & SymbolFlags.Optional) ||
      propertySymbol.declarations.some(
        (declaration) => !declaration.path.includes("/node_modules/"),
      ),
  );
  const types = await checker.getTypeOfSymbol(propertySymbols);
  const defaults = getPropDefaults(declaration);

  return Promise.all(
    propertySymbols.map(async (propertySymbol, index) => {
      const optional = (propertySymbol.flags & SymbolFlags.Optional) !== 0;
      const propertyType = types[index];
      const tags = await checker.getJsDocTagsOfSymbol(propertySymbol);
      const description =
        await checker.getDocumentationCommentOfSymbol(propertySymbol);
      const prop: PropInfo = {
        name: propertySymbol.name,
        ...(await formatType(project, propertyType, optional)),
      };

      if (!optional) {
        prop.required = true;
        const dummy = await getDummy(
          checker,
          propertyType,
          propertySymbol.name,
        );
        if (dummy !== undefined) prop.dummy = dummy;
      }

      if (description) prop.description = description;

      const defaultValue =
        defaults.get(propertySymbol.name) ??
        tags.find((tag) => tag.name === "default")?.text;
      if (defaultValue) prop.default = defaultValue;

      if (tags.some((tag) => tag.name === "deprecated")) prop.deprecated = true;

      return prop;
    }),
  );
}

async function formatType(
  { checker, emitter }: Project,
  type: Type | undefined,
  optional: boolean,
): Promise<Pick<PropInfo, "type" | "typeDescription">> {
  if (!type) return { type: "unknown", typeDescription: "unknown" };
  let node = await checker.typeToTypeNode(type);
  if (!node) {
    const text = await checker.typeToString(type);
    return { type: text, typeDescription: text };
  }
  if (optional && isUnionTypeNode(node)) {
    const types = node.types.filter(
      (member) => member.kind !== SyntaxKind.UndefinedKeyword,
    );
    node = types.length > 1 ? createUnionTypeNode(types) : (types[0] ?? node);
  }
  return {
    type: await simplifyTypeNode(emitter, node),
    typeDescription: await emitter.printNode(node),
  };
}

async function simplifyTypeNode(
  emitter: Emitter,
  node: TypeNode,
): Promise<string> {
  if (isUnionTypeNode(node)) return "union";
  if (isIntersectionTypeNode(node)) {
    const members = await Promise.all(
      node.types.map((member) => simplifyTypeNode(emitter, member)),
    );
    return [...new Set(members)].join(" & ");
  }
  if (isFunctionTypeNode(node) || isConstructorTypeNode(node))
    return "function";
  if (isTypeLiteralNode(node)) return "object";
  if (isArrayTypeNode(node)) return "array";
  if (isTupleTypeNode(node)) return "tuple";
  return emitter.printNode(node);
}

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

function findFunction(node: Node): FunctionLike | undefined {
  if (
    isFunctionDeclaration(node) ||
    isArrowFunction(node) ||
    isFunctionExpression(node)
  )
    return node;
  if (isVariableDeclaration(node) && node.initializer)
    return findFunction(node.initializer);
  if (isExportAssignment(node)) return findFunction(node.expression);
  // `memo(...)`, `forwardRef(...)`.
  if (isCallExpression(node))
    for (const argument of node.arguments) {
      const fn = findFunction(argument);
      if (fn) return fn;
    }
  return undefined;
}

/** Reads defaults like `variant = "default"` from `function Button({ variant = "default" })`. */
function getPropDefaults(declaration: Node | undefined): Map<string, string> {
  const defaults = new Map<string, string>();
  const parameter = declaration && findFunction(declaration)?.parameters[0];
  if (!parameter || !isObjectBindingPattern(parameter.name)) return defaults;

  for (const element of parameter.name.elements) {
    const key = element.propertyName ?? element.name;
    if (
      element.dotDotDotToken ||
      !element.initializer ||
      !key ||
      !isPropertyNameLiteral(key)
    )
      continue;
    defaults.set(key.text, element.initializer.getText());
  }

  return defaults;
}
