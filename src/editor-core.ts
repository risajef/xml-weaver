import { XMLParser, XMLValidator } from "fast-xml-parser";

export enum SimpleBase {
  String = "string",
  Boolean = "boolean",
  Number = "number",
}

export enum ValueTypeKind {
  Simple = "simple",
  Complex = "complex",
}

export enum ParticleKind {
  Element = "element",
  Sequence = "sequence",
  Choice = "choice",
}

export enum AttributeUse {
  Required = "required",
  Optional = "optional",
}

export enum ProblemCode {
  Placeholder = "placeholder",
  UnknownElement = "unknown-element",
  Namespace = "namespace",
  SchemaUnavailable = "schema-unavailable",
  UnexpectedAttribute = "unexpected-attribute",
  InvalidAttributeValue = "invalid-attribute-value",
  MissingRequiredAttribute = "missing-required-attribute",
  InvalidText = "invalid-text",
  UnexpectedText = "unexpected-text",
  UnexpectedChild = "unexpected-child",
  MissingRequiredChild = "missing-required-child",
}

export enum VisibleItemType {
  Node = "node",
  Attribute = "attribute",
  Text = "text",
}

export enum LookupKind {
  Attribute = "attribute",
  Text = "text",
}

export enum ReplacementMode {
  Edit = "edit",
  Migration = "migration",
}

const SCHEMA_CONTEXT = Symbol("schema-context");
const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";
const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";
interface SchemaContext {
  namespaces: Record<string, string>;
  target: string;
  elementForm: string;
  attributeForm: string;
  global: boolean;
}
const ORDERED_CHILDREN = Symbol("ordered-schema-children");
type XmlRecord = Record<string, unknown> & { [SCHEMA_CONTEXT]?: SchemaContext; [ORDERED_CHILDREN]?: [string, unknown][] };

function schemaRecord(entries: unknown): XmlRecord {
  const result: XmlRecord = {};
  result[ORDERED_CHILDREN] = [];
  if (!Array.isArray(entries)) return result;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    for (const [name, payload] of Object.entries(entry)) {
      if (name === ":@") continue;
      const child = name === "#text" ? payload : Object.assign(schemaRecord(payload), isRecord(entry[":@"]) ? entry[":@"] : {});
      result[ORDERED_CHILDREN].push([name, child]);
      if (result[name] === undefined) result[name] = child;
      else result[name] = arrayify(result[name]).concat([child]);
    }
  }
  return result;
}

export interface SimpleTypeDefinition {
  kind: ValueTypeKind.Simple;
  base: SimpleBase;
  builtin?: string;
  enumerations: string[];
}

export interface AttributeDefinition {
  namespaceUri?: string;
  name: string;
  use: AttributeUse;
  valueType: SimpleTypeDefinition;
}

export interface ElementDefinition {
  namespaceUri?: string;
  kind: ParticleKind.Element;
  name: string;
  refName: string | null;
  type: ResolvedType | null;
  typeName: string | null;
  minOccurs: number;
  maxOccurs: number;
}

export interface SequenceParticle {
  kind: ParticleKind.Sequence;
  items: Particle[];
  minOccurs: number;
  maxOccurs: number;
}

export interface ChoiceParticle {
  kind: ParticleKind.Choice;
  items: Particle[];
  minOccurs: number;
  maxOccurs: number;
}

export type Particle = ElementDefinition | SequenceParticle | ChoiceParticle;

export interface ComplexTypeDefinition {
  kind: ValueTypeKind.Complex;
  attributes: AttributeDefinition[];
  content: Particle | null;
  textType: SimpleTypeDefinition | null;
}

export type ResolvedType = SimpleTypeDefinition | ComplexTypeDefinition;

export interface SchemaModel {
  targetNamespace: string;
  elements: Map<string, ElementDefinition>;
  simpleTypes: Map<string, SimpleTypeDefinition>;
  complexTypes: Map<string, ComplexTypeDefinition>;
  rootElements: string[];
  sourceText: string;
}

export interface AttributeNode {
  id: string;
  name: string;
  value: string;
  placeholder: boolean;
  expectedValues: string[];
}

export interface ElementNode {
  /** Lexical QName retained independently of the editor's local-name label. */
  qualifiedName?: string;
  /** Text following this element in its parent's ordered content. */
  tail?: string;
  id: string;
  name: string;
  attributes: AttributeNode[];
  children: ElementNode[];
  text: string;
  textPlaceholder: boolean;
  collapsed: boolean;
  placeholder: boolean;
  allowedNames: string[];
}

export interface NodeInfo {
  elementDef: ElementDefinition | null;
  parentId: string | null;
  type: ResolvedType | null;
  allowedAttributes: string[];
  allowedChildren: string[];
  problem?: ProblemCode;
}

export interface AttributeInfo {
  attributeDef: AttributeDefinition | null;
  nodeId: string;
}

export interface AnalysisProblem {
  code: ProblemCode;
  nodeId: string;
  message: string;
  attrId?: string;
}

export interface AnalysisResult {
  problems: AnalysisProblem[];
  nodeInfoById: Map<string, NodeInfo>;
  attributeInfoById: Map<string, AttributeInfo>;
}

export interface ParsedXmlDocument {
  root: ElementNode;
  schemaReferences: string[];
}

export interface AttributeLookupResult {
  kind: LookupKind.Attribute;
  node: ElementNode;
  attribute: AttributeNode;
}

export interface TextLookupResult {
  kind: LookupKind.Text;
  node: ElementNode;
}

export type FindNodeResult = ElementNode | AttributeLookupResult | TextLookupResult | null;

export interface ReplacementCandidate {
  name: string;
  label: string;
  detail: string;
  elementDef: ElementDefinition;
}

export interface VisibleNodeItem {
  id: string;
  type: VisibleItemType.Node;
  depth: number;
  nodeId: string;
}

export interface VisibleAttributeItem {
  id: string;
  type: VisibleItemType.Attribute;
  depth: number;
  nodeId: string;
  attributeId: string;
}

export interface VisibleTextItem {
  id: string;
  type: VisibleItemType.Text;
  depth: number;
  nodeId: string;
}

export type VisibleTreeItem = VisibleNodeItem | VisibleAttributeItem | VisibleTextItem;

export interface FuzzyOption {
  label: string;
  detail?: string;
}

interface Registry {
  simpleSources: Map<string, XmlRecord>;
  resolving: Set<string>;
  simpleTypes: Map<string, SimpleTypeDefinition>;
  complexTypes: Map<string, ComplexTypeDefinition>;
  elements: Map<string, ElementDefinition>;
}

interface MatchAssignment {
  childIndex: number;
  elementDef: ElementDefinition | null;
}

interface MatchResult {
  index: number;
  assignments: MatchAssignment[];
}

const XML_DOC_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  preserveOrder: true,
  commentPropName: "#comment",
  trimValues: false,
});

const XML_SCHEMA_PARSER = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

let nextId = 1;

function createId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readString(record: XmlRecord, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

function readRecord(record: XmlRecord, key: string): XmlRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function recordEntries(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : [];
}

export function arrayify<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? [...value] : [value];
}

export function localName(tagName = ""): string {
  return String(tagName).replace(/^@_/, "").split(":").pop() ?? "";
}

function firstEntry(node: XmlRecord): [string, unknown] | undefined {
  return Object.entries(node).find(([key]) => key !== ":@" && key !== "#text");
}

const BUILTIN_TYPES = new Set(["string", "boolean", "int", "integer", "decimal", "float", "double", "long", "short"]);

export function resolveBuiltinSimpleType(typeName?: string | null): SimpleTypeDefinition {
  const builtin = localName(typeName ?? "string");
  if (!BUILTIN_TYPES.has(builtin)) throw new Error(`Unsupported or unresolved type: ${typeName}`);
  const base = builtin === "string" ? SimpleBase.String : builtin === "boolean" ? SimpleBase.Boolean : SimpleBase.Number;
  return { kind: ValueTypeKind.Simple, base, builtin, enumerations: [] };
}

function createAttributeNode(name: string, value = "", options: Partial<AttributeNode> = {}): AttributeNode {
  return {
    id: createId("attr"),
    name,
    value,
    placeholder: Boolean(options.placeholder),
    expectedValues: options.expectedValues ? [...options.expectedValues] : [],
  };
}

export function isSchemaInfrastructureAttribute(name = ""): boolean {
  return name === "xmlns"
    || name.startsWith("xmlns:")
    || name === "xsi:schemaLocation"
    || name === "xsi:noNamespaceSchemaLocation";
}

export function createElementNode(name: string, options: Partial<ElementNode> = {}): ElementNode {
  return {
    id: createId("node"),
    name,
    attributes: options.attributes ? options.attributes.map((attribute) => clone(attribute)) : [],
    children: options.children ? options.children.map((child) => clone(child)) : [],
    text: options.text ?? "",
    textPlaceholder: Boolean(options.textPlaceholder),
    collapsed: Boolean(options.collapsed),
    placeholder: Boolean(options.placeholder),
    allowedNames: options.allowedNames ? [...options.allowedNames] : [],
  };
}

