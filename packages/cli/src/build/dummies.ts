import {
  Checker,
  SignatureKind,
  Symbol,
  SymbolFlags,
  Type,
  TypeFlags,
} from "typescript/unstable/async";

/** Returns a dummy JS expression for `type`. */
export async function getDummy(
  checker: Checker,
  type: Type | undefined,
  name: string,
  seen: ReadonlySet<number> = new Set(),
): Promise<string | undefined> {
  if (!type) return undefined;
  if (type.flags & TypeFlags.Boolean) return "true";
  if (type.isLiteralType())
    return typeof type.value === "bigint"
      ? `${type.value}n`
      : JSON.stringify(type.value);
  if (
    type.flags &
    (TypeFlags.StringLike | TypeFlags.AnyOrUnknown | TypeFlags.TypeParameter)
  )
    return JSON.stringify(name);
  if (type.flags & TypeFlags.NumberLike) return "0";
  if (type.flags & TypeFlags.BigIntLike) return "0n";
  if (type.flags & TypeFlags.Null) return "null";
  if (type.flags & TypeFlags.VoidLike) return "undefined";
  if (type.flags & TypeFlags.NonPrimitive) return "{}";

  if (type.isUnionType()) {
    // Unwraps nullable unions (e.g. `boolean | null` to `boolean`).
    const nonNullable = await checker.getNonNullableType(type);
    if (nonNullable && nonNullable.id !== type.id)
      return getDummy(checker, nonNullable, name, seen);
    const members = await type.getTypes();
    const member =
      members.find(
        (member) =>
          member.flags &
          (TypeFlags.StringLiteral |
            TypeFlags.NumberLiteral |
            TypeFlags.BigIntLiteral),
      ) ?? members[0];
    return getDummy(checker, member, name, seen);
  }

  if (seen.has(type.id)) return undefined;
  const nextSeen = new Set(seen).add(type.id);

  if (type.isIntersectionType()) {
    const properties = new Map<string, Symbol>();
    for (const member of await type.getTypes())
      if (member.isObjectType())
        for (const property of await checker.getPropertiesOfType(member))
          properties.set(property.name, property);
    return getObjectDummy(checker, [...properties.values()], nextSeen);
  }

  if (!type.isObjectType()) return undefined;

  if (
    (await checker.getSignaturesOfType(type, SignatureKind.Call)).length > 0 ||
    (await checker.getSignaturesOfType(type, SignatureKind.Construct)).length >
      0
  )
    return "() => {}";

  if (type.isTypeReference() && (await checker.isArrayType(type))) {
    const [element] = await checker.getTypeArguments(type);
    const value =
      element && !(element.flags & TypeFlags.AnyOrUnknown)
        ? await getDummy(checker, element, name, nextSeen)
        : undefined;
    return value === undefined ? "[]" : `[${value}]`;
  }

  if (type.isTypeReference() && (await checker.isTupleType(type))) {
    const values = await Promise.all(
      (await checker.getTypeArguments(type)).map((element) =>
        getDummy(checker, element, name, nextSeen),
      ),
    );
    return values.includes(undefined) ? undefined : `[${values.join(", ")}]`;
  }

  const symbol = await type.getSymbol();
  // Built-in classes that can be constructed without arguments.
  if (
    symbol &&
    ["Date", "Map", "Set", "WeakMap", "WeakSet"].includes(symbol.name)
  )
    return `new ${symbol.name}()`;

  const properties = await checker.getPropertiesOfType(type);
  // Library classes and interfaces with required members can't be faked.
  if (
    properties.some((property) => !(property.flags & SymbolFlags.Optional)) &&
    symbol &&
    symbol.flags & (SymbolFlags.Class | SymbolFlags.Interface) &&
    symbol.declarations.every((declaration) =>
      declaration.path.includes("/node_modules/"),
    )
  )
    return undefined;

  return getObjectDummy(checker, properties, nextSeen);
}

async function getObjectDummy(
  checker: Checker,
  properties: readonly Symbol[],
  seen: ReadonlySet<number>,
): Promise<string | undefined> {
  const required = properties.filter(
    (property) => !(property.flags & SymbolFlags.Optional),
  );
  if (required.length === 0) return "{}";

  const types = await checker.getTypeOfSymbol(required);
  const entries: string[] = [];
  for (const [index, property] of required.entries()) {
    const value = await getDummy(checker, types[index], property.name, seen);
    if (value === undefined) return undefined;
    const key = /^[A-Za-z_$][\w$]*$/.test(property.name)
      ? property.name
      : JSON.stringify(property.name);
    entries.push(`${key}: ${value}`);
  }
  return `{ ${entries.join(", ")} }`;
}
