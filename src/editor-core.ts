import { XMLBuilder, XMLParser } from "fast-xml-parser";

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

type XmlRecord = Record<string, unknown>;

export interface SimpleTypeDefinition {
  kind: ValueTypeKind.Simple;
  base: SimpleBase;
  enumerations: string[];
}

export interface AttributeDefinition {
  name: string;
  use: AttributeUse;
  valueType: SimpleTypeDefinition;
}

export interface ElementDefinition {
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
  trimValues: false,
});

const XML_SCHEMA_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

const XML_OUTPUT = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  suppressBooleanAttributes: false,
  preserveOrder: false,
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

export function resolveBuiltinSimpleType(typeName?: string | null): SimpleTypeDefinition {
  const normalized = localName(typeName ?? SimpleBase.String);
  if (normalized === SimpleBase.Boolean) {
    return { kind: ValueTypeKind.Simple, base: SimpleBase.Boolean, enumerations: [] };
  }

  if (["int", "integer", "decimal", "float", "double", "long", "short"].includes(normalized)) {
    return { kind: ValueTypeKind.Simple, base: SimpleBase.Number, enumerations: [] };
  }

  return { kind: ValueTypeKind.Simple, base: SimpleBase.String, enumerations: [] };
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
      return value ? [value] : [];
    });
}

function parseSimpleType(node: XmlRecord, registry: Registry): SimpleTypeDefinition {
  const restriction = findNamedChild(node, "restriction");
  if (!isRecord(restriction)) {
    return { kind: ValueTypeKind.Simple, base: SimpleBase.String, enumerations: [] };
  }

  const baseName = readString(restriction, "@_base") ?? SimpleBase.String;
  const typeFromRegistry = registry.simpleTypes.get(localName(baseName));
  const inherited = typeFromRegistry ? clone(typeFromRegistry) : resolveBuiltinSimpleType(baseName);
  inherited.enumerations = parseEnumerationValues(restriction);
  return inherited;
}

function parseAttribute(node: XmlRecord, registry: Registry): AttributeDefinition {
  const name = readString(node, "@_name") ?? localName(readString(node, "@_ref") ?? "");
  const use = readString(node, "@_use") === AttributeUse.Required ? AttributeUse.Required : AttributeUse.Optional;
  let valueType = resolveBuiltinSimpleType(readString(node, "@_type"));
  const inlineTypeNode = findNamedChild(node, "simpleType");

  if (isRecord(inlineTypeNode)) {
    valueType = parseSimpleType(inlineTypeNode, registry);
  } else {
    const declaredType = readString(node, "@_type");
    if (declaredType) {
      const registered = registry.simpleTypes.get(localName(declaredType));
      valueType = registered ? clone(registered) : resolveBuiltinSimpleType(declaredType);
    }
  }

  return { name, use, valueType };
}