function findNamedChild(node: XmlRecord, tagName: string): unknown {
  const entries = Object.entries(node).filter(([key]) => !key.startsWith("@_"));
  return entries.find(([key]) => localName(key) === tagName)?.[1];
}

function parseEnumerationValues(node: XmlRecord): string[] {
  return arrayify(findNamedChild(node, "enumeration"))
    .flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }
      const value = readString(entry, "@_value");
      return value !== undefined ? [value] : [];
    });
}

function parseSimpleType(node: XmlRecord, registry: Registry): SimpleTypeDefinition {
  const restriction = findNamedChild(node, "restriction");
  if (!isRecord(restriction)) {
    return { kind: ValueTypeKind.Simple, base: SimpleBase.String, enumerations: [] };
  }

  const baseName = readString(restriction, "@_base") ?? SimpleBase.String;
  const inherited = resolveDeclaredSimple(restriction, baseName, registry);
  const enumerations = parseEnumerationValues(restriction);
  for (const value of enumerations) {
    if (validateSimpleValue(inherited, value)) throw new Error(`Invalid enumeration restriction value: ${value}`);
  }
  if (enumerations.length) inherited.enumerations = enumerations;
  return inherited;
}

function parseAttribute(node: XmlRecord, registry: Registry): AttributeDefinition {
  const name = readString(node, "@_name") ?? localName(readString(node, "@_ref") ?? "");
  const use = readString(node, "@_use") === AttributeUse.Required ? AttributeUse.Required : AttributeUse.Optional;
  let valueType = resolveBuiltinSimpleType();
  const inlineTypeNode = findNamedChild(node, "simpleType");

  if (isRecord(inlineTypeNode)) {
    valueType = parseSimpleType(inlineTypeNode, registry);
  } else {
    const declaredType = readString(node, "@_type");
    if (declaredType) {
      valueType = resolveDeclaredSimple(node, declaredType, registry);
    }
  }

    const context = node[SCHEMA_CONTEXT];
  return { name, use, valueType, namespaceUri: (readString(node, "@_form") ?? context?.attributeForm) === "qualified" ? context?.target ?? "" : "" };
}

export const INPUT_LIMIT = 1024 * 1024;
export const DRAFT_INPUT_LIMIT = 8 * INPUT_LIMIT;
const NODE_LIMIT = 5000;
const DEPTH_LIMIT = 128;

export function normalizeOccurs(node: XmlRecord): { minOccurs: number; maxOccurs: number } {
  const parse = (raw: string): number => {
    if (!/^\d+$/.test(raw) || Number(raw) > 1000) throw new Error("Occurrence bounds must be integers from 0 to 1000 (or unbounded maxOccurs).");
    return Number(raw);
  };
  const minOccurs = parse(readString(node, "@_minOccurs") ?? "1");
  const rawMax = readString(node, "@_maxOccurs") ?? "1";
  const maxOccurs = rawMax === "unbounded" ? Infinity : parse(rawMax);
  if (minOccurs > maxOccurs) throw new Error("minOccurs exceeds maxOccurs.");
  return { minOccurs, maxOccurs };
}

interface ScaffoldBudget { remaining: number; types: Set<ResolvedType>; }
function scaffoldBudget(): ScaffoldBudget { return { remaining: NODE_LIMIT, types: new Set() }; }

function parseElement(node: XmlRecord, registry: Registry): ElementDefinition {
  const occurs = normalizeOccurs(node);
  const refName = readString(node, "@_ref") ? localName(readString(node, "@_ref") ?? "") : null;
  const name = refName ?? readString(node, "@_name") ?? "unknown";
  const inlineComplex = findNamedChild(node, "complexType");
  const inlineSimple = findNamedChild(node, "simpleType");
  let type: ResolvedType | null = null;
  let typeName: string | null = null;

  if (isRecord(inlineComplex)) {
    type = parseComplexType(inlineComplex, registry);
  } else if (isRecord(inlineSimple)) {
    type = parseSimpleType(inlineSimple, registry);
  } else {
    const declaredType = readString(node, "@_type");
    if (declaredType) {
      const uri = expandedNamespace(declaredType, node[SCHEMA_CONTEXT]?.namespaces ?? {}, false);
      typeName = uri === XSD_NAMESPACE && BUILTIN_TYPES.has(localName(declaredType)) ? `xs:${localName(declaredType)}` : localName(declaredType);
    }
  }

  return {
    kind: ParticleKind.Element,
    namespaceUri: node[SCHEMA_CONTEXT]?.global || (readString(node, "@_form") ?? node[SCHEMA_CONTEXT]?.elementForm) === "qualified" ? node[SCHEMA_CONTEXT]?.target ?? "" : "",
    name,
    refName,
    type,
    typeName,
    ...occurs,
  };
}

function parseParticle(node: XmlRecord, registry: Registry): Particle | null {
  const entry = firstEntry(node);
  if (!entry) {
    return null;
  }

  const [tagName, payloadValue] = entry;
  const normalized = localName(tagName);
  if (!isRecord(payloadValue)) {
    return null;
  }

  if (normalized === ParticleKind.Element) {
    return parseElement(payloadValue, registry);
  }

  if (normalized !== ParticleKind.Sequence && normalized !== ParticleKind.Choice) {
    return null;
  }

  const items: Particle[] = [];
  const occurs = normalizeOccurs(payloadValue);
  for (const [childName, childValue] of (payloadValue[ORDERED_CHILDREN] ?? Object.entries(payloadValue))) {
    if (childName.startsWith("@_")) {
      continue;
    }

    const childTag = localName(childName);
    if (![ParticleKind.Element, ParticleKind.Sequence, ParticleKind.Choice].includes(childTag as ParticleKind)) {
      continue;
    }

    for (const child of arrayify(childValue)) {
      if (!isRecord(child)) {
        continue;
      }

      const item = childTag === ParticleKind.Element
        ? parseElement(child, registry)
        : parseParticle({ [childName]: child }, registry);
      if (item) {
        items.push(item);
      }
    }
  }

  return {
    kind: normalized as ParticleKind.Sequence | ParticleKind.Choice,
    items,
    ...occurs,
  };
}

function parseComplexType(node: XmlRecord, registry: Registry): ComplexTypeDefinition {
  const attributes = arrayify(findNamedChild(node, "attribute"))
    .flatMap((entry) => isRecord(entry) ? [parseAttribute(entry, registry)] : []);
  const sequence = findNamedChild(node, "sequence");
  const choice = findNamedChild(node, "choice");
  const simpleContent = findNamedChild(node, "simpleContent");
  let content: Particle | null = null;
  let textType: SimpleTypeDefinition | null = null;

  if (isRecord(sequence)) {
    content = parseParticle({ sequence }, registry);
  } else if (isRecord(choice)) {
    content = parseParticle({ choice }, registry);
  }

  if (isRecord(simpleContent)) {
    const extension = findNamedChild(simpleContent, "extension") ?? findNamedChild(simpleContent, "restriction");
    if (isRecord(extension)) {
      const base = readString(extension, "@_base") ?? SimpleBase.String;
      textType = resolveDeclaredSimple(extension, base, registry);
      for (const attribute of arrayify(findNamedChild(extension, "attribute"))) {
        if (isRecord(attribute)) {
          attributes.push(parseAttribute(attribute, registry));
        }
      }
    }
  }

  return {
    kind: ValueTypeKind.Complex,
    attributes,
    content,
    textType,
  };
}

function resolveType(schema: SchemaModel, elementDef: ElementDefinition): ResolvedType {
  if (elementDef.type) {
    return elementDef.type;
  }

  if (elementDef.refName) {
    const referenced = schema.elements.get(elementDef.refName);
    if (referenced) {
      return resolveType(schema, referenced);
    }
  }

  if (!elementDef.typeName) {
    return {
      kind: ValueTypeKind.Complex,
      attributes: [],
      content: null,
      textType: null,
    };
  }

  if (elementDef.typeName.startsWith("xs:")) return resolveBuiltinSimpleType(elementDef.typeName);
  const complex = schema.complexTypes.get(elementDef.typeName);
  if (complex) {
    return complex;
  }

  const simple = schema.simpleTypes.get(elementDef.typeName);
  if (simple) {
    return simple;
  }

  throw new Error(`Unsupported or unresolved type: ${elementDef.typeName}`);
}

function getElementDefinition(schema: SchemaModel, elementDef: ElementDefinition | null): ElementDefinition | null {
  if (!elementDef) {
    return null;
  }

  if (elementDef.refName) {
    const referenced = schema.elements.get(elementDef.refName);
    if (!referenced) {
      return null;
    }

    return {
      ...referenced,
      minOccurs: elementDef.minOccurs,
      maxOccurs: elementDef.maxOccurs,
    };
  }

  return elementDef;
}

