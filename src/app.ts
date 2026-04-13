import {
  analyzeDocument,
  canAppendChild,
  canDeleteAttribute,
  canDeleteNode,
  cloneNodeTree,
  createElementNode,
  createMinimalDocument,
  createMinimalNodeFromDefinition,
  exportDraftDocument,
  fillRequiredScaffolding,
  findNodeById,
  flattenVisibleItems,
  fuzzySearch,
  getAllowedAttributeDefinitions,
  getAllowedChildDefinitions,
  getNodeSchemaInfo,
  getReplacementCandidates,
  importDraftDocument,
  localName,
  parseXmlSchema,
  parseXmlString,
  ReplacementMode,
  renderSourceXml,
  serializeXml,
} from "./editor-core";
import type {
  AnalysisResult,
  AttributeDefinition,
  AttributeNode,
  ElementDefinition,
  ElementNode,
  FuzzyOption,
  SchemaModel,
} from "./editor-core";
import demoLibrarySchema from "../fixtures/library.xsd?raw";
import demoLibraryValidXml from "../fixtures/library-valid.xml?raw";
import demoLibraryMigrationXml from "../fixtures/library-migration.xml?raw";
import demoLibraryDraft from "../fixtures/library-draft.json?raw";
import demoNoteSchema from "../fixtures/note.xsd?raw";
import demoNoteXml from "../fixtures/note.xml?raw";
import xsdSubsetMetaSchema from "../fixtures/xsd-subset-meta.xsd?raw";

type DocumentKind = "xml" | "xsd";
type DocumentMode = "edit" | "migration" | "freeform";
type PaletteMode = "search" | "input" | "textarea";

interface SchemaEntry {
  id: string;
  title: string;
  fileName: string;
  model: SchemaModel;
  sourceText: string;
  documentId: string | null;
  hidden?: boolean;
}

interface AppDocumentState {
  id: string;
  title: string;
  fileName: string;
  kind: DocumentKind;
  root: ElementNode;
  schemaId: string | null;
  schemaReferences: string[];
  mode: DocumentMode;
  readOnly: boolean;
  referenceUri?: string | null;
  allowAutoLeaveMigration: boolean;
  selectedId: string | null;
  analysis: AnalysisResult;
  schemaRegistrationId?: string | null;
  problemCursor?: number;
}

interface DraftDocumentPayload {
  title?: string;
  kind?: DocumentKind;
  root: ElementNode;
  schemaId?: string | null;
  schemaReferences?: string[];
  mode?: DocumentMode;
  readOnly?: boolean;
  referenceUri?: string | null;
  selectedId?: string | null;
  allowAutoLeaveMigration?: boolean;
  schemaRegistrationId?: string | null;
}

interface SearchPaletteOption extends FuzzyOption {
  value?: string;
  elementDef?: ElementDefinition | null;
  attributeDef?: AttributeDefinition | null;
}

interface PaletteConfig {
  mode?: PaletteMode;
  title: string;
  subtitle?: string;
  query?: string;
  options?: SearchPaletteOption[];
  onSelect?: (value: SearchPaletteOption | string) => void;
  placeholder?: string;
  submitLabel?: string;
  value?: string;
  allowFreeform?: boolean;
}

interface PaletteState {
  mode: PaletteMode;
  title: string;
  subtitle: string;
  query: string;
  options: SearchPaletteOption[];
  activeIndex: number;
  onSelect?: (value: SearchPaletteOption | string) => void;
  placeholder: string;
  submitLabel: string;
  value: string;
  allowFreeform: boolean;
}

interface SourceViewerState {
  title: string;
  content: string;
}

interface DemoFile {
  kind: "xsd" | "xml" | "draft";
  fileName: string;
  content: string;
}

type NodeSelectionContext =
  | { kind: "node"; node: ElementNode }
  | { kind: "attribute"; node: ElementNode; attribute: AttributeNode }
  | { kind: "text"; node: ElementNode };

type EditableValueTarget =
  | { kind: "attribute"; node: ElementNode; attribute: AttributeNode }
  | { kind: "text"; node: ElementNode };

interface AppState {
  documents: AppDocumentState[];
  activeDocumentId: string | null;
  schemas: Map<string, SchemaEntry>;
  clipboard: ElementNode | null;
  palette: PaletteState | null;
  sourceViewer: SourceViewerState | null;
  notice: string;
  showShortcutHints: boolean;
}

const appRoot = document.querySelector("#app");
if (!(appRoot instanceof HTMLDivElement)) {
  throw new Error("App root element not found.");
}
const app: HTMLDivElement = appRoot;

const state: AppState = {
  documents: [],
  activeDocumentId: null,
  schemas: new Map<string, SchemaEntry>(),
  clipboard: null,
  palette: null,
  sourceViewer: null,
  notice: "Load an XML schema to start a guided document.",
  showShortcutHints: false,
};

const BUILTIN_XSD_META_SCHEMA_ID = "builtin-xsd-subset-meta";

const DEMO_FILES: DemoFile[] = [
  { kind: "xsd", fileName: "library.xsd", content: demoLibrarySchema },
  { kind: "xsd", fileName: "note.xsd", content: demoNoteSchema },
  { kind: "xml", fileName: "library-valid.xml", content: demoLibraryValidXml },
  { kind: "xml", fileName: "library-migration.xml", content: demoLibraryMigrationXml },
  { kind: "draft", fileName: "library-draft.json", content: demoLibraryDraft },
  { kind: "xml", fileName: "note.xml", content: demoNoteXml },
];

function createEmptyAnalysis(): AnalysisResult {
  return {
    problems: [],
    nodeInfoById: new Map(),
    attributeInfoById: new Map(),
  };
}

function getVisibleSchemas(): SchemaEntry[] {
  return [...state.schemas.values()].filter((schema) => !schema.hidden);
}

function ensureBuiltinSchemas(): void {
  if (state.schemas.has(BUILTIN_XSD_META_SCHEMA_ID)) {
    return;
  }

  state.schemas.set(BUILTIN_XSD_META_SCHEMA_ID, {
    id: BUILTIN_XSD_META_SCHEMA_ID,
    title: "http://www.w3.org/2001/XMLSchema",
    fileName: "XMLSchema.xsd",
    model: parseXmlSchema(xsdSubsetMetaSchema),
    sourceText: xsdSubsetMetaSchema,
    documentId: null,
    hidden: true,
  });
}

function documentId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function basename(path = ""): string {
  return String(path).split(/[\\/]/).pop()!;
}

function withFreshIds(node: ElementNode): ElementNode {
  const freshNode = cloneNodeTree(node);
  const visit = (currentNode: ElementNode): ElementNode => {
    currentNode.id = `node-${crypto.randomUUID()}`;
    currentNode.attributes = currentNode.attributes.map((attribute) => ({
      ...attribute,
      id: `attr-${crypto.randomUUID()}`,
    }));
    currentNode.children = currentNode.children.map((child) => visit(child));
    return currentNode;
  };
  return visit(freshNode);
}

function escapeHtml(value = ""): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getActiveDocument(): AppDocumentState | null {
  return state.documents.find((documentState) => documentState.id === state.activeDocumentId) || null;
}

function getSchemaForDocument(documentState: AppDocumentState | null): SchemaModel | null {
  return documentState?.schemaId ? state.schemas.get(documentState.schemaId)?.model || null : null;
}