export function normalizeOccurs(node: XmlRecord): { minOccurs: number; maxOccurs: number } {
  const minOccurs = Number.parseInt(readString(node, "@_minOccurs") ?? "1", 10);
  const rawMax = readString(node, "@_maxOccurs") ?? "1";
  const maxOccurs = rawMax === "unbounded" ? Number.POSITIVE_INFINITY : Number.parseInt(rawMax, 10);
  return { minOccurs, maxOccurs };
}

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
      typeName = localName(declaredType);
    }
  }

  return {
    kind: ParticleKind.Element,
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
  for (const [childName, childValue] of Object.entries(payloadValue)) {
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
      const registered = registry.simpleTypes.get(localName(base));
      textType = registered ? clone(registered) : resolveBuiltinSimpleType(base);
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

  const complex = schema.complexTypes.get(elementDef.typeName);
  if (complex) {
    return complex;
  }

  const simple = schema.simpleTypes.get(elementDef.typeName);
  if (simple) {
    return simple;
  }

  return resolveBuiltinSimpleType(elementDef.typeName);
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

function createMinimalNodeForElement(schema: SchemaModel, elementDef: ElementDefinition | null): ElementNode {
  const resolvedElement = getElementDefinition(schema, elementDef);
  if (!resolvedElement) {
    return createElementNode(elementDef?.name ?? "unknown", { placeholder: true });
  }

  const type = resolveType(schema, resolvedElement);
  const node = createElementNode(resolvedElement.name);

  if (type.kind === ValueTypeKind.Simple) {
    node.textPlaceholder = true;
    return node;
  }

  if (type.textType) {
    node.textPlaceholder = true;
  }

  for (const attributeDef of type.attributes) {
    if (attributeDef.use === AttributeUse.Required) {
      node.attributes.push(createMinimalAttribute(attributeDef));
    }
  }

  if (type.content) {
    node.children.push(...createMinimalChildrenForParticle(schema, type.content));
  }

  return node;
}

export function createMinimalNodeFromDefinition(schema: SchemaModel, elementDef: ElementDefinition): ElementNode {
  return createMinimalNodeForElement(schema, elementDef);
}

function createMinimalChildrenForParticle(schema: SchemaModel, particle: Particle | null): ElementNode[] {
  if (!particle) {
    return [];
  }

  const minOccurs = Number.isFinite(particle.minOccurs) ? particle.minOccurs : 0;
  const nodes: ElementNode[] = [];

  for (let occurrenceIndex = 0; occurrenceIndex < minOccurs; occurrenceIndex += 1) {
    if (particle.kind === ParticleKind.Element) {
      nodes.push(createMinimalNodeForElement(schema, particle));
      continue;
    }

    if (particle.kind === ParticleKind.Sequence) {
      for (const item of particle.items) {
        nodes.push(...createMinimalChildrenForParticle(schema, item));
      }
      continue;
    }

    const options = particle.items.flatMap((item) => getElementNamesFromParticle(item));
    if (options.length === 1) {
      nodes.push(...createMinimalChildrenForParticle(schema, particle.items[0] ?? null));
    } else if (options.length > 1) {
      nodes.push(createPlaceholderNode(options));
    }
  }

  return nodes;
}

export function validateSimpleValue(type: SimpleTypeDefinition | null | undefined, value: string | null | undefined): string | null {
  const text = value ?? "";
  if (type?.enumerations.length && !type.enumerations.includes(text)) {
    return `Expected one of: ${type.enumerations.join(", ")}`;
  }

  if (type?.base === SimpleBase.Boolean && text !== "" && !["true", "false", "1", "0"].includes(text)) {
    return "Expected a boolean value";
  }

  if (type?.base === SimpleBase.Number && text !== "" && Number.isNaN(Number(text))) {
    return "Expected a numeric value";
  }

  return null;
}

function enumerateSingleMatch(
  schema: SchemaModel,
  particle: Particle | null,
  children: ElementNode[],
  index: number,
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
    return particle.items.flatMap((item) => enumerateMatches(schema, item, children, index));
  }

  let states: MatchResult[] = [{ index, assignments: [] }];
  for (const item of particle.items) {
    const nextStates: MatchResult[] = [];
    for (const state of states) {
      for (const result of enumerateMatches(schema, item, children, state.index)) {
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
): MatchResult[] {
  if (!particle) {
    return [{ index, assignments: [] }];
  }

  const max = Number.isFinite(particle.maxOccurs) ? particle.maxOccurs : children.length + 1;
  const results: MatchResult[] = [];
  const singleParticle = { ...particle, minOccurs: 1, maxOccurs: 1 } as Particle;

  const visit = (currentIndex: number, count: number, assignments: MatchAssignment[]): void => {
    if (count >= particle.minOccurs) {
      results.push({ index: currentIndex, assignments });
    }

    if (count >= max) {
      return;
    }

    for (const singleResult of enumerateSingleMatch(schema, singleParticle, children, currentIndex)) {
      if (singleResult.index === currentIndex) {
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
    const minimumChildren = createMinimalChildrenForParticle(schema, type.content);
    if (children.length < minimumChildren.length) {
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
): void {
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

  const complexType = info.type?.kind === ValueTypeKind.Complex ? info.type : null;
  const simpleType = info.type?.kind === ValueTypeKind.Simple ? info.type : complexType?.textType ?? null;
  const allowedAttributes = new Map((complexType?.attributes ?? []).map((attribute) => [attribute.name, attribute]));

  for (const attribute of node.attributes) {
    if (isSchemaInfrastructureAttribute(attribute.name)) {
      attributeInfoById.set(attribute.id, { attributeDef: null, nodeId: node.id });
      continue;
    }

    const attributeDef = allowedAttributes.get(localName(attribute.name)) ?? null;
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
    if (attributeDef.use === AttributeUse.Required && !node.attributes.some((attribute) => localName(attribute.name) === attributeDef.name)) {
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
    collectProblemsForNode(schema, child, childInfo?.elementDef ?? schema.elements.get(child.name) ?? null, node.id, results);
  }
}

function nodeFromPreservedXml(entry: XmlRecord): ElementNode | null {
  const nodeEntry = firstEntry(entry);
  if (!nodeEntry) {
    return null;
  }

  const [tagName, childrenValue] = nodeEntry;
  const attributes = recordEntries(entry[":@"])
    .map(([name, value]) => createAttributeNode(String(name).replace(/^@_/, ""), String(value ?? "")));
  const node = createElementNode(localName(tagName), { attributes });
  const childEntries = Array.isArray(childrenValue) ? childrenValue : [];

  for (const child of childEntries) {
    if (isRecord(child) && child["#text"] !== undefined) {
      const text = String(child["#text"]);
      if (text.trim()) {
        node.text = text;
      }
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
  const noNamespace = readString(attributes, "@_xsi:noNamespaceSchemaLocation");
  if (noNamespace) {
    references.push(noNamespace);
  }

  const schemaLocation = readString(attributes, "@_xsi:schemaLocation");
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
  const parsed = XML_DOC_PARSER.parse(xmlText) as unknown;
  const rootEntry = findRootXmlEntry(parsed);
  if (!rootEntry) {
    throw new Error("No XML root element found.");
  }

  const root = nodeFromPreservedXml(rootEntry);
  if (!root) {
    throw new Error("No XML root element found.");
  }

  return {
    root,
    schemaReferences: gatherSchemaReferences(rootEntry),
  };
}

export function parseXmlSchema(xsdText: string): SchemaModel {
  const raw = XML_SCHEMA_PARSER.parse(xsdText) as unknown;
  if (!isRecord(raw)) {
    throw new Error("Expected an XML schema document.");
  }

  const schemaEntry = Object.entries(raw).find(([key]) => localName(key) === "schema");
  if (!schemaEntry || !isRecord(schemaEntry[1])) {
    throw new Error("Expected an XML schema document.");
  }

  const [schemaKey, schemaNode] = schemaEntry;
  const registry: Registry = {
    simpleTypes: new Map(),
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
        registry.simpleTypes.set(name, parseSimpleType(entry, registry));
      }
    }
  }

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

  return {
    targetNamespace: readString(schemaNode, "@_targetNamespace") ?? "",
    elements: registry.elements,
    simpleTypes: registry.simpleTypes,
    complexTypes: registry.complexTypes,
    rootElements: [...registry.elements.keys()],
    sourceText: xsdText,
  };
}

export function analyzeDocument(root: ElementNode, schema: SchemaModel | null): AnalysisResult {
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
        node.attributes.push(createMinimalAttribute(attributeDef));
      }
    }

    if (type.content) {
      const minimalChildren = createMinimalChildrenForParticle(schema, type.content);
      const missingCount = Math.max(minimalChildren.length - node.children.length, 0);
      if (missingCount > 0) {
        node.children.push(...minimalChildren.slice(-missingCount));
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
      const probeRoot = replaceNodeInTree(root, nodeId, (current) => ({ ...current, name, placeholder: false, allowedNames: [] }));
      const probeAnalysis = analyzeDocument(probeRoot, schema);
      const probeProblems = probeAnalysis.problems.filter((problem) =>
        problem.nodeId === nodeId || probeAnalysis.nodeInfoById.get(problem.nodeId)?.parentId === nodeId,
      );
      const disqualifying = probeProblems.some((problem) =>
        [
          ProblemCode.UnexpectedChild,
          ProblemCode.UnexpectedAttribute,
          ProblemCode.InvalidAttributeValue,
          ProblemCode.InvalidText,
          ProblemCode.UnknownElement,
        ].includes(problem.code),
      );
      if (disqualifying) {
        continue;
      }
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
  return !nextAnalysis.problems.some((problem) => problem.nodeId === info.parentId && problem.code === ProblemCode.MissingRequiredChild);
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

export function canAppendChild(
  root: ElementNode,
  schema: SchemaModel | null,
  nodeId: string,
  childDefinitionOrName: ElementDefinition | string,
  pastedNode: ElementNode | null = null,
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
    children: current.children.concat(childNode),
  }));
  const probeAnalysis = analyzeDocument(probeRoot, schema);
  return !probeAnalysis.problems.some((problem) => problem.code === ProblemCode.UnexpectedChild && problem.nodeId === childNode.id);
}

function toSerializableNode(node: ElementNode): XmlRecord {
  const payload: XmlRecord = {};
  for (const attribute of node.attributes) {
    payload[`@_${attribute.name}`] = attribute.value;
  }

  if (node.text) {
    payload["#text"] = node.text;
  }

  for (const child of node.children) {
    const current = payload[child.name];
    const childPayload = toSerializableNode(child);
    if (current === undefined) {
      payload[child.name] = childPayload;
    } else if (Array.isArray(current)) {
      current.push(childPayload);
    } else {
      payload[child.name] = [current, childPayload];
    }
  }

  return payload;
}

export function serializeXml(root: ElementNode, schema: SchemaModel | null): string {
  const analysis = analyzeDocument(root, schema);
  if (analysis.problems.length > 0) {
    throw new Error("Cannot export while placeholders or schema errors remain.");
  }

  return renderSourceXml(root);
}

export function renderSourceXml(root: ElementNode): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${XML_OUTPUT.build({ [root.name]: toSerializableNode(root) })}`;
}

export function exportDraftDocument<T>(documentState: T): string {
  return JSON.stringify(documentState, null, 2);
}

export function importDraftDocument<T>(serialized: string): T {
  return JSON.parse(serialized) as T;
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