function getElementNamesFromParticle(particle: Particle | null): string[] {
  if (!particle) {
    return [];
  }

  if (particle.kind === ParticleKind.Element) {
    return [particle.refName ?? particle.name];
  }

  return particle.items.flatMap((item) => getElementNamesFromParticle(item));
}

function collectElementDefinitionsFromParticle(schema: SchemaModel, particle: Particle | null): ElementDefinition[] {
  if (!particle) {
    return [];
  }

  if (particle.kind === ParticleKind.Element) {
    const resolved = getElementDefinition(schema, particle);
    return resolved ? [resolved] : [];
  }

  return particle.items.flatMap((item) => collectElementDefinitionsFromParticle(schema, item));
}

function createMinimalAttribute(attributeDef: AttributeDefinition): AttributeNode {
  return createAttributeNode(attributeDef.name, "", {
    placeholder: true,
    expectedValues: attributeDef.valueType.enumerations,
  });
}

function createPlaceholderNode(allowedNames: string[]): ElementNode {
  return createElementNode("placeholder", {
    placeholder: true,
    allowedNames,
  });
}

function createMinimalNodeForElement(schema: SchemaModel, elementDef: ElementDefinition | null, budget = scaffoldBudget()): ElementNode {
  if (--budget.remaining < 0 || budget.types.size >= DEPTH_LIMIT) throw new Error("Scaffold exceeds tree limits.");
  const resolvedElement = getElementDefinition(schema, elementDef);
  if (!resolvedElement) {
    return createElementNode(elementDef?.name ?? "unknown", { placeholder: true });
  }

  const type = resolveType(schema, resolvedElement);
  if (budget.types.has(type)) throw new Error("Required recursive content has no finite minimal tree. Make a recursive branch optional or use a choice placeholder.");
  const node = createElementNode(resolvedElement.name);
  // Explicit default binding keeps scaffolded names correct under any parent.
  if (resolvedElement.namespaceUri !== undefined) node.attributes.push(createAttributeNode("xmlns", resolvedElement.namespaceUri));

  if (type.kind === ValueTypeKind.Simple) {
    node.textPlaceholder = true;
    return node;
  }

  if (type.textType) {
    node.textPlaceholder = true;
  }

  for (const attributeDef of type.attributes) {
    if (attributeDef.use === AttributeUse.Required) {
      addAttributeFromDefinition(node, attributeDef);
    }
  }

  if (type.content) {
    budget.types.add(type);
    node.children.push(...createMinimalChildrenForParticle(schema, type.content, budget));
    budget.types.delete(type);
  }

  return node;
}

export function createMinimalNodeFromDefinition(schema: SchemaModel, elementDef: ElementDefinition): ElementNode {
  return createMinimalNodeForElement(schema, elementDef);
}

function createMinimalChildrenForParticle(schema: SchemaModel, particle: Particle | null, budget = scaffoldBudget()): ElementNode[] {
  if (!particle) {
    return [];
  }

  const minOccurs = Number.isFinite(particle.minOccurs) ? particle.minOccurs : 0;
  const nodes: ElementNode[] = [];

  for (let occurrenceIndex = 0; occurrenceIndex < minOccurs; occurrenceIndex += 1) {
    if (particle.kind === ParticleKind.Element) {
      nodes.push(createMinimalNodeForElement(schema, particle, budget));
      continue;
    }

    if (particle.kind === ParticleKind.Sequence) {
      for (const item of particle.items) {
        nodes.push(...createMinimalChildrenForParticle(schema, item, budget));
      }
      continue;
    }

    const options = particle.items.flatMap((item) => getElementNamesFromParticle(item));
    if (options.length === 1) {
      nodes.push(...createMinimalChildrenForParticle(schema, particle.items[0] ?? null, budget));
    } else if (options.length > 1) {
      nodes.push(createPlaceholderNode(options));
    }
  }

  return nodes;
}

export function validateSimpleValue(type: SimpleTypeDefinition | null | undefined, value: string | null | undefined): string | null {
  const text = type?.base === SimpleBase.String ? value ?? "" : (value ?? "").trim();
  const builtin = type?.builtin;
  if (type?.base === SimpleBase.Boolean && !["true", "false", "1", "0"].includes(text)) return "Expected a boolean value";
  if (type?.base === SimpleBase.Number) {
    const integer = ["int", "integer", "long", "short"].includes(builtin ?? "");
    const valid = integer ? /^[+-]?\d+$/.test(text)
      : builtin === "decimal" ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)
      : /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|INF|-INF|NaN)$/.test(text);
    if (!valid) return `Expected a numeric value (${builtin ?? "number"})`;
    if (integer && builtin !== "integer") {
      const bounds: Record<string, [bigint, bigint]> = {
        short: [-32768n, 32767n], int: [-2147483648n, 2147483647n], long: [-9223372036854775808n, 9223372036854775807n],
      };
      const [min, max] = bounds[builtin!];
      if (BigInt(text) < min || BigInt(text) > max) return `Value outside ${builtin} range`;
    }
  }
  if (type?.enumerations.length) {
    const canonical = (entry: string): string => {
      if (type.base === SimpleBase.Boolean) return ["1", "true"].includes(entry.trim()) ? "true" : "false";
      if (type.base !== SimpleBase.Number) return entry;
      if (["int", "integer", "long", "short"].includes(builtin ?? "")) return BigInt(entry.trim()).toString();
      if (builtin === "decimal") {
        const negative = entry.trim().startsWith("-");
        const [integer, fraction = ""] = entry.trim().replace(/^[+-]/, "").split(".");
        const digits = (integer.replace(/^0+/, "") || "0") + "." + fraction.replace(/0+$/, "");
        return negative && digits !== "0." ? "-" + digits : digits;
      }
      const trimmed = entry.trim();
      const number = trimmed === "INF" ? Infinity : trimmed === "-INF" ? -Infinity : Number(trimmed);
      return String(builtin === "float" ? Math.fround(number) : number);
    };
    if (!type.enumerations.some((entry) => canonical(entry) === canonical(text))) return `Expected one of: ${type.enumerations.join(", ")}`;
  }
  return null;
}

function enumerateSingleMatch(
  schema: SchemaModel,
  particle: Particle | null,
  children: ElementNode[],
  index: number,
  budget: { steps: number },
): MatchResult[] {
  if (!particle) {
    return [{ index, assignments: [] }];
  }

  if (particle.kind === ParticleKind.Element) {
    const child = children[index];
    const expectedName = particle.refName ?? particle.name;
    const isPlaceholderMatch = child?.placeholder && child.allowedNames.includes(expectedName);
    if (child && (child.name === expectedName || isPlaceholderMatch)) {
      return [{
        index: index + 1,
        assignments: [{ childIndex: index, elementDef: getElementDefinition(schema, particle) }],
      }];
    }

    return [];
  }

  if (particle.kind === ParticleKind.Choice) {
    return particle.items.flatMap((item) => enumerateMatches(schema, item, children, index, budget));
  }

  let states: MatchResult[] = [{ index, assignments: [] }];
  for (const item of particle.items) {
    const nextStates: MatchResult[] = [];
    for (const state of states) {
      for (const result of enumerateMatches(schema, item, children, state.index, budget)) {
        nextStates.push({
          index: result.index,
          assignments: state.assignments.concat(result.assignments),
        });
      }
    }
    states = nextStates;
    if (!states.length) {
      break;
    }
  }

  return states;
}

function enumerateMatches(
  schema: SchemaModel,
  particle: Particle | null,
  children: ElementNode[],
  index = 0,
  budget = { steps: 0 },
): MatchResult[] {
  if (!particle) {
    return [{ index, assignments: [] }];
  }

  const max = Number.isFinite(particle.maxOccurs) ? particle.maxOccurs : Math.max(particle.minOccurs, children.length + 1);
  const results: MatchResult[] = [];
  const singleParticle = { ...particle, minOccurs: 1, maxOccurs: 1 } as Particle;

  const visit = (currentIndex: number, count: number, assignments: MatchAssignment[]): void => {
    if (count >= particle.minOccurs) {
      results.push({ index: currentIndex, assignments });
    }

    if (count >= max) {
      return;
    }

    if (++budget.steps > 10000) throw new Error("Schema matching exceeds work limit. Simplify ambiguous content or split the document.");
    for (const singleResult of enumerateSingleMatch(schema, singleParticle, children, currentIndex, budget)) {
      if (singleResult.index === currentIndex) {
        if (count < particle.minOccurs) visit(currentIndex, particle.minOccurs, assignments.concat(singleResult.assignments));
        continue;
      }

      visit(singleResult.index, count + 1, assignments.concat(singleResult.assignments));
    }
  };

  visit(index, 0, []);
  return results;
}