function setNotice(message: string): void {
  state.notice = message;
  render();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderShortcutHint(shortcut: string): string {
  return state.showShortcutHints && shortcut
    ? `<span class="shortcut-badge">${escapeHtml(shortcut)}</span>`
    : "";
}

function toggleShortcutHints(): void {
  state.showShortcutHints = !state.showShortcutHints;
  render();
  setNotice(state.showShortcutHints ? "Shortcut hints enabled." : "Shortcut hints hidden.");
}

function selectTabByNumber(index: number): void {
  const target = state.documents[index - 1];
  if (target) {
    selectDocument(target.id);
  }
}

function openSourceViewer(): void {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  const content = documentState.kind === "xsd"
    ? renderSourceXml(documentState.root)
    : renderSourceXml(documentState.root);
  state.sourceViewer = {
    title: `${documentState.title} source`,
    content,
  };
  render();
}

function closeSourceViewer(): void {
  state.sourceViewer = null;
  render();
}

function isHttpReference(reference: string): boolean {
  try {
    const url = new URL(reference);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveSchemaReference(reference: string, baseReference: string | null | undefined): string {
  if (isHttpReference(reference)) {
    return reference;
  }
  if (baseReference && isHttpReference(baseReference)) {
    try {
      return new URL(reference, baseReference).toString();
    } catch {
      return reference;
    }
  }
  return reference;
}

function collectSchemaReferencesFromRoot(root: ElementNode): string[] {
  const references = new Set<string>();
  const visit = (node: ElementNode): void => {
    const nodeName = localName(node.name);
    if (["import", "include", "redefine"].includes(nodeName)) {
      const schemaLocation = node.attributes.find((attribute) => localName(attribute.name) === "schemaLocation")?.value;
      if (schemaLocation) {
        references.add(schemaLocation);
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return [...references];
}

function getDocumentSchemaReferences(documentState: AppDocumentState): string[] {
  const references = new Set(documentState.schemaReferences);
  if (documentState.kind === "xsd") {
    references.add("http://www.w3.org/2001/XMLSchema");
    for (const reference of collectSchemaReferencesFromRoot(documentState.root)) {
      references.add(reference);
    }
  }
  return [...references];
}

function findLoadedSchemaDocument(reference: string): AppDocumentState | null {
  const expectedName = basename(reference);
  return state.documents.find((documentState) =>
    documentState.kind === "xsd"
    && (
      documentState.referenceUri === reference
      || documentState.fileName === expectedName
      || basename(documentState.fileName) === expectedName
    )) || null;
}

function ensureWritable(documentState: AppDocumentState): boolean {
  if (!documentState.readOnly) {
    return true;
  }
  setNotice("This linked schema is read-only.");
  return false;
}

function createReadonlySchemaDocument(fileName: string, xmlText: string, referenceUri: string): AppDocumentState {
  const parsed = parseXmlString(xmlText);
  const schemaReferences = [...new Set([...parsed.schemaReferences, ...collectSchemaReferencesFromRoot(parsed.root)])];
  return {
    id: documentId("schema-link"),
    title: `${basename(fileName)} (readonly)`,
    fileName: basename(fileName),
    kind: "xsd",
    root: parsed.root,
    schemaId: null,
    schemaReferences,
    mode: "freeform",
    readOnly: true,
    referenceUri,
    allowAutoLeaveMigration: false,
    selectedId: parsed.root.id,
    analysis: createEmptyAnalysis(),
    schemaRegistrationId: null,
  };
}

function createRegisteredReadonlySchemaDocument(schemaEntry: SchemaEntry): AppDocumentState {
  const documentState = createReadonlySchemaDocument(schemaEntry.fileName, schemaEntry.sourceText, schemaEntry.title);
  documentState.title = `${schemaEntry.title} (readonly)`;
  documentState.fileName = schemaEntry.fileName;
  documentState.schemaRegistrationId = schemaEntry.id;
  return documentState;
}

async function openSchemaReference(reference: string, baseReference?: string | null): Promise<void> {
  const resolvedReference = resolveSchemaReference(reference, baseReference);
  const loadedDocument = findLoadedSchemaDocument(resolvedReference) || findLoadedSchemaDocument(reference);
  if (loadedDocument) {
    selectDocument(loadedDocument.id);
    return;
  }

  if (!isHttpReference(resolvedReference)) {
    setNotice(`Schema "${basename(reference)}" is not loaded locally.`);
    return;
  }

  try {
    setNotice(`Loading schema "${resolvedReference}"...`);
    const response = await fetch(resolvedReference);
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
    const xmlText = await response.text();
    addDocument(createReadonlySchemaDocument(resolvedReference, xmlText, resolvedReference));
    setNotice(`Opened linked schema "${basename(resolvedReference)}" as read-only.`);
  } catch (error) {
    setNotice(`Could not load "${resolvedReference}": ${errorMessage(error)}`);
  }
}

function openSchemaById(schemaId: string): void {
  const schemaEntry = state.schemas.get(schemaId);
  if (!schemaEntry) {
    setNotice("That schema is not available.");
    return;
  }
  if (schemaEntry.documentId) {
    selectDocument(schemaEntry.documentId);
    return;
  }

  const documentState = createRegisteredReadonlySchemaDocument(schemaEntry);
  schemaEntry.documentId = documentState.id;
  addDocument(documentState);
  setNotice(`Opened schema "${schemaEntry.title}" as read-only.`);
}

function replacementModeFor(documentState: AppDocumentState): ReplacementMode | undefined {
  return documentState.mode === "migration" ? ReplacementMode.Migration : undefined;
}

function relinkSchemaByReference(documentState: AppDocumentState): void {
  if (!documentState?.schemaReferences?.length || documentState.schemaId) {
    return;
  }

  const candidates = getVisibleSchemas();
  for (const reference of documentState.schemaReferences) {
    const expected = basename(reference);
    const match = candidates.find((candidate) => candidate.fileName === expected);
    if (match) {
      documentState.schemaId = match.id;
      return;
    }
  }
}

function syncDocumentValidation(documentState: AppDocumentState): void {
  const schema = getSchemaForDocument(documentState);
  documentState.analysis = analyzeDocument(documentState.root, schema);
  if (schema && (documentState.kind === "xml" || documentState.kind === "xsd")) {
    const hasSchemaErrors = documentState.analysis.problems.some((problem) => problem.code !== "placeholder");
    if (hasSchemaErrors && documentState.mode !== "migration") {
      documentState.mode = "migration";
    } else if (!hasSchemaErrors && documentState.mode === "migration" && documentState.allowAutoLeaveMigration) {
      documentState.mode = "edit";
    }
  }
}

function syncAllXmlDocumentsForSchema(schemaId: string): void {
  for (const documentState of state.documents) {
    if (documentState.schemaId === schemaId) {
      syncDocumentValidation(documentState);
    }
  }
}

function syncSchemaLibraryFromDocument(documentState: AppDocumentState): void {
  if (documentState.kind !== "xsd" || !documentState.schemaRegistrationId) {
    return;
  }

  try {
    const xml = serializeXml(documentState.root, null);
    const schemaModel = parseXmlSchema(xml);
    const registered = state.schemas.get(documentState.schemaRegistrationId || "");
    if (!registered) {
      return;
    }
    registered.model = schemaModel;
    registered.sourceText = xml;
    syncAllXmlDocumentsForSchema(registered.id);
  } catch {
    // Keep the previous schema model until the user resolves malformed edits.
  }
}

function selectDocument(documentIdValue: string): void {
  state.activeDocumentId = documentIdValue;
  const documentState = getActiveDocument();
  if (documentState && !documentState.selectedId) {
    documentState.selectedId = documentState.root.id;
  }
  render();
}

function addDocument(documentState: AppDocumentState): void {
  relinkSchemaByReference(documentState);
  syncDocumentValidation(documentState);
  state.documents.push(documentState);
  if (documentState.kind === "xsd") {
    for (const existing of state.documents) {
      if (existing.kind === "xml" && !existing.schemaId) {
        relinkSchemaByReference(existing);
        syncDocumentValidation(existing);
      }
    }
  }
  state.activeDocumentId = documentState.id;
  render();
}

function ensureSelection(documentState: AppDocumentState) {
  const items = flattenVisibleItems(documentState.root);
  if (!items.length) {
    documentState.selectedId = documentState.root.id;
    return items;
  }

  if (!items.some((item) => item.id === documentState.selectedId)) {
    documentState.selectedId = items[0].id;
  }

  return items;
}

function createXmlDocument(fileName: string, xmlText: string): AppDocumentState {
  const parsed = parseXmlString(xmlText);
  return {
    id: documentId("xml"),
    title: fileName,
    fileName,
    kind: "xml",
    root: parsed.root,
    schemaId: null,
    schemaReferences: parsed.schemaReferences,
    mode: "edit",
    readOnly: false,
    referenceUri: null,
    allowAutoLeaveMigration: true,
    selectedId: parsed.root.id,
    analysis: createEmptyAnalysis(),
  };
}

function createSchemaDocument(fileName: string, xmlText: string, schemaModel: SchemaModel): AppDocumentState {
  const parsed = parseXmlString(xmlText);
  const schemaId = documentId("schema");
  state.schemas.set(schemaId, {
    id: schemaId,
    title: fileName,
    fileName,
    model: schemaModel,
    sourceText: xmlText,
    documentId: null,
  });

  return {
    id: documentId("xsd"),
    title: `${fileName}`,
    fileName,
    kind: "xsd",
    root: parsed.root,
    schemaId: BUILTIN_XSD_META_SCHEMA_ID,
    schemaReferences: [
      "http://www.w3.org/2001/XMLSchema",
      ...collectSchemaReferencesFromRoot(parsed.root),
    ],
    mode: "edit",
    readOnly: false,
    referenceUri: null,
    allowAutoLeaveMigration: true,
    selectedId: parsed.root.id,
    analysis: createEmptyAnalysis(),
    schemaRegistrationId: schemaId,
  };
}

function createDraftDocument(fileName: string, draftJson: string): AppDocumentState {
  const loaded = importDraftDocument<DraftDocumentPayload>(draftJson);
  return {
    id: documentId(loaded.kind || "draft"),
    title: loaded.title || fileName,
    fileName,
    kind: loaded.kind || "xml",
    root: loaded.root,
    schemaId: loaded.schemaId || null,
    schemaReferences: loaded.schemaReferences || [],
    mode: loaded.mode || "edit",
    readOnly: loaded.readOnly ?? false,
    referenceUri: loaded.referenceUri || null,
    allowAutoLeaveMigration: loaded.allowAutoLeaveMigration ?? true,
    selectedId: loaded.selectedId || loaded.root?.id,
    analysis: createEmptyAnalysis(),
    schemaRegistrationId: loaded.schemaRegistrationId || null,
  };
}

function openDetectedDocument(fileName: string, text: string): void {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    try {
      const loaded = importDraftDocument<DraftDocumentPayload>(trimmed);
      if (loaded?.root) {
        addDocument(createDraftDocument(fileName, trimmed));
        setNotice(`Restored draft "${fileName}".`);
        return;
      }
    } catch {
      // Fall through to XML detection.
    }
  }

  const parsedXml = parseXmlString(text);
  if (parsedXml.root.name === "schema") {
    const schemaModel = parseXmlSchema(text);
    const documentState = createSchemaDocument(fileName, text, schemaModel);
    const registered = state.schemas.get(documentState.schemaRegistrationId || "");
    if (registered) {
      registered.documentId = documentState.id;
    }
    addDocument(documentState);
    setNotice(`Loaded schema "${fileName}".`);
    return;
  }

  addDocument(createXmlDocument(fileName, text));
  setNotice(`Opened "${fileName}".`);
}

function sanitizeSuggestedName(name: string, fallback: string): string {
  const sanitized = name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
  return sanitized || fallback;
}

function inferPastedDocumentName(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "document.xml";
  }

  if (trimmed.startsWith("{")) {
    try {
      const loaded = importDraftDocument<DraftDocumentPayload>(trimmed);
      const title = loaded.title ? sanitizeSuggestedName(loaded.title, "document") : "document";
      return title.endsWith(".json") ? title : `${title}.draft.json`;
    } catch {
      return "document.json";
    }
  }

  try {
    const parsed = parseXmlString(trimmed);
    const rootName = sanitizeSuggestedName(localName(parsed.root.name) || "document", "document");
    return localName(parsed.root.name) === "schema" ? `${rootName}.xsd` : `${rootName}.xml`;
  } catch {
    return "document.xml";
  }
}

function loadDemoWorkspace(): void {
  for (const source of DEMO_FILES) {
    if (source.kind === "xsd") {
      const schemaModel = parseXmlSchema(source.content);
      const documentState = createSchemaDocument(source.fileName, source.content, schemaModel);
      const registered = state.schemas.get(documentState.schemaRegistrationId || "");
      if (registered) {
        registered.documentId = documentState.id;
      }
      addDocument(documentState);
      continue;
    }

    if (source.kind === "draft") {
      addDocument(createDraftDocument(source.fileName, source.content));
      continue;
    }

    addDocument(createXmlDocument(source.fileName, source.content));
  }

  setNotice("Loaded demo schemas, XML files, and a draft workspace from fixtures.");
}

function refreshDocument(documentState: AppDocumentState): void {
  syncDocumentValidation(documentState);
  syncSchemaLibraryFromDocument(documentState);
  render();
}

function nodeSelectionContext(documentState: AppDocumentState): NodeSelectionContext {
  const selected = findNodeById(documentState.root, documentState.selectedId || documentState.root.id);
  if (!selected) {
    return { kind: "node", node: documentState.root };
  }

  if ("kind" in selected && selected.kind === "attribute") {
    return { kind: "attribute", node: selected.node, attribute: selected.attribute };
  }

  if ("kind" in selected && selected.kind === "text") {
    return { kind: "text", node: selected.node };
  }

  return { kind: "node", node: selected };
}

function editableValueTarget(documentState: AppDocumentState): EditableValueTarget | null {
  const selection = nodeSelectionContext(documentState);
  if (selection.kind === "attribute") {
    return selection;
  }

  if (selection.kind === "text") {
    return selection;
  }

  const schema = getSchemaForDocument(documentState);
  const info = schema ? getNodeSchemaInfo(documentState.root, schema, selection.node.id) : null;
  const canEditText = !schema || info?.type?.kind === "simple" || info?.type?.textType;
  if (canEditText) {
    return { kind: "text", node: selection.node };
  }

  return null;
}

function openPalette(configuration: PaletteConfig): void {
  state.palette = {
    mode: configuration.mode || "search",
    title: configuration.title,
    subtitle: configuration.subtitle || "",
    query: configuration.query || "",
    options: configuration.options || [],
    activeIndex: 0,
    onSelect: configuration.onSelect,
    placeholder: configuration.placeholder || "",
    submitLabel: configuration.submitLabel || "Apply",
    value: configuration.value || "",
    allowFreeform: Boolean(configuration.allowFreeform),
  };
  render();
  queueMicrotask(() => {
    const paletteInput = document.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-palette-input]");
    paletteInput?.focus();
    if (paletteInput instanceof HTMLInputElement || paletteInput instanceof HTMLTextAreaElement) {
      paletteInput.select();
    }
  });
}

function closePalette(): void {
  state.palette = null;
  render();
}

function runPaletteSelection(option: SearchPaletteOption | string): void {
  if (!state.palette) {
    return;
  }

  const handler = state.palette.onSelect;
  closePalette();
  handler?.(option);
}

function getPaletteResults(): SearchPaletteOption[] {
  if (!state.palette) {
    return [];
  }

  if (state.palette.mode === "search") {
    return fuzzySearch(state.palette.query, state.palette.options).slice(0, 12);
  }

  return state.palette.options || [];
}

function openInputPalette(
  title: string,
  value: string,
  onSelect: (value: string) => void,
  options: { multiline?: boolean; subtitle?: string; placeholder?: string; submitLabel?: string } = {},
): void {
  openPalette({
    mode: options.multiline ? "textarea" : "input",
    title,
    subtitle: options.subtitle || "",
    value,
    placeholder: options.placeholder || "",
    submitLabel: options.submitLabel || "Save",
    onSelect: (selected) => {
      if (typeof selected === "string") {
        onSelect(selected);
      }
    },
  });
}

function updateNodeName(
  documentState: AppDocumentState,
  node: ElementNode,
  name: string,
  elementDef: ElementDefinition | null = null,
): void {
  node.name = name;
  node.placeholder = false;
  node.allowedNames = [];

  const schema = getSchemaForDocument(documentState);
  if (schema && documentState.mode !== "migration") {
    const targetDefinition = elementDef || schema.elements.get(name);
    if (targetDefinition) {
      fillRequiredScaffolding(node, schema, targetDefinition);
    }
  }

  refreshDocument(documentState);
}

function openReplaceNodePalette(initialQuery = ""): void {
  const documentState = getActiveDocument();
  if (!documentState || !ensureWritable(documentState)) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  if (selection.kind !== "node") {
    return;
  }

  const node = selection.node;
  const schema = getSchemaForDocument(documentState);
  if (!schema) {
    openInputPalette("Rename element", node.placeholder ? "" : node.name, (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      updateNodeName(documentState, node, trimmed);
      setNotice(`Renamed element to "${trimmed}".`);
    }, { placeholder: "Element name" });
    return;
  }

  const rawOptions = getReplacementCandidates(
    documentState.root,
    schema,
    node.id,
    replacementModeFor(documentState),
  );

  openPalette({
    title: node.placeholder ? "Replace placeholder" : "Replace node",
    subtitle: documentState.mode === "migration"
      ? "Migration rename keeps descendants and points to the next issue."
      : "Only schema-compatible replacements are shown.",
    query: initialQuery,
    options: rawOptions.map((option) => ({
      label: option.label || option.name,
      detail: option.detail || "",
      value: option.name || option.label,
      elementDef: option.elementDef || null,
    })),
    onSelect: (option) => {
      const selectedOption = typeof option === "string"
        ? { value: option, elementDef: null }
        : option;
      updateNodeName(documentState, node, String(selectedOption.value), selectedOption.elementDef || null);
      setNotice(`Replaced node with "${selectedOption.value}".`);
    },
  });
}

function openInsertChildPalette(): void {
  const documentState = getActiveDocument();
  if (!documentState || !ensureWritable(documentState)) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  const targetNode = selection.node;
  const schema = getSchemaForDocument(documentState);
  if (!schema) {
    openInputPalette("Insert child element", "", (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      targetNode.children.push(createElementNode(trimmed));
      refreshDocument(documentState);
      setNotice(`Inserted "${trimmed}".`);
    }, { placeholder: "Child element name" });
    return;
  }

  const options = getAllowedChildDefinitions(documentState.root, schema, targetNode.id)
    .filter((definition) => canAppendChild(documentState.root, schema, targetNode.id, definition))
    .map((definition) => ({
      label: definition.name,
      detail: definition.typeName || definition.refName || "element",
      value: definition.name,
      elementDef: definition,
    }));

  if (!options.length) {
    setNotice("No schema-valid child insertion is available at the current selection.");
    return;
  }

  openPalette({
    title: "Insert child node",
    subtitle: "Appends the node only when the schema still validates.",
    options,
    onSelect: (option) => {
      const selectedOption = typeof option === "string" ? null : option;
      if (!selectedOption?.elementDef) {
        return;
      }
      const newNode = createMinimalNodeFromDefinition(schema, selectedOption.elementDef);
      targetNode.children.push(newNode);
      documentState.selectedId = newNode.id;
      refreshDocument(documentState);
      setNotice(`Inserted child "${selectedOption.value}".`);
    },
  });
}

function openInsertAttributePalette(): void {
  const documentState = getActiveDocument();
  if (!documentState || !ensureWritable(documentState)) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  const targetNode = selection.node;
  const schema = getSchemaForDocument(documentState);

  if (!schema) {
    openInputPalette("Insert attribute", "", (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      targetNode.attributes.push({
        id: `attr-${crypto.randomUUID()}`,
        name: trimmed,
        value: "",
        placeholder: true,
        expectedValues: [],
      });
      refreshDocument(documentState);
      setNotice(`Inserted attribute "${trimmed}".`);
    }, { placeholder: "Attribute name" });
    return;
  }

  const currentAttributeNames = new Set(targetNode.attributes.map((attribute) => attribute.name));
  const options = getAllowedAttributeDefinitions(documentState.root, schema, targetNode.id)
    .filter((definition) => !currentAttributeNames.has(definition.name))
    .map((definition) => ({
      label: definition.name,
      detail: definition.valueType?.enumerations?.length
        ? `Expected: ${definition.valueType.enumerations.join(", ")}`
        : definition.use === "required"
          ? "Required"
          : "Optional",
      value: definition.name,
      attributeDef: definition,
    }));

  if (!options.length) {
    setNotice("All allowed attributes are already present.");
    return;
  }

  openPalette({
    title: "Insert attribute",
    options,
    onSelect: (option) => {
      const definition = typeof option === "string" ? null : option.attributeDef || null;
      if (!definition) {
        return;
      }
      targetNode.attributes.push({
        id: `attr-${crypto.randomUUID()}`,
        name: definition.name,
        value: "",
        placeholder: true,
        expectedValues: definition.valueType?.enumerations || [],
      });
      refreshDocument(documentState);
      setNotice(`Inserted attribute "${definition.name}".`);
    },
  });
}

function deleteSelection(): void {
  const documentState = getActiveDocument();
  if (!documentState || !ensureWritable(documentState)) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  const schema = getSchemaForDocument(documentState);

  if (selection.kind === "attribute") {
    if (schema && !canDeleteAttribute(documentState.root, schema, selection.node.id, selection.attribute.id)) {
      setNotice("This attribute is required by the schema and cannot be deleted.");
      return;
    }

    selection.node.attributes = selection.node.attributes.filter((attribute) => attribute.id !== selection.attribute.id);
    documentState.selectedId = selection.node.id;
    refreshDocument(documentState);
    setNotice(`Deleted attribute "${selection.attribute.name}".`);
    return;
  }

  if (selection.kind === "text") {
    selection.node.text = "";
    selection.node.textPlaceholder = true;
    refreshDocument(documentState);
    setNotice(`Cleared the value of "${selection.node.name}".`);
    return;
  }

  if (selection.node.id === documentState.root.id) {
    setNotice("The root node cannot be deleted.");
    return;
  }

  if (schema && !canDeleteNode(documentState.root, schema, selection.node.id)) {
    setNotice("Deleting this subtree would violate the schema.");
    return;
  }

  const visibleItems = flattenVisibleItems(documentState.root);
  const currentIndex = visibleItems.findIndex((item) => item.id === documentState.selectedId);
  const fallbackId = visibleItems[Math.max(currentIndex - 1, 0)]?.id || documentState.root.id;

  const removeNode = (node: ElementNode, targetId: string): void => {
    node.children = node.children.filter((child) => child.id !== targetId);
    for (const child of node.children) {
      removeNode(child, targetId);
    }
  };
  removeNode(documentState.root, selection.node.id);
  documentState.selectedId = fallbackId;
  refreshDocument(documentState);
  setNotice(`Deleted "${selection.node.name}".`);
}

function copySelection(): void {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  if (selection.kind !== "node") {
    setNotice("Select a node to copy.");
    return;
  }

  state.clipboard = cloneNodeTree(selection.node);
  setNotice(`Copied "${selection.node.name}" to the clipboard.`);
  render();
}

function pasteClipboard(): void {
  const documentState = getActiveDocument();
  if (!documentState || !state.clipboard || !ensureWritable(documentState)) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  const targetNode = selection.node;
  const schema = getSchemaForDocument(documentState);
  const pastedNode = withFreshIds(state.clipboard);

  if (schema && !canAppendChild(documentState.root, schema, targetNode.id, pastedNode.name, pastedNode)) {
    setNotice("The copied node is not valid at the current position.");
    return;
  }

  targetNode.children.push(pastedNode);
  documentState.selectedId = pastedNode.id;
  refreshDocument(documentState);
  setNotice(`Pasted "${pastedNode.name}".`);
}

function openAttributeEditor(
  documentState: AppDocumentState,
  target: Extract<EditableValueTarget, { kind: "attribute" }>,
  initialQuery = "",
): void {
  if (!ensureWritable(documentState)) {
    return;
  }
  const applyAttributeValue = (value: string): void => {
    target.attribute.value = value;
    target.attribute.placeholder = false;
    refreshDocument(documentState);
    const issues = documentState.analysis.problems.filter((problem) => problem.attrId === target.attribute.id);
    setNotice(issues.length ? issues[0].message : `Updated "${target.attribute.name}".`);
  };

  const schema = getSchemaForDocument(documentState);
  const schemaAttribute = schema
    ? getAllowedAttributeDefinitions(documentState.root, schema, target.node.id)
      .find((definition) => definition.name === localName(target.attribute.name))
    : null;
  const expectedValues = schemaAttribute?.valueType?.enumerations?.length
    ? schemaAttribute.valueType.enumerations
    : target.attribute.expectedValues;
  if (expectedValues?.length) {
    target.attribute.expectedValues = [...expectedValues];
    openPalette({
      title: `Edit ${target.attribute.name}`,
      subtitle: "Type to fuzzy-search the allowed values.",
      query: initialQuery || target.attribute.value,
      options: expectedValues.map((value) => ({
        label: value,
        detail: "allowed value",
        value,
      })),
      onSelect: (option) => {
          const selectedValue = typeof option === "string" ? option : String(option.value || "");
          applyAttributeValue(selectedValue);
        },
      });
    return;
  }

  openInputPalette(`Edit ${target.attribute.name}`, initialQuery || target.attribute.value, (value) => {
    applyAttributeValue(value);
  }, {
    placeholder: target.attribute.expectedValues?.length
      ? target.attribute.expectedValues.join(", ")
      : "Attribute value",
  });
}

function editCurrentValue(): void {
  const documentState = getActiveDocument();
  if (!documentState || !ensureWritable(documentState)) {
    return;
  }

  const target = editableValueTarget(documentState);
  if (!target) {
    setNotice("The current selection has no editable value.");
    return;
  }

  if (target.kind === "attribute") {
    openAttributeEditor(documentState, target);
    return;
  }

  openInputPalette(`Edit value for ${target.node.name}`, target.node.text || "", (value) => {
    target.node.text = value;
    target.node.textPlaceholder = false;
    refreshDocument(documentState);
    const issues = documentState.analysis.problems.filter((problem) => problem.nodeId === target.node.id && problem.code === "invalid-text");
    setNotice(issues.length ? issues[0].message : `Updated value for "${target.node.name}".`);
  }, {
    placeholder: "Element value",
  });
}

function toggleMigrationMode(): void {
  const documentState = getActiveDocument();
  if (!documentState || documentState.kind !== "xml" || !ensureWritable(documentState)) {
    return;
  }

  if (documentState.mode === "migration") {
    documentState.mode = "edit";
    documentState.allowAutoLeaveMigration = true;
  } else {
    documentState.mode = "migration";
    documentState.allowAutoLeaveMigration = false;
  }
  syncDocumentValidation(documentState);
  render();
  setNotice(`Switched to ${documentState.mode} mode.`);
}

function jumpToNextProblem(): void {
  const documentState = getActiveDocument();
  if (!documentState?.analysis?.problems?.length) {
    return;
  }

  const problems = documentState.analysis.problems;
  documentState.problemCursor = ((documentState.problemCursor || -1) + 1) % problems.length;
  const nextProblem = problems[documentState.problemCursor];
  documentState.selectedId = nextProblem.attrId || nextProblem.nodeId || documentState.root.id;
  render();
}

function maybeOpenLinkedSchema(): void {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  const linkedSchema = documentState.schemaId ? state.schemas.get(documentState.schemaId) : null;
  if (linkedSchema) {
    openSchemaById(linkedSchema.id);
    return;
  }

  const references = getDocumentSchemaReferences(documentState);
  if (!references.length) {
    setNotice("This document has no linked schema references.");
    return;
  }

  void openSchemaReference(references[0], documentState.referenceUri);
}

function createNewDocument(): void {
  const visibleSchemas = getVisibleSchemas();
  openPalette({
    title: "Create new",
    subtitle: "Choose whether to start with schema-guided XML, freeform XML, or a new XSD schema.",
    options: [
      {
        label: "XML from schema",
        detail: visibleSchemas.length ? "Create a minimal XML document from a loaded schema." : "No loaded schemas yet.",
        value: "xml-from-schema",
      },
      {
        label: "Freeform XML",
        detail: "Start with just a root element and no schema.",
        value: "xml-freeform",
      },
      {
        label: "Schema (XSD)",
        detail: "Create a new editable XSD document.",
        value: "xsd-schema",
      },
      {
        label: "Paste XML / XSD / draft",
        detail: "Paste source text and let the app detect what it is.",
        value: "paste-source",
      },
    ],
    onSelect: (option) => {
      const choice = typeof option === "string" ? option : option.value || "";
      if (choice === "xml-from-schema") {
        createSchemaGuidedXmlDocument();
        return;
      }
      if (choice === "xml-freeform") {
        createFreeformXmlDocument();
        return;
      }
      if (choice === "xsd-schema") {
        createNewSchemaDocument();
        return;
      }
      if (choice === "paste-source") {
        createPastedDocument();
      }
    },
  });
}

function createFreeformXmlDocument(): void {
  openInputPalette("Create freeform root element", "", (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    addDocument({
      id: documentId("xml"),
      title: `${trimmed}.xml`,
      fileName: `${trimmed}.xml`,
      kind: "xml",
      root: createElementNode(trimmed),
      schemaId: null,
      schemaReferences: [],
      mode: "freeform",
      readOnly: false,
      referenceUri: null,
      allowAutoLeaveMigration: false,
      selectedId: null,
      analysis: createEmptyAnalysis(),
    });
    setNotice(`Created freeform document "${trimmed}".`);
  }, { placeholder: "Root element name" });
}

function createSchemaGuidedXmlDocument(): void {
  const active = getActiveDocument();
  const visibleSchemas = getVisibleSchemas();
  const preferredSchemaId = active?.kind === "xml" ? active.schemaId : visibleSchemas[0]?.id;
  if (!preferredSchemaId) {
    setNotice("Load or create a schema first, or choose Freeform XML.");
    return;
  }

  const schema = state.schemas.get(preferredSchemaId)?.model;
  if (!schema) {
    return;
  }
  const rootOptions = schema.rootElements.map((name) => ({ label: name, value: name, detail: "root element" }));
  openPalette({
    title: "Create document from schema",
    subtitle: "A minimal valid tree is generated with placeholders where the schema branches.",
    options: rootOptions,
    onSelect: (option) => {
      const value = typeof option === "string" ? option : String(option.value || "");
      addDocument({
        id: documentId("xml"),
        title: `${value}.xml`,
        fileName: `${value}.xml`,
        kind: "xml",
        root: createMinimalDocument(schema, value),
        schemaId: preferredSchemaId,
        schemaReferences: [],
        mode: "edit",
        readOnly: false,
        referenceUri: null,
        allowAutoLeaveMigration: true,
        selectedId: null,
        analysis: createEmptyAnalysis(),
      });
      setNotice(`Created a new "${value}" document.`);
    },
  });
}

function createNewSchemaDocument(): void {
  const starterSchema = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="root" type="xs:string"/>
</xs:schema>`;
  const schemaModel = parseXmlSchema(starterSchema);
  const documentState = createSchemaDocument("schema.xsd", starterSchema, schemaModel);
  const registered = state.schemas.get(documentState.schemaRegistrationId || "");
  if (registered) {
    registered.documentId = documentState.id;
  }
  addDocument(documentState);
  setNotice('Created new schema "schema.xsd".');
}

function createPastedDocument(): void {
  openInputPalette("Paste XML, XSD, or draft", "", (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const fileName = inferPastedDocumentName(trimmed);
    openDetectedDocument(fileName, trimmed);
  }, {
    multiline: true,
    placeholder: "Paste XML, XSD, or draft JSON here",
    submitLabel: "Open pasted source",
    subtitle: "The app will detect whether the pasted content is XML, XSD, or a draft.",
  });
}

function downloadFile(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function saveDraft(): void {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  const payload = exportDraftDocument({
    title: documentState.title,
    kind: documentState.kind,
    root: documentState.root,
    schemaId: documentState.schemaId,
    schemaReferences: documentState.schemaReferences,
    mode: documentState.mode,
    readOnly: documentState.readOnly,
    referenceUri: documentState.referenceUri || null,
    selectedId: documentState.selectedId,
    allowAutoLeaveMigration: documentState.allowAutoLeaveMigration,
    schemaRegistrationId: documentState.schemaRegistrationId || null,
  });
  const extension = documentState.mode === "migration" ? ".migration.json" : ".draft.json";
  downloadFile(`${basename(documentState.fileName)}${extension}`, payload, "application/json");
  setNotice("Saved the placeholder-aware draft representation.");
}

function exportCurrentDocument(): void {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  try {
    const xml = serializeXml(documentState.root, getSchemaForDocument(documentState));
    const fileName = documentState.kind === "xsd"
      ? basename(documentState.fileName).replace(/\.json$/i, ".xsd")
      : basename(documentState.fileName).replace(/(\.draft)?\.json$/i, ".xml");
    downloadFile(fileName, xml, "application/xml");
    setNotice(`Exported "${fileName}".`);
  } catch (error) {
    setNotice(errorMessage(error));
  }
}

function handleFiles(files: FileList, processor: (fileName: string, text: string) => void): void {
  for (const file of Array.from(files)) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        processor(file.name, String(reader.result || ""));
      } catch (error) {
        setNotice(errorMessage(error));
      }
    };
    reader.readAsText(file);
  }
}

function closeDocument(documentIdValue: string): void {
  const index = state.documents.findIndex((documentState) => documentState.id === documentIdValue);
  if (index === -1) {
    return;
  }

  const [documentState] = state.documents.splice(index, 1);
  if (documentState.kind === "xsd" && documentState.schemaRegistrationId) {
    const schemaEntry = state.schemas.get(documentState.schemaRegistrationId);
    if (schemaEntry) {
      schemaEntry.documentId = null;
    }
  }

  if (state.activeDocumentId === documentIdValue) {
    state.activeDocumentId = state.documents[index]?.id || state.documents[index - 1]?.id || null;
  }
  render();
}

function updateSchemaLink(schemaId: string): void {
  const documentState = getActiveDocument();
  if (!documentState || documentState.kind !== "xml") {
    return;
  }

  documentState.schemaId = schemaId || null;
  documentState.mode = "edit";
  refreshDocument(documentState);
  setNotice(schemaId ? "Linked schema to the current document." : "Detached the schema from the current document.");
}

function moveSelection(delta: number): void {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  const items = ensureSelection(documentState);
  const index = items.findIndex((item) => item.id === documentState.selectedId);
  const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
  if (next) {
    documentState.selectedId = next.id;
    render();
  }
}

function collapseOrMoveToParent(): void {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  if (selection.kind === "node" && selection.node.children.length && !selection.node.collapsed) {
    selection.node.collapsed = true;
    render();
    return;
  }

  const info = documentState.analysis.nodeInfoById.get(selection.node.id);
  if (info?.parentId) {
    documentState.selectedId = info.parentId;
    render();
  }
}

function expandOrMoveToChild(): void {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  if (selection.kind !== "node") {
    return;
  }

  if (selection.node.children.length && selection.node.collapsed) {
    selection.node.collapsed = false;
    render();
    return;
  }

  const items = flattenVisibleItems(documentState.root);
  const index = items.findIndex((item) => item.id === documentState.selectedId);
  const next = items[index + 1];
  if (next) {
    documentState.selectedId = next.id;
    render();
  }
}

function renderNode(documentState: AppDocumentState, node: ElementNode, isRoot = false): string {
  const selectionClass = documentState.selectedId === node.id ? " selected" : "";
  const problemCount = documentState.analysis.problems.filter((problem) => problem.nodeId === node.id).length;
  const pills = [];
  if (node.placeholder) {
    pills.push('<span class="node-pill placeholder">placeholder</span>');
  }
  if (problemCount) {
    pills.push(`<span class="problem-pill error">${problemCount} problem${problemCount === 1 ? "" : "s"}</span>`);
  }

  const attributeRow = node.attributes.length
    ? `<span class="attribute-row inline-attributes">${node.attributes.map((attribute) => {
      const classes = ["attr-chip"];
      if (documentState.selectedId === attribute.id) {
        classes.push("selected");
      }
      if (attribute.placeholder) {
        classes.push("placeholder");
      }
      return `<button class="${classes.join(" ")}" data-select-id="${attribute.id}">
          <span class="attr-name">${escapeHtml(attribute.name)}</span>
          <span>${escapeHtml(attribute.value || "?")}</span>
        </button>`;
    }).join("")}</span>`
    : "";

  const showText = node.text || node.textPlaceholder;
  const inlineText = showText && node.attributes.length === 0
    ? `<button class="text-chip inline-text${documentState.selectedId === `text:${node.id}` ? " selected" : ""}${node.textPlaceholder ? " placeholder" : ""}" data-select-id="text:${node.id}">${escapeHtml(node.text || "?")}</button>`
    : "";
  const textRow = showText && !inlineText
    ? `<div class="text-row compact-text-row">
        <button class="text-chip${documentState.selectedId === `text:${node.id}` ? " selected" : ""}${node.textPlaceholder ? " placeholder" : ""}" data-select-id="text:${node.id}">${escapeHtml(node.text || "?")}</button>
      </div>`
    : "";

  const children = !node.collapsed && node.children.length
    ? `<div class="children">${node.children.map((child) => renderNode(documentState, child, false)).join("")}</div>`
    : "";

  return `<div class="node-card${isRoot ? " root-node" : ""}${node.placeholder ? " placeholder" : ""}${selectionClass}" data-select-id="${node.id}">
    <div class="node-header">
      ${node.children.length
        ? `<button class="node-toggle" data-action="toggle-collapse" data-node-id="${node.id}">${node.collapsed ? "+" : "-"}</button>`
        : ""}
      <span class="node-name">${escapeHtml(node.placeholder ? "placeholder" : node.name)}</span>
      ${attributeRow}
      ${inlineText}
      ${pills.join("")}
    </div>
    ${node.placeholder && node.allowedNames.length ? `<div class="muted">Allowed here: ${escapeHtml(node.allowedNames.join(", "))}</div>` : ""}
    ${textRow}
    ${children}
  </div>`;
}

function renderSidebar(documentState: AppDocumentState): string {
  const selection = nodeSelectionContext(documentState);
  const schema = getSchemaForDocument(documentState);
  const schemaReferences = getDocumentSchemaReferences(documentState);
  const linkedSchema = documentState.schemaId ? state.schemas.get(documentState.schemaId) || null : null;
  const extraSchemaReferences = linkedSchema
    ? schemaReferences.filter((reference) => reference !== linkedSchema.title)
    : schemaReferences;
  const info = selection.kind === "node"
    ? schema ? getNodeSchemaInfo(documentState.root, schema, selection.node.id) : null
    : schema ? getNodeSchemaInfo(documentState.root, schema, selection.node.id) : null;

  const selectionTitle = selection.kind === "attribute"
    ? `@${selection.attribute.name}`
    : selection.kind === "text"
      ? `${selection.node.name} value`
      : selection.node.placeholder
        ? "placeholder"
        : selection.node.name;

  const activeProblems = documentState.analysis.problems.filter((problem) => {
    if (selection.kind === "attribute") {
      return problem.attrId === selection.attribute.id;
    }
    if (selection.kind === "text") {
      return problem.nodeId === selection.node.id && problem.code === "invalid-text";
    }
    return problem.nodeId === selection.node.id;
  });

  return `
    <div class="sidebar-section">
      <h2 class="panel-title">Selection</h2>
      <div class="meta-list">
        <div class="meta-item">
          <div><strong>${escapeHtml(selectionTitle)}</strong></div>
          <div class="muted">${escapeHtml(documentState.mode)} mode</div>
          ${documentState.readOnly ? '<div class="header-note">Read-only linked schema.</div>' : ""}
          ${schema && info ? `<div class="header-note">Allowed children: ${escapeHtml(([...new Set(info.allowedChildren || [])]).join(", ") || "none")}</div>` : ""}
          ${schema && info ? `<div class="header-note">Allowed attributes: ${escapeHtml((info.allowedAttributes || []).join(", ") || "none")}</div>` : ""}
        </div>
      </div>
    </div>
    <div class="sidebar-section">
      <h2 class="panel-title">Schemas</h2>
      <div class="meta-list">
        ${linkedSchema
          ? `<div class="meta-item">
              <button class="schema-link-button" data-action="open-schema-id" data-schema-id="${linkedSchema.id}">${escapeHtml(linkedSchema.title)}</button>
              <div class="header-note">${escapeHtml(documentState.readOnly ? "Loaded locally." : "Used for validation.")}</div>
            </div>`
          : ""}
        ${extraSchemaReferences.map((reference) => {
          const resolvedReference = resolveSchemaReference(reference, documentState.referenceUri);
          const loadedReference = findLoadedSchemaDocument(resolvedReference) || findLoadedSchemaDocument(reference);
          return `<div class="meta-item">
            <button class="schema-link-button" data-action="open-schema-reference" data-schema-ref="${escapeHtml(reference)}">${escapeHtml(basename(reference) || reference)}</button>
            <div class="header-note">${escapeHtml(loadedReference ? "Loaded locally." : isHttpReference(resolvedReference) ? resolvedReference : reference)}</div>
          </div>`;
        }).join("") || '<div class="meta-item">No linked schemas for this document.</div>'}
      </div>
    </div>
    <div class="sidebar-section">
      <h2 class="panel-title">Problems</h2>
      <div class="problem-list">
        ${documentState.analysis.problems.length
      ? documentState.analysis.problems.slice(0, 12).map((problem) => `
            <div class="problem-item${problem.nodeId === documentState.selectedId || problem.attrId === documentState.selectedId ? " selected-problem" : ""}">
              <div>${escapeHtml(problem.message)}</div>
              <button data-select-id="${problem.attrId || problem.nodeId}">Jump</button>
            </div>
          `).join("")
      : '<div class="meta-item">No current validation problems.</div>'}
      </div>
      ${activeProblems.length ? `<div class="meta-item">${escapeHtml(activeProblems[0].message)}</div>` : ""}
    </div>
    <div class="sidebar-section">
      <h2 class="panel-title">Keyboard</h2>
      <div class="shortcut-list">
        <div class="meta-item shortcut-item"><span><kbd class="keycap">↑ ↓ ← →</kbd></span><span>navigate the tree</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Type</kbd></span><span>replace the selected node</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Enter</kbd></span><span>edit the selected value</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Ctrl + I</kbd> <kbd class="keycap">Ctrl + A</kbd></span><span>insert child or attribute</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Delete</kbd> <kbd class="keycap">Ctrl + C</kbd> <kbd class="keycap">Ctrl + V</kbd></span><span>delete, copy, paste</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Ctrl + M</kbd></span><span>toggle migration</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Ctrl + N</kbd></span><span>jump to next problem</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Ctrl + O</kbd></span><span>open XML, XSD, or draft files</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Ctrl + S</kbd> <kbd class="keycap">Ctrl + E</kbd></span><span>save draft or export XML/XSD</span></div>
        <div class="meta-item shortcut-item"><span><kbd class="keycap">Ctrl + L</kbd> <kbd class="keycap">1-9</kbd></span><span>toggle shortcut hints, then jump to a tab by number</span></div>
      </div>
    </div>
  `;
}

function renderSourceViewer(): string {
  if (!state.sourceViewer) {
    return "";
  }

  return `<div class="palette-backdrop" data-action="close-source-viewer">
    <div class="palette source-viewer" data-stop-close="true">
      <div class="source-viewer-header">
        <h2 class="panel-title">${escapeHtml(state.sourceViewer.title)}</h2>
        <button data-action="close-source-viewer">Close</button>
      </div>
      <pre class="source-viewer-content">${escapeHtml(state.sourceViewer.content)}</pre>
    </div>
  </div>`;
}

function renderPalette(): string {
  const palette = state.palette;
  if (!palette) {
    return "";
  }

  const results = getPaletteResults();
  if (palette.mode === "input" || palette.mode === "textarea") {
    const field = palette.mode === "textarea"
      ? `<textarea data-palette-input placeholder="${escapeHtml(palette.placeholder)}">${escapeHtml(palette.value)}</textarea>`
      : `<input data-palette-input value="${escapeHtml(palette.value)}" placeholder="${escapeHtml(palette.placeholder)}" />`;

    return `<div class="palette-backdrop" data-action="close-palette">
      <div class="palette" data-stop-close="true">
        <h2 class="panel-title">${escapeHtml(palette.title)}</h2>
        ${palette.subtitle ? `<div class="muted">${escapeHtml(palette.subtitle)}</div>` : ""}
        ${field}
        <button data-action="submit-palette">${escapeHtml(palette.submitLabel)}</button>
      </div>
    </div>`;
  }

  return `<div class="palette-backdrop" data-action="close-palette">
    <div class="palette" data-stop-close="true">
      <h2 class="panel-title">${escapeHtml(palette.title)}</h2>
      ${palette.subtitle ? `<div class="muted">${escapeHtml(palette.subtitle)}</div>` : ""}
      <input data-palette-input value="${escapeHtml(palette.query)}" placeholder="Type to filter..." />
      <div class="palette-list">
        ${results.length
      ? results.map((option, index) => `
            <button class="palette-option${index === palette.activeIndex ? " active" : ""}" data-palette-index="${index}">
              <strong>${escapeHtml(option.label)}</strong>
              <small>${escapeHtml(option.detail || "")}</small>
            </button>
          `).join("")
      : '<div class="meta-item">No matches</div>'}
      </div>
    </div>
  </div>`;
}

function render(): void {
  const documentState = getActiveDocument();
  if (documentState) {
    ensureSelection(documentState);
  }

  const schemaOptions = getVisibleSchemas().map((schema) =>
    `<option value="${schema.id}"${documentState?.schemaId === schema.id ? " selected" : ""}>${escapeHtml(schema.title)}</option>`).join("");

  app.innerHTML = `
    <div class="app-shell${documentState?.mode === "migration" ? " migration-mode" : ""}">
      <div class="topbar">
        <div class="topbar-group">
          <button data-action="new-document">New</button>
          <button data-action="open-file">Open${renderShortcutHint("Ctrl+O")}</button>
          <button data-action="load-demo">Load demo</button>
        </div>
        <div class="topbar-group">
          <button data-action="save-draft" ${documentState ? "" : "disabled"}>Save${renderShortcutHint("Ctrl+S")}</button>
          <button data-action="export" ${documentState ? "" : "disabled"}>Export${renderShortcutHint("Ctrl+E")}</button>
          <button data-action="view-source" ${documentState ? "" : "disabled"}>View source</button>
          <button data-action="validate" ${documentState ? "" : "disabled"}>Validate</button>
          <button data-action="toggle-migration" ${documentState && !documentState.readOnly && (documentState.kind === "xml" || documentState.kind === "xsd") ? "" : "disabled"}>Migration${renderShortcutHint("Ctrl+M")}</button>
          <button data-action="toggle-shortcuts">Hints${renderShortcutHint("Ctrl+L")}</button>
        </div>
        <div class="topbar-spacer"></div>
        <div class="topbar-group">
          <span class="toolbar-label">Schema</span>
          <select data-action="schema-link" ${documentState?.kind === "xml" ? "" : "disabled"}>
            <option value="">No schema</option>
            ${schemaOptions}
          </select>
          <button data-action="open-linked-schema" ${documentState && (documentState.schemaId || getDocumentSchemaReferences(documentState).length) ? "" : "disabled"}>Open linked schema</button>
        </div>
        <input id="document-input" type="file" accept=".xml,.xsd,.json,text/xml,application/json" multiple hidden />
      </div>
      <div class="tabbar">
        ${state.documents.map((entry) => `
          <button class="tab${entry.id === state.activeDocumentId ? " active" : ""}${entry.mode === "migration" ? " migration" : ""}" data-tab-id="${entry.id}">
            ${state.showShortcutHints ? `<span class="tab-shortcut">${state.documents.indexOf(entry) + 1}</span>` : ""}
            ${escapeHtml(entry.title)}
            <span data-close-id="${entry.id}">x</span>
          </button>
        `).join("")}
      </div>
      <div class="workspace">
        <div class="panel editor-panel">
          ${documentState
      ? `<h1 class="panel-title">${escapeHtml(documentState.title)}</h1>
                <div class="header-note">${escapeHtml(documentState.readOnly
          ? "Read-only linked schema view."
          : documentState.kind === "xml"
        ? getSchemaForDocument(documentState)
          ? `Schema-guided editing${documentState.mode === "migration" ? " in migration mode" : ""}.`
          : "Freeform XML editing. Load a schema for validation and guided insert/replace actions."
        : `Schema-guided XSD editing${documentState.mode === "migration" ? " in migration mode" : ""}. Edits here can refresh linked XML documents once the schema is well-formed.`)}</div>
                <div class="tree-root">${renderNode(documentState, documentState.root, true)}</div>`
      : '<div class="document-empty"><div><strong>No document open.</strong><div class="muted">Open a schema, create a new file, load a demo workspace, or load an XML document and the editor will render it as a navigable box tree.</div></div></div>'}
        </div>
        <div class="panel sidebar">
          ${documentState ? renderSidebar(documentState) : '<div class="meta-item">The sidebar fills in once a document is open.</div>'}
        </div>
      </div>
      <div class="statusbar">
        <div>${escapeHtml(state.notice)}</div>
        <div>${state.clipboard ? `Clipboard: ${escapeHtml(state.clipboard.name)}` : "Clipboard empty"}</div>
      </div>
      ${renderPalette()}
      ${renderSourceViewer()}
    </div>
  `;
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionTarget = target.closest("[data-action]");
  if (actionTarget instanceof HTMLElement) {
    const action = actionTarget.dataset.action;
    if (action === "close-palette") {
      if (target === actionTarget) {
        closePalette();
        return;
      }
    }
    else if (action === "close-source-viewer") {
      closeSourceViewer();
      return;
    }
    else if (action === "new-document") {
      createNewDocument();
      return;
    }
    else if (action === "open-file") {
      document.querySelector<HTMLInputElement>("#document-input")?.click();
      return;
    }
    else if (action === "load-demo") {
      loadDemoWorkspace();
      return;
    }
    else if (action === "toggle-shortcuts") {
      toggleShortcutHints();
      return;
    }
    else if (action === "save-draft") {
      saveDraft();
      return;
    }
    else if (action === "export") {
      exportCurrentDocument();
      return;
    }
    else if (action === "view-source") {
      openSourceViewer();
      return;
    }
    else if (action === "validate") {
      const active = getActiveDocument();
      if (active) {
        syncDocumentValidation(active);
        render();
        setNotice(active.analysis.problems.length ? `Validation found ${active.analysis.problems.length} problem(s).` : "The active document is currently valid.");
      }
      return;
    }
    else if (action === "toggle-migration") {
      toggleMigrationMode();
      return;
    }
    else if (action === "open-linked-schema") {
      maybeOpenLinkedSchema();
      return;
    }
    else if (action === "open-schema-reference") {
      const schemaRef = actionTarget.dataset.schemaRef;
      const active = getActiveDocument();
      if (schemaRef) {
        void openSchemaReference(schemaRef, active?.referenceUri);
      }
      return;
    }
    else if (action === "open-schema-id") {
      const schemaId = actionTarget.dataset.schemaId;
      if (schemaId) {
        openSchemaById(schemaId);
      }
      return;
    }
    else if (action === "toggle-collapse") {
      const active = getActiveDocument();
      const nodeId = actionTarget.dataset.nodeId;
      const node = active && nodeId ? findNodeById(active.root, nodeId) : null;
      if (node && !("kind" in node)) {
        node.collapsed = !node.collapsed;
        render();
      }
      return;
    }
    else if (action === "submit-palette") {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-palette-input]");
      const value = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : "";
      runPaletteSelection(value);
      return;
    }
  }

  const selectTarget = target.closest("[data-select-id]");
  if (selectTarget instanceof HTMLElement) {
    const active = getActiveDocument();
    if (active) {
      const selectedId = selectTarget.dataset.selectId;
      if (!selectedId) {
        return;
      }
      active.selectedId = selectedId;
      render();
    }
    return;
  }

  const paletteOption = target.closest("[data-palette-index]");
  if (paletteOption instanceof HTMLElement && state.palette) {
    const option = getPaletteResults()[Number(paletteOption.dataset.paletteIndex)];
    if (option) {
      runPaletteSelection(option);
    }
    return;
  }

  const closeTarget = target.closest("[data-close-id]");
  if (closeTarget instanceof HTMLElement) {
    event.stopPropagation();
    const closeId = closeTarget.dataset.closeId;
    if (closeId) {
      closeDocument(closeId);
    }
    return;
  }

  const tabTarget = target.closest("[data-tab-id]");
  if (tabTarget instanceof HTMLElement) {
    const tabId = tabTarget.dataset.tabId;
    if (tabId) {
      selectDocument(tabId);
    }
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target instanceof HTMLSelectElement && target.dataset.action === "schema-link") {
    updateSchemaLink(target.value);
    return;
  }

  if (target instanceof HTMLInputElement && target.type === "file") {
    if (target.id === "document-input" && target.files?.length) {
      handleFiles(target.files, (fileName, text) => {
        openDetectedDocument(fileName, text);
      });
    }

    target.value = "";
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !state.palette) {
    return;
  }

  if (target.matches("[data-palette-input]") && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    if (state.palette.mode === "search") {
      const cursor = target instanceof HTMLInputElement ? target.selectionStart : null;
      state.palette.query = target.value;
      state.palette.activeIndex = 0;
      render();
      queueMicrotask(() => {
        const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-palette-input]");
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
          input.focus();
          const caret = cursor ?? input.value.length;
          input.setSelectionRange(caret, caret);
        }
      });
    } else {
      state.palette.value = target.value;
    }
  }
});

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement;
  if (state.palette) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }

    if (state.palette.mode === "search") {
      const results = getPaletteResults();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        state.palette.activeIndex = Math.min(results.length - 1, state.palette.activeIndex + 1);
        render();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        state.palette.activeIndex = Math.max(0, state.palette.activeIndex - 1);
        render();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const option = results[state.palette.activeIndex];
        if (option) {
          runPaletteSelection(option);
        }
        return;
      }
      return;
    }

    if (event.key === "Enter" && activeElement instanceof HTMLInputElement) {
      event.preventDefault();
      runPaletteSelection(state.palette.value);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "enter") {
      event.preventDefault();
      runPaletteSelection(state.palette.value);
    }
    return;
  }

  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === "o") {
      event.preventDefault();
      document.querySelector<HTMLInputElement>("#document-input")?.click();
      return;
    }
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveDraft();
      return;
    }
    if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      exportCurrentDocument();
      return;
    }
    if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      openInsertChildPalette();
      return;
    }
    if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      openInsertAttributePalette();
      return;
    }
    if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelection();
      return;
    }
    if (event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteClipboard();
      return;
    }
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      toggleMigrationMode();
      return;
    }
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      jumpToNextProblem();
      return;
    }
    if (event.key.toLowerCase() === "l") {
      event.preventDefault();
      toggleShortcutHints();
      return;
    }
  }

  if (state.showShortcutHints && /^[1-9]$/.test(event.key)) {
    event.preventDefault();
    selectTabByNumber(Number(event.key));
    return;
  }

  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  switch (event.key) {
    case "ArrowUp":
      event.preventDefault();
      moveSelection(-1);
      return;
    case "ArrowDown":
      event.preventDefault();
      moveSelection(1);
      return;
    case "ArrowLeft":
      event.preventDefault();
      collapseOrMoveToParent();
      return;
    case "ArrowRight":
      event.preventDefault();
      expandOrMoveToChild();
      return;
    case "Delete":
    case "Backspace":
      event.preventDefault();
      deleteSelection();
      return;
    case "Enter":
      event.preventDefault();
      editCurrentValue();
      return;
    case "Escape":
      state.notice = "";
      render();
      return;
    default:
      break;
  }

  if (/^[\w-]$/.test(event.key)) {
    const selection = nodeSelectionContext(documentState);
    if (selection.kind === "node") {
      event.preventDefault();
      openReplaceNodePalette(event.key);
      return;
    }
    if (selection.kind === "attribute") {
      event.preventDefault();
      openAttributeEditor(documentState, selection, event.key);
    }
  }
});

ensureBuiltinSchemas();
render();