function describeMissingChild(type: ComplexTypeDefinition | null): string {
  const names = getElementNamesFromParticle(type?.content ?? null);
  return names.length
    ? `Missing a required child. Expected one of: ${[...new Set(names)].join(", ")}`
    : "Missing a required child element";
}

function analyzeChildren(
  schema: SchemaModel,
  node: ElementNode,
  type: ComplexTypeDefinition,
  problems: AnalysisProblem[],
  nodeInfoById: Map<string, NodeInfo>,
): void {
  const children = node.children;
  if (!type.content) {
    for (const child of children) {
      problems.push({
        code: ProblemCode.UnexpectedChild,
        nodeId: child.id,
        message: `Child "${child.name}" is not allowed here.`,
      });
      nodeInfoById.set(child.id, { elementDef: null, parentId: node.id, type: null, allowedAttributes: [], allowedChildren: [], problem: ProblemCode.UnexpectedChild });
    }
    return;
  }

  const matches = enumerateMatches(schema, type.content, children, 0);
  const exact = matches.find((match) => match.index === children.length);
  const best = exact ?? matches.sort((left, right) => right.index - left.index)[0] ?? { index: 0, assignments: [] };

  for (const assignment of best.assignments) {
    const child = children[assignment.childIndex];
    const childType = assignment.elementDef ? resolveType(schema, assignment.elementDef) : null;
    const childComplexType = childType?.kind === ValueTypeKind.Complex ? childType : null;
    nodeInfoById.set(child.id, {
      elementDef: assignment.elementDef,
      parentId: node.id,
      type: childType,
      allowedAttributes: childComplexType ? childComplexType.attributes.map((attribute) => attribute.name) : [],
      allowedChildren: childComplexType ? getElementNamesFromParticle(childComplexType.content) : [],
    });
  }

  for (let index = best.index; index < children.length; index += 1) {
    const child = children[index];
    problems.push({
      code: ProblemCode.UnexpectedChild,
      nodeId: child.id,
      message: `Child "${child.name}" is not allowed at this position.`,
    });
    nodeInfoById.set(child.id, { elementDef: null, parentId: node.id, type: null, allowedAttributes: [], allowedChildren: [], problem: ProblemCode.UnexpectedChild });
  }

  if (!exact) {
    {
      problems.push({
        code: ProblemCode.MissingRequiredChild,
        nodeId: node.id,
        message: describeMissingChild(type),
      });
    }
  }
}

function buildNodeInfo(schema: SchemaModel, elementDef: ElementDefinition | null, parentId: string | null): NodeInfo {
  const type = elementDef ? resolveType(schema, elementDef) : null;
  return {
    elementDef,
    parentId,
    type,
    allowedAttributes: type?.kind === ValueTypeKind.Complex ? type.attributes.map((attribute) => attribute.name) : [],
    allowedChildren: type?.kind === ValueTypeKind.Complex ? getElementNamesFromParticle(type.content) : [],
  };
}

function collectProblemsForNode(
  schema: SchemaModel,
  node: ElementNode,
  elementDef: ElementDefinition | null,
  parentId: string | null,
  results: AnalysisResult,
  inheritedNamespaces: Record<string, string> = { xml: "http://www.w3.org/XML/1998/namespace" },
): void {
  const namespaces = nodeNamespaces(node, inheritedNamespaces);
  const lexicalName = node.qualifiedName?.includes(":") ? node.qualifiedName.split(":")[0] + ":" + node.name : node.name;
  const namespaceUri = expandedNamespace(lexicalName, namespaces, false);
  const { problems, nodeInfoById, attributeInfoById } = results;
  const info = buildNodeInfo(schema, elementDef, parentId);
  nodeInfoById.set(node.id, info);

  if (node.placeholder) {
    problems.push({
      code: ProblemCode.Placeholder,
      nodeId: node.id,
      message: `Placeholder must be replaced before export. Allowed: ${node.allowedNames.join(", ") || "schema-guided element"}`,
    });
    return;
  }

  if (!elementDef) {
    problems.push({
      code: ProblemCode.UnknownElement,
      nodeId: node.id,
      message: `Element "${node.name}" is not declared in the schema.`,
    });
  }

  if (elementDef && namespaceUri !== (elementDef.namespaceUri ?? "")) {
    problems.push({ code: ProblemCode.Namespace, nodeId: node.id, message: `Wrong namespace for ${node.name}: expected ${elementDef.namespaceUri ?? "(none)"}.` });
  }
  const complexType = info.type?.kind === ValueTypeKind.Complex ? info.type : null;
  const simpleType = info.type?.kind === ValueTypeKind.Simple ? info.type : complexType?.textType ?? null;
  const allowedAttributes = new Map((complexType?.attributes ?? []).map((attribute) => [attribute.name, attribute]));

  for (const attribute of node.attributes) {
    const attributeNamespace = expandedNamespace(attribute.name, namespaces, true);
    if (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")
      || (attributeNamespace === XSI_NAMESPACE && ["schemaLocation", "noNamespaceSchemaLocation"].includes(localName(attribute.name)))) {
      attributeInfoById.set(attribute.id, { attributeDef: null, nodeId: node.id });
      continue;
    }

    const candidate = allowedAttributes.get(localName(attribute.name));
    const attributeDef = candidate && (candidate.namespaceUri ?? "") === attributeNamespace ? candidate : null;
    attributeInfoById.set(attribute.id, { attributeDef, nodeId: node.id });

    if (attribute.placeholder) {
      problems.push({
        code: ProblemCode.Placeholder,
        nodeId: node.id,
        attrId: attribute.id,
        message: `Attribute "${attribute.name}" needs a value before export.`,
      });
      continue;
    }

    if (!attributeDef) {
      problems.push({
        code: ProblemCode.UnexpectedAttribute,
        nodeId: node.id,
        attrId: attribute.id,
        message: `Attribute "${attribute.name}" is not allowed on "${node.name}".`,
      });
      continue;
    }

    const validationMessage = validateSimpleValue(attributeDef.valueType, attribute.value);
    if (validationMessage) {
      problems.push({
        code: ProblemCode.InvalidAttributeValue,
        nodeId: node.id,
        attrId: attribute.id,
        message: `Attribute "${attribute.name}" is invalid. ${validationMessage}.`,
      });
    }
  }

  for (const attributeDef of complexType?.attributes ?? []) {
    if (attributeDef.use === AttributeUse.Required && !node.attributes.some((attribute) => localName(attribute.name) === attributeDef.name && expandedNamespace(attribute.name, namespaces, true) === (attributeDef.namespaceUri ?? ""))) {
      problems.push({
        code: ProblemCode.MissingRequiredAttribute,
        nodeId: node.id,
        message: `Missing required attribute "${attributeDef.name}".`,
      });
    }
  }

  if (simpleType) {
    if (node.textPlaceholder) {
      problems.push({
        code: ProblemCode.Placeholder,
        nodeId: node.id,
        message: `Element "${node.name}" needs a value before export.`,
      });
    } else {
      const textProblem = validateSimpleValue(simpleType, node.text);
      if (textProblem) {
        problems.push({
          code: ProblemCode.InvalidText,
          nodeId: node.id,
          message: `Value for "${node.name}" is invalid. ${textProblem}.`,
        });
      }
    }
  } else if (node.text.trim()) {
    problems.push({
      code: ProblemCode.UnexpectedText,
      nodeId: node.id,
      message: `Element "${node.name}" does not allow text content.`,
    });
  }

  if (complexType) {
    analyzeChildren(schema, node, complexType, problems, nodeInfoById);
  } else if (node.children.length > 0) {
    for (const child of node.children) {
      problems.push({
        code: ProblemCode.UnexpectedChild,
        nodeId: child.id,
        message: `Element "${node.name}" does not allow child elements.`,
      });
    }
  }

  for (const child of node.children) {
    const childInfo = nodeInfoById.get(child.id);
    collectProblemsForNode(schema, child, childInfo?.elementDef ?? schema.elements.get(child.name) ?? null, node.id, results, namespaces);
  }
}

function nodeFromPreservedXml(entry: XmlRecord): ElementNode | null {
  const nodeEntry = firstEntry(entry);
  if (!nodeEntry) {
    return null;
  }

  const [tagName, childrenValue] = nodeEntry;
  if (tagName.startsWith("?") || tagName === "#comment") {
    throw new Error("Comments and processing instructions are not supported by the editor.");
  }
  const attributes = recordEntries(entry[":@"])
    .map(([name, value]) => createAttributeNode(String(name).replace(/^@_/, ""), String(value ?? "")));
  const node = createElementNode(localName(tagName), { attributes });
  node.qualifiedName = tagName;
  const childEntries = Array.isArray(childrenValue) ? childrenValue : [];

  for (const child of childEntries) {
    if (isRecord(child) && child["#text"] !== undefined) {
      const text = String(child["#text"]);
      const previousChild = node.children.at(-1);
      if (previousChild) previousChild.tail = (previousChild.tail ?? "") + text;
      else node.text += text;
      continue;
    }

    if (isRecord(child)) {
      const nested = nodeFromPreservedXml(child);
      if (nested) {
        node.children.push(nested);
      }
    }
  }

  return node;
}

function findRootXmlEntry(entries: unknown): XmlRecord | undefined {
  if (!Array.isArray(entries)) {
    return undefined;
  }

  return entries.find((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const candidate = firstEntry(entry);
    return Boolean(candidate && !candidate[0].startsWith("?"));
  });
}

function gatherSchemaReferences(rootEntry: XmlRecord): string[] {
  const attributes = readRecord(rootEntry, ":@") ?? {};
  const references: string[] = [];
  const bindings: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) if (key.startsWith("@_xmlns:")) bindings[key.slice(8)] = String(value);
  const xsiPrefix = Object.keys(bindings).find((prefix) => bindings[prefix] === XSI_NAMESPACE);
  if (!xsiPrefix) return [];
  const noNamespace = readString(attributes, `@_${xsiPrefix}:noNamespaceSchemaLocation`);
  if (noNamespace) {
    references.push(noNamespace);
  }

  const schemaLocation = readString(attributes, `@_${xsiPrefix}:schemaLocation`);
  if (schemaLocation) {
    const tokens = schemaLocation.split(/\s+/).filter(Boolean);
    for (let index = 1; index < tokens.length; index += 2) {
      const reference = tokens[index];
      if (reference) {
        references.push(reference);
      }
    }
  }

  return references;
}

export function parseXmlString(xmlText: string): ParsedXmlDocument {
  validateXmlSyntax(xmlText);
  const parsed = XML_DOC_PARSER.parse(xmlText) as unknown;
  if (Array.isArray(parsed) && parsed.some((entry: unknown) => isRecord(entry)
    && Object.keys(entry).some((key) => key === "#comment" || (key.startsWith("?") && key !== "?xml")))) {
    throw new Error("Comments and processing instructions are not supported by the editor.");
  }
  if (Array.isArray(parsed) && parsed.filter((entry: unknown) => isRecord(entry) && Object.keys(entry).some((key) => !key.startsWith("?") && key !== "#text" && key !== ":@")).length !== 1) {
    throw new Error("XML must have exactly one root element.");
  }
  const rootEntry = findRootXmlEntry(parsed);
  if (!rootEntry) {
    throw new Error("No XML root element found.");
  }

  const root = nodeFromPreservedXml(rootEntry);
  if (!root) {
    throw new Error("No XML root element found.");
  }

  validateTreeNamespaces(root);
  return {
    root,
    schemaReferences: gatherSchemaReferences(rootEntry),
  };
}

export function parseXmlSchema(xsdText: string): SchemaModel {
  validateXmlSyntax(xsdText);
  const raw = schemaRecord(XML_SCHEMA_PARSER.parse(xsdText));
  if (!isRecord(raw)) {
    throw new Error("Expected an XML schema document.");
  }

  const schemaEntry = Object.entries(raw).find(([key]) => localName(key) === "schema");
  if (!schemaEntry || !isRecord(schemaEntry[1])) {
    throw new Error("Expected an XML schema document.");
  }

  const [, schemaNode] = schemaEntry;
  annotateSchema(schemaNode, "schema", { namespaces: {xml: "http://www.w3.org/XML/1998/namespace"}, target: readString(schemaNode, "@_targetNamespace") ?? "", elementForm: readString(schemaNode, "@_elementFormDefault") ?? "unqualified", attributeForm: readString(schemaNode, "@_attributeFormDefault") ?? "unqualified", global: false }, schemaEntry[0]);
  checkSchemaSubset(schemaNode, "schema");
  const registry: Registry = {
    simpleTypes: new Map(),
    simpleSources: new Map(),
    resolving: new Set(),
    complexTypes: new Map(),
    elements: new Map(),
  };

  for (const [key, value] of Object.entries(schemaNode)) {
    if (key.startsWith("@_")) {
      continue;
    }

    if (localName(key) !== "simpleType") {
      continue;
    }

    for (const entry of arrayify(value)) {
      if (!isRecord(entry)) {
        continue;
      }
      const name = readString(entry, "@_name");
      if (name) {
        registry.simpleSources.set(name, entry);
      }
    }
  }

  for (const name of registry.simpleSources.keys()) resolveNamedSimple(name, registry);

  for (const [key, value] of Object.entries(schemaNode)) {
    if (key.startsWith("@_")) {
      continue;
    }

    if (localName(key) !== "complexType") {
      continue;
    }

    for (const entry of arrayify(value)) {
      if (!isRecord(entry)) {
        continue;
      }
      const name = readString(entry, "@_name");
      if (name) {
        registry.complexTypes.set(name, parseComplexType(entry, registry));
      }
    }
  }

  for (const [key, value] of Object.entries(schemaNode)) {
    if (key.startsWith("@_")) {
      continue;
    }

    if (localName(key) !== "element") {
      continue;
    }

    for (const entry of arrayify(value)) {
      if (!isRecord(entry)) {
        continue;
      }
      const name = readString(entry, "@_name");
      if (name) {
        registry.elements.set(name, parseElement(entry, registry));
      }
    }
  }

  const model: SchemaModel = {
    targetNamespace: readString(schemaNode, "@_targetNamespace") ?? "",
    elements: registry.elements,
    simpleTypes: registry.simpleTypes,
    complexTypes: registry.complexTypes,
    rootElements: [...registry.elements.keys()],
    sourceText: xsdText,
  };
  const inspectParticle = (particle: Particle | null): void => {
    if (!particle) return;
    if (particle.kind === ParticleKind.Element) {
      if (particle.refName && !model.elements.has(particle.refName)) throw new Error(`Unresolved element: ${particle.refName}`);
      const type = resolveType(model, particle);
      if (particle.type?.kind === ValueTypeKind.Complex) inspectParticle(type.kind === ValueTypeKind.Complex ? type.content : null);
    } else particle.items.forEach(inspectParticle);
  };
  model.elements.forEach(inspectParticle);
  model.complexTypes.forEach((type) => inspectParticle(type.content));
  return model;
}

export function analyzeDocument(root: ElementNode, schema: SchemaModel | null): AnalysisResult {
  checkTreeLimits(root);
  const results: AnalysisResult = {
    problems: [],
    nodeInfoById: new Map(),
    attributeInfoById: new Map(),
  };

  if (!schema) {
    const visit = (node: ElementNode, parentId: string | null): void => {
      results.nodeInfoById.set(node.id, {
        elementDef: null,
        parentId,
        type: null,
        allowedAttributes: [],
        allowedChildren: [],
      });

      if (node.placeholder || node.textPlaceholder) {
        results.problems.push({
          code: ProblemCode.Placeholder,
          nodeId: node.id,
          message: `Placeholder remains in "${node.name}".`,
        });
      }

      for (const attribute of node.attributes) {
        results.attributeInfoById.set(attribute.id, { attributeDef: null, nodeId: node.id });
        if (attribute.placeholder) {
          results.problems.push({
            code: ProblemCode.Placeholder,
            nodeId: node.id,
            attrId: attribute.id,
            message: `Attribute "${attribute.name}" needs a value before export.`,
          });
        }
      }

      for (const child of node.children) {
        visit(child, node.id);
      }
    };

    visit(root, null);
    return results;
  }

  const rootDef = schema.elements.get(root.name) ?? null;
  collectProblemsForNode(schema, root, rootDef, null, results);
  return results;
}

export function createMinimalDocument(schema: SchemaModel, rootName: string): ElementNode {
  const elementDef = schema.elements.get(rootName);
  if (!elementDef) {
    throw new Error(`Unknown root element "${rootName}".`);
  }

  return createMinimalNodeForElement(schema, elementDef);
}

export function findNodeById(root: ElementNode | null, id: string): FindNodeResult {
  if (!root) {
    return null;
  }

  if (root.id === id) {
    return root;
  }

  for (const attribute of root.attributes) {
    if (attribute.id === id) {
      return { kind: LookupKind.Attribute, node: root, attribute };
    }
  }

  if (`text:${root.id}` === id) {
    return { kind: LookupKind.Text, node: root };
  }

  for (const child of root.children) {
    const found = findNodeById(child, id);
    if (found) {
      return found;
    }
  }

  return null;
}

export function cloneNodeTree(node: ElementNode): ElementNode {
  return clone(node);
}

export function replaceNodeInTree(root: ElementNode, targetId: string, updater: (node: ElementNode) => ElementNode): ElementNode {
  if (root.id === targetId) {
    return updater(clone(root));
  }

  const nextRoot = clone(root);
  const visit = (node: ElementNode): ElementNode => {
    node.children = node.children.map((child) => {
      if (child.id === targetId) {
        return updater(clone(child));
      }
      return visit(child);
    });
    return node;
  };

  return visit(nextRoot);
}

export function removeNodeFromTree(root: ElementNode, targetId: string): ElementNode {
  const nextRoot = clone(root);
  const visit = (node: ElementNode): ElementNode => {
    node.children = node.children.filter((child) => child.id !== targetId).map(visit);
    return node;
  };

  return visit(nextRoot);
}

function collectSpecsForNode(schema: SchemaModel, root: ElementNode, targetId: string): NodeInfo | null {
  return analyzeDocument(root, schema).nodeInfoById.get(targetId) ?? null;
}

export function getNodeSchemaInfo(root: ElementNode, schema: SchemaModel, nodeId: string): NodeInfo | null {
  return collectSpecsForNode(schema, root, nodeId);
}

export function getAllowedAttributeDefinitions(root: ElementNode, schema: SchemaModel | null, nodeId: string): AttributeDefinition[] {
  if (!schema) {
    return [];
  }

  const info = collectSpecsForNode(schema, root, nodeId);
  return info?.type?.kind === ValueTypeKind.Complex ? info.type.attributes : [];
}

export function getAllowedChildDefinitions(root: ElementNode, schema: SchemaModel | null, nodeId: string): ElementDefinition[] {
  if (!schema) {
    return [];
  }

  const info = collectSpecsForNode(schema, root, nodeId);
  const type = info?.type?.kind === ValueTypeKind.Complex ? info.type : null;
  const seen = new Set<string>();
  return collectElementDefinitionsFromParticle(schema, type?.content ?? null).filter((definition) => {
    if (!definition.name || seen.has(definition.name)) {
      return false;
    }
    seen.add(definition.name);
    return true;
  });
}

export function fillRequiredScaffolding(node: ElementNode, schema: SchemaModel, elementDef: ElementDefinition): ElementNode {
  const type = resolveType(schema, elementDef);
  if (type.kind === ValueTypeKind.Simple && !node.text) {
    node.textPlaceholder = true;
  }

  if (type.kind === ValueTypeKind.Complex) {
    if (type.textType && !node.text) {
      node.textPlaceholder = true;
    }

    for (const attributeDef of type.attributes) {
      if (attributeDef.use === AttributeUse.Required && !node.attributes.some((attribute) => localName(attribute.name) === attributeDef.name)) {
        addAttributeFromDefinition(node, attributeDef);
      }
    }

    if (type.content) {
      const minimalChildren = createMinimalChildrenForParticle(schema, type.content);
      let cursor = 0;
      for (const required of minimalChildren) {
        const match = node.children.findIndex((child, index) => index >= cursor && (required.placeholder ? required.allowedNames.includes(child.name) : child.name === required.name));
        if (match >= 0) cursor = match + 1;
        else { node.children.splice(cursor, 0, required); cursor++; }
      }
    }
  }

  return node;
}

export function getReplacementCandidates(
  root: ElementNode,
  schema: SchemaModel | null,
  nodeId: string,
  mode: ReplacementMode = ReplacementMode.Edit,
): ReplacementCandidate[] {
  if (!schema) {
    return [];
  }

  const analysis = analyzeDocument(root, schema);
  const nodeInfo = analysis.nodeInfoById.get(nodeId);
  const lookup = findNodeById(root, nodeId);
  if (!lookup || "kind" in lookup) {
    return [];
  }

  const parentInfo = nodeInfo?.parentId ? analysis.nodeInfoById.get(nodeInfo.parentId) : null;
  const sourceDefinitions = parentInfo?.type?.kind === ValueTypeKind.Complex && parentInfo.type.content
    ? collectElementDefinitionsFromParticle(schema, parentInfo.type.content)
    : [...schema.elements.values()];
  const allowedNameSet = lookup.placeholder && lookup.allowedNames.length ? new Set(lookup.allowedNames) : null;
  const uniqueDefinitions = sourceDefinitions.filter((definition, index, list) =>
    Boolean(definition.name)
    && list.findIndex((entry) => entry.name === definition.name) === index
    && (!allowedNameSet || allowedNameSet.has(definition.name)),
  );

  const candidates: ReplacementCandidate[] = [];
  for (const elementDef of uniqueDefinitions) {
    const name = elementDef.name;
    if (mode !== ReplacementMode.Migration) {
      let probeRoot: ElementNode;
      try {
        probeRoot = replaceNodeInTree(root, nodeId, (current) => fillRequiredScaffolding({ ...current, name, placeholder: false, allowedNames: [] }, schema, elementDef));
        if (analyzeDocument(probeRoot, schema).problems.some((problem) => problem.code !== ProblemCode.Placeholder)) continue;
      } catch { continue; }
    }

    const type = resolveType(schema, elementDef);
    candidates.push({
      name,
      label: name,
      elementDef,
      detail: [
        ...(type.kind === ValueTypeKind.Complex ? type.attributes.map((attribute) => `@${attribute.name}`) : []),
        ...(type.kind === ValueTypeKind.Complex ? [...new Set(getElementNamesFromParticle(type.content))] : []),
      ].join(" "),
    });
  }

  return candidates;
}

export function canDeleteNode(root: ElementNode, schema: SchemaModel | null, nodeId: string): boolean {
  const analysis = analyzeDocument(root, schema);
  const info = analysis.nodeInfoById.get(nodeId);
  if (!info?.parentId) {
    return false;
  }

  if (!schema) {
    return true;
  }

  const nextRoot = removeNodeFromTree(root, nodeId);
  const nextAnalysis = analyzeDocument(nextRoot, schema);
  return !nextAnalysis.problems.some((problem) => problem.code !== ProblemCode.Placeholder);
}

export function canDeleteAttribute(root: ElementNode, schema: SchemaModel | null, nodeId: string, attributeId: string): boolean {
  const lookup = findNodeById(root, nodeId);
  if (!lookup || "kind" in lookup) {
    return false;
  }

  if (!schema) {
    return true;
  }

  const info = collectSpecsForNode(schema, root, nodeId);
  const attribute = lookup.attributes.find((entry) => entry.id === attributeId);
  const complexType = info?.type?.kind === ValueTypeKind.Complex ? info.type : null;
  const attributeDef = complexType?.attributes.find((entry) => entry.name === localName(attribute?.name ?? ""));
  return attributeDef?.use !== AttributeUse.Required;
}

export function canInsertChild(
  root: ElementNode,
  schema: SchemaModel | null,
  nodeId: string,
  childDefinitionOrName: ElementDefinition | string,
  pastedNode: ElementNode | null = null,
  insertionIndex?: number,
): boolean {
  const lookup = findNodeById(root, nodeId);
  if (!lookup || "kind" in lookup) {
    return false;
  }

  if (!schema) {
    return true;
  }

  const childDefinition = typeof childDefinitionOrName === "string"
    ? schema.elements.get(childDefinitionOrName)
    : childDefinitionOrName;
  if (!childDefinition && !pastedNode) {
    return false;
  }

  const childNode = pastedNode ? clone(pastedNode) : createMinimalNodeForElement(schema, childDefinition ?? null);
  const probeRoot = replaceNodeInTree(root, nodeId, (current) => ({
    ...current,
    children: [...current.children.slice(0, insertionIndex ?? current.children.length), childNode, ...current.children.slice(insertionIndex ?? current.children.length)],
  }));
  const probeAnalysis = analyzeDocument(probeRoot, schema);
  return !probeAnalysis.problems.some((problem) => problem.code !== ProblemCode.Placeholder);
}

function escapeXml(value: string, attribute = false): string {
  const escaped = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return attribute ? escaped.replaceAll('"', "&quot;").replaceAll("\r", "&#13;").replaceAll("\n", "&#10;").replaceAll("\t", "&#9;") : escaped.replaceAll("\r", "&#13;");
}

function serializeOrderedNode(node: ElementNode): string {
  const prefix = node.qualifiedName?.includes(":") ? node.qualifiedName.split(":")[0] + ":" : "";
  const name = prefix + node.name;
  assertXmlName(name);
  for (const attribute of node.attributes) assertXmlName(attribute.name);
  if (new Set(node.attributes.map((attribute) => attribute.name)).size !== node.attributes.length) throw new Error("Duplicate attribute names.");
  const attributes = node.attributes.map((attribute) => ` ${attribute.name}="${escapeXml(attribute.value, true)}"`).join("");
  const content = escapeXml(node.text) + node.children.map((child) => serializeOrderedNode(child) + escapeXml(child.tail ?? "")).join("");
  return `<${name}${attributes}>${content}</${name}>`;
}

export function serializeXml(root: ElementNode, schema: SchemaModel | null): string {
  const analysis = analyzeDocument(root, schema);
  if (analysis.problems.length > 0) {
    throw new Error("Cannot export while placeholders or schema errors remain.");
  }

  const output = renderSourceXml(root);
  validateXmlSyntax(output);
  const exported = parseXmlString(output).root;
  if (analyzeDocument(exported, schema).problems.length) throw new Error("Serialized XML does not validate.");
  return output;
}

export function renderSourceXml(root: ElementNode): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializeOrderedNode(root)}`;
}

export function exportDraftDocument<T>(documentState: T): string {
  const serialized = JSON.stringify(documentState, null, 2);
  assertInputLimit(serialized, DRAFT_INPUT_LIMIT);
  return serialized;
}

export function importDraftDocument<T>(serialized: string): T {
  assertInputLimit(serialized, DRAFT_INPUT_LIMIT);
  const value: unknown = JSON.parse(serialized);
  if (!isRecord(value)) throw new Error("Draft must be an object.");
  if ("root" in value) validateDraftTree(value.root);
  if (value.formatVersion !== undefined && value.formatVersion !== 1) throw new Error("Unsupported draft format version.");
  if (value.schemaRequired !== undefined && typeof value.schemaRequired !== "boolean") throw new Error("Invalid schema requirement.");
  if (value.schemaSource !== undefined) {
    if (!isRecord(value.schemaSource) || typeof value.schemaSource.fileName !== "string" || typeof value.schemaSource.sourceText !== "string") throw new Error("Invalid embedded schema.");
  }
  for (const key of ["title", "schemaId", "referenceUri", "selectedId", "schemaRegistrationId"]) {
    if (value[key] != null && typeof value[key] !== "string") throw new Error(`Invalid draft ${key}.`);
  }
  if (value.kind !== undefined && !["xml", "xsd"].includes(String(value.kind))) throw new Error("Invalid draft kind.");
  if (value.mode !== undefined && !["edit", "migration", "freeform"].includes(String(value.mode))) throw new Error("Invalid draft mode.");
  if (value.schemaReferences !== undefined && (!Array.isArray(value.schemaReferences) || !value.schemaReferences.every((entry) => typeof entry === "string"))) throw new Error("Invalid schema references.");
  for (const key of ["readOnly", "allowAutoLeaveMigration"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`Invalid draft ${key}.`);
  }
  return value as T;
}

export function flattenVisibleItems(root: ElementNode): VisibleTreeItem[] {
  const items: VisibleTreeItem[] = [];
  const visit = (node: ElementNode, depth: number): void => {
    items.push({ id: node.id, type: VisibleItemType.Node, depth, nodeId: node.id });
    for (const attribute of node.attributes) {
      items.push({ id: attribute.id, type: VisibleItemType.Attribute, depth: depth + 1, nodeId: node.id, attributeId: attribute.id });
    }

    if (node.text || node.textPlaceholder) {
      items.push({ id: `text:${node.id}`, type: VisibleItemType.Text, depth: depth + 1, nodeId: node.id });
    }

    if (node.collapsed) {
      return;
    }

    for (const child of node.children) {
      visit(child, depth + 1);
    }
  };

  visit(root, 0);
  return items;
}

export function fuzzySearch<T extends FuzzyOption>(query: string, options: readonly T[]): T[] {
  const trimmed = query.trim().toLowerCase();
  const withScores = options.map((option) => {
    const haystack = `${option.label} ${option.detail ?? ""}`.toLowerCase();
    if (!trimmed) {
      return { option, score: 1 };
    }

    let score = 0;
    let offset = 0;
    for (const character of trimmed) {
      const foundAt = haystack.indexOf(character, offset);
      if (foundAt === -1) {
        score -= 4;
      } else {
        score += foundAt === offset ? 5 : 2;
        offset = foundAt + 1;
      }
    }

    if (haystack.includes(trimmed)) {
      score += 12;
    }

    return { option, score };
  });

  return withScores
    .filter((entry) => entry.score > -trimmed.length)
    .sort((left, right) => right.score - left.score || left.option.label.localeCompare(right.option.label))
    .map((entry) => entry.option);
}

function validateDraftTree(value: unknown, depth = 0, budget = { nodes: 0 }): asserts value is ElementNode {
  if (depth > 128 || ++budget.nodes > 10000) throw new Error("Draft exceeds tree limits.");
  if (!isRecord(value)) throw new Error("Invalid draft node.");
  for (const key of ["id", "name", "text"]) {
    if (typeof value[key] !== "string") throw new Error(`Invalid node ${key}.`);
  }
  for (const key of ["qualifiedName", "tail"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") throw new Error(`Invalid node ${key}.`);
  }
  for (const key of ["placeholder", "textPlaceholder", "collapsed"]) {
    if (typeof value[key] !== "boolean") throw new Error(`Invalid node ${key}.`);
  }
  if (!Array.isArray(value.allowedNames) || !value.allowedNames.every((entry) => typeof entry === "string")) throw new Error("Invalid allowed names.");
  if (!Array.isArray(value.attributes) || !Array.isArray(value.children)) throw new Error("Invalid node collections.");
  if (value.attributes.length > 1000) throw new Error("Too many attributes.");
  for (const attribute of value.attributes) {
    if (!isRecord(attribute) || !["id", "name", "value"].every((key) => typeof attribute[key] === "string")
      || typeof attribute.placeholder !== "boolean" || !Array.isArray(attribute.expectedValues)
      || !attribute.expectedValues.every((entry) => typeof entry === "string")) throw new Error("Invalid draft attribute.");
  }
  for (const child of value.children) validateDraftTree(child, depth + 1, budget);
}

const XML_NAME = /^[\p{L}_][\p{L}\p{N}_.\-\u00B7\p{M}]*(?::[\p{L}_][\p{L}\p{N}_.\-\u00B7\p{M}]*)?$/u;
function assertXmlName(name: string): void {
  if (!XML_NAME.test(name)) throw new Error(`Invalid XML name: ${name}`);
}

export function assertInputLimit(text: string, limit = INPUT_LIMIT): void {
  if (text.length > limit || new TextEncoder().encode(text).byteLength > limit) throw new Error(`Input exceeds the ${limit / INPUT_LIMIT} MiB limit.`);
}

function checkTreeLimits(root: ElementNode): void {
  const stack = [{node: root, depth: 0}];
  let count = 0;
  while (stack.length) {
    const {node, depth} = stack.pop()!;
    if (++count > NODE_LIMIT || depth > DEPTH_LIMIT) throw new Error("Document exceeds tree limits.");
    if (node.attributes.length > 1000) throw new Error("Too many attributes.");
    node.children.forEach((child) => stack.push({node: child, depth: depth + 1}));
  }
}

function validateXmlSyntax(text: string): void {
  assertInputLimit(text);
  let depth = 0, count = 0;
  // Skip CDATA and comments as units; quoted '>' characters cannot end a tag.
  for (const token of text.matchAll(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>/g)) {
    const tag = token[0];
    if (tag.startsWith("<?") || tag.startsWith("<!")) continue;
    if (tag.startsWith("</")) depth--;
    else {
      if (++count > NODE_LIMIT || depth >= DEPTH_LIMIT) throw new Error("XML exceeds tree limits.");
      if (!tag.endsWith("/>")) depth++;
    }
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("DTD and entity declarations are not supported.");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDFFF]/u.test(text)) throw new Error("Invalid XML character.");
  const result = XMLValidator.validate(text);
  if (result !== true) throw new Error(`Malformed XML: ${result.err.msg}`);
}

const SCHEMA_SUBSET: Record<string, { children: string[]; attributes: string[] }> = {
  schema: { children: ["simpleType", "complexType", "element"], attributes: ["targetNamespace", "elementFormDefault", "attributeFormDefault"] },
  simpleType: { children: ["restriction"], attributes: ["name"] },
  restriction: { children: ["enumeration"], attributes: ["base"] },
  enumeration: { children: [], attributes: ["value"] },
  complexType: { children: ["sequence", "choice", "attribute", "simpleContent"], attributes: ["name"] },
  simpleContent: { children: ["extension"], attributes: [] },
  extension: { children: ["attribute"], attributes: ["base"] },
  element: { children: ["simpleType", "complexType"], attributes: ["name", "ref", "type", "minOccurs", "maxOccurs", "form"] },
  sequence: { children: ["element", "sequence", "choice"], attributes: ["minOccurs", "maxOccurs"] },
  choice: { children: ["element", "sequence", "choice"], attributes: ["minOccurs", "maxOccurs"] },
  attribute: { children: ["simpleType"], attributes: ["name", "type", "use", "form"] },
};

function checkSchemaSubset(node: XmlRecord, tag: string): void {
  const spec = SCHEMA_SUBSET[tag];
  if (!spec) throw new Error(`Unsupported XSD construct: ${tag}`);
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) {
      const name = key.slice(2);
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      if (!spec.attributes.includes(name)) throw new Error(`Unsupported XSD attribute: ${tag}/@${name}`);
    } else if (key === "#text") {
      if (String(value).trim()) throw new Error(`Unexpected text in XSD ${tag}`);
    } else {
      const childName = localName(key);
      if (!spec.children.includes(childName)) throw new Error(`Unsupported XSD construct: ${tag}/${childName}`);
      for (const child of arrayify(value)) if (isRecord(child)) checkSchemaSubset(child, childName);
    }
  }
  const children = (node[ORDERED_CHILDREN] ?? []).filter(([name]) => name !== "#text");
  const name = readString(node, "@_name");
  if (name !== undefined && (!XML_NAME.test(name) || name.includes(":"))) throw new Error(`Invalid declaration name: ${name}`);
  const context = node[SCHEMA_CONTEXT];
  if (tag === "schema") {
    const symbols = new Set<string>();
    for (const [lexical, value] of children) {
      if (!isRecord(value)) continue;
      const kind = localName(lexical);
      const declared = readString(value, "@_name");
      if (!declared) throw new Error(`Global ${kind} requires a name.`);
      const key = `${kind === "element" ? "element" : "type"}:${declared}`;
      if (symbols.has(key)) throw new Error(`Duplicate declaration: ${declared}`);
      symbols.add(key);
    }
  }
  if (tag === "element" && context?.global && ["ref", "minOccurs", "maxOccurs", "form"].some((field) => node[`@_${field}`] !== undefined)) throw new Error("Unsupported global element constraint.");
  if (tag === "element" && node["@_name"] && node["@_ref"]) throw new Error("Element cannot have both name and ref.");
  if (["restriction", "extension"].includes(tag) && !node["@_base"]) throw new Error(`${tag} requires a base.`);
  if (tag === "enumeration" && node["@_value"] === undefined) throw new Error("Enumeration requires a value.");
  if (tag === "attribute" && (!name || (node["@_type"] !== undefined && children.length))) throw new Error("Invalid attribute declaration.");
  if (["attribute", "element"].includes(tag) && children.length > 1) throw new Error("Only one inline type is allowed.");
  if (tag === "simpleContent" && children.length !== 1) throw new Error("simpleContent requires an extension.");
  if (tag === "complexType") {
    let attributesStarted = false;
    const names = new Set<string>();
    for (const [lexical, child] of children) {
      if (localName(lexical) === "attribute") {
        attributesStarted = true;
        const name = isRecord(child) ? readString(child, "@_name") : "";
        if (names.has(name ?? "")) throw new Error("Duplicate attribute declaration.");
        names.add(name ?? "");
      } else if (attributesStarted) throw new Error("Content model must precede attributes.");
    }
  }

  if (tag === "simpleType" && children.length !== 1) throw new Error("simpleType requires one restriction.");
  if (tag === "complexType" && children.filter(([name]) => localName(name) !== "attribute").length > 1) throw new Error("Multiple complex content models are not supported.");
  if (tag === "element") {
    const options = Number(node["@_ref"] !== undefined) + Number(node["@_type"] !== undefined) + children.length;
    if (options > 1 || (!node["@_ref"] && !node["@_name"])) throw new Error("Invalid element declaration.");
    if (options === 0) throw new Error("Elements require an explicit supported type.");
  }
  if (node["@_use"] !== undefined && !["required", "optional"].includes(String(node["@_use"]))) throw new Error("Unsupported attribute use.");
  for (const field of ["elementFormDefault", "attributeFormDefault", "form"]) {
    if (node[`@_${field}`] !== undefined && !["qualified", "unqualified"].includes(String(node[`@_${field}`]))) throw new Error(`Invalid ${field}.`);
  }
}

function nodeNamespaces(node: ElementNode, inherited: Record<string, string>): Record<string, string> {
  const bindings = { ...inherited };
  for (const attribute of node.attributes) {
    if (attribute.name === "xmlns") bindings[""] = attribute.value;
    else if (attribute.name.startsWith("xmlns:")) bindings[attribute.name.slice(6)] = attribute.value;
  }
  if (bindings.xml !== undefined && bindings.xml !== "http://www.w3.org/XML/1998/namespace") throw new Error("Invalid xml namespace binding.");
  if (bindings.xmlns !== undefined || Object.values(bindings).includes("http://www.w3.org/2000/xmlns/")) throw new Error("Invalid xmlns binding.");
  return bindings;
}

function expandedNamespace(name: string, bindings: Record<string, string>, attribute: boolean): string {
  const prefix = name.includes(":") ? name.split(":")[0] : "";
  if (prefix === "xmlns" || name === "xmlns") return "http://www.w3.org/2000/xmlns/";
  if (prefix && !bindings[prefix]) throw new Error(`Unbound namespace prefix: ${prefix}`);
  return prefix ? bindings[prefix] : attribute ? "" : bindings[""] ?? "";
}

function validateTreeNamespaces(root: ElementNode): void {
  const visit = (node: ElementNode, inherited: Record<string, string>): void => {
    const bindings = nodeNamespaces(node, inherited);
    expandedNamespace(node.qualifiedName?.includes(":") ? node.qualifiedName.split(":")[0] + ":" + node.name : node.name, bindings, false);
    const names = new Set<string>();
    for (const attribute of node.attributes) {
      const key = `${expandedNamespace(attribute.name, bindings, true)}|${localName(attribute.name)}`;
      if (names.has(key)) throw new Error("Duplicate expanded attribute name.");
      names.add(key);
    }
    node.children.forEach((child) => visit(child, bindings));
  };
  visit(root, {xml: "http://www.w3.org/XML/1998/namespace"});
}

function annotateSchema(node: XmlRecord, tag: string, inherited: SchemaContext, lexicalTag: string): void {
  const namespaces = { ...inherited.namespaces };
  for (const [key, value] of Object.entries(node)) {
    if (key === "@_xmlns") namespaces[""] = String(value);
    else if (key.startsWith("@_xmlns:")) namespaces[key.slice(8)] = String(value);
  }
  if (expandedNamespace(lexicalTag, namespaces, false) !== XSD_NAMESPACE) throw new Error(`Expected XSD namespace for ${lexicalTag}`);
  const context = { ...inherited, namespaces };
  node[SCHEMA_CONTEXT] = context;
  for (const field of ["type", "base", "ref"]) {
    const name = readString(node, `@_${field}`);
    if (!name) continue;
    const uri = expandedNamespace(name, namespaces, false);
    const builtin = BUILTIN_TYPES.has(localName(name));
    if (field !== "ref" && uri === XSD_NAMESPACE && builtin) continue;
    if (uri !== context.target) throw new Error(`Unsupported foreign schema reference: ${name}`);
  }
  for (const [name, value] of node[ORDERED_CHILDREN] ?? []) {
    if (name === "#text") continue;
    if (isRecord(value)) annotateSchema(value, localName(name), { ...context, global: tag === "schema" }, name);
  }
}

export function canAppendChild(root: ElementNode, schema: SchemaModel | null, nodeId: string, definition: ElementDefinition | string, pastedNode: ElementNode | null = null): boolean {
  return canInsertChild(root, schema, nodeId, definition, pastedNode);
}

export function getXmlSchemaReferences(root: ElementNode): string[] {
  return gatherSchemaReferences({ ":@": Object.fromEntries(root.attributes.map((attribute) => [`@_${attribute.name}`, attribute.value])) });
}

function resolveNamedSimple(name: string, registry: Registry): SimpleTypeDefinition {
  const existing = registry.simpleTypes.get(name);
  if (existing) return clone(existing);
  const source = registry.simpleSources.get(name);
  if (!source) throw new Error(`Unsupported or unresolved type: ${name}`);
  if (registry.resolving.has(name)) throw new Error(`Cyclic simple type: ${name}`);
  registry.resolving.add(name);
  try {
    const resolved = parseSimpleType(source, registry);
    registry.simpleTypes.set(name, resolved);
    return clone(resolved);
  } finally { registry.resolving.delete(name); }
}

function resolveDeclaredSimple(node: XmlRecord, name: string, registry: Registry): SimpleTypeDefinition {
  const uri = expandedNamespace(name, node[SCHEMA_CONTEXT]?.namespaces ?? {}, false);
  if (uri === XSD_NAMESPACE && BUILTIN_TYPES.has(localName(name))) return resolveBuiltinSimpleType(name);
  return resolveNamedSimple(localName(name), registry);
}

export function addAttributeFromDefinition(node: ElementNode, definition: AttributeDefinition): AttributeNode {
  const attribute = createMinimalAttribute(definition);
  if (definition.namespaceUri) {
    let index = 1;
    while (node.attributes.some((entry) => entry.name === `xmlns:attr${index}`)) index++;
    const prefix = `attr${index}`;
    node.attributes.push(createAttributeNode(`xmlns:${prefix}`, definition.namespaceUri));
    attribute.name = `${prefix}:${definition.name}`;
  }
  node.attributes.push(attribute);
  return attribute;
}
