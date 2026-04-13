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
  parseXmlSchema,
  parseXmlString,
  serializeXml,
} from "./editor-core.ts";
import demoLibrarySchema from "../fixtures/library.xsd?raw";
import demoLibraryValidXml from "../fixtures/library-valid.xml?raw";
import demoLibraryMigrationXml from "../fixtures/library-migration.xml?raw";
import demoLibraryDraft from "../fixtures/library-draft.json?raw";
import demoNoteSchema from "../fixtures/note.xsd?raw";
import demoNoteXml from "../fixtures/note.xml?raw";

const app = document.querySelector("#app");

const state = {
  documents: [],
  activeDocumentId: null,
  schemas: new Map(),
  clipboard: null,
  palette: null,
  notice: "Load an XML schema to start a guided document.",
};

const DEMO_FILES = [
  { kind: "xsd", fileName: "library.xsd", content: demoLibrarySchema },
  { kind: "xsd", fileName: "note.xsd", content: demoNoteSchema },
  { kind: "xml", fileName: "library-valid.xml", content: demoLibraryValidXml },
  { kind: "xml", fileName: "library-migration.xml", content: demoLibraryMigrationXml },
  { kind: "draft", fileName: "library-draft.json", content: demoLibraryDraft },
  { kind: "xml", fileName: "note.xml", content: demoNoteXml },
];

function documentId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function basename(path = "") {
  return String(path).split(/[\\/]/).pop();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getActiveDocument() {
  return state.documents.find((documentState) => documentState.id === state.activeDocumentId) || null;
}

function getSchemaForDocument(documentState) {
  return documentState?.schemaId ? state.schemas.get(documentState.schemaId)?.model || null : null;
}

function setNotice(message) {
  state.notice = message;
  render();
}

function relinkSchemaByReference(documentState) {
  if (!documentState?.schemaReferences?.length || documentState.schemaId) {
    return;
  }

  const candidates = [...state.schemas.values()];
  for (const reference of documentState.schemaReferences) {
    const expected = basename(reference);
    const match = candidates.find((candidate) => candidate.fileName === expected);
    if (match) {
      documentState.schemaId = match.id;
      return;
    }
  }
}

function syncDocumentValidation(documentState) {
  const schema = getSchemaForDocument(documentState);
  documentState.analysis = analyzeDocument(documentState.root, schema);
  if (schema && documentState.kind === "xml") {
    const hasSchemaErrors = documentState.analysis.problems.some((problem) => problem.code !== "placeholder");
    if (hasSchemaErrors && documentState.mode !== "migration") {
      documentState.mode = "migration";
    } else if (!hasSchemaErrors && documentState.mode === "migration" && documentState.allowAutoLeaveMigration) {
      documentState.mode = "edit";
    }
  }
}

function syncAllXmlDocumentsForSchema(schemaId) {
  for (const documentState of state.documents) {
    if (documentState.schemaId === schemaId) {
      syncDocumentValidation(documentState);
    }
  }
}

function syncSchemaLibraryFromDocument(documentState) {
  if (documentState.kind !== "xsd" || !documentState.schemaRegistrationId) {
    return;
  }

  try {
    const xml = serializeXml(documentState.root, null);
    const schemaModel = parseXmlSchema(xml);
    const registered = state.schemas.get(documentState.schemaRegistrationId);
    registered.model = schemaModel;
    registered.sourceText = xml;
    syncAllXmlDocumentsForSchema(registered.id);
  } catch {
    // Keep the previous schema model until the user resolves malformed edits.
  }
}

function selectDocument(documentIdValue) {
  state.activeDocumentId = documentIdValue;
  const documentState = getActiveDocument();
  if (documentState && !documentState.selectedId) {
    documentState.selectedId = documentState.root.id;
  }
  render();
}

function addDocument(documentState) {
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

function ensureSelection(documentState) {
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

function createXmlDocument(fileName, xmlText) {
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
    allowAutoLeaveMigration: true,
    selectedId: parsed.root.id,
    analysis: { problems: [], nodeInfoById: new Map(), attributeInfoById: new Map() },
  };
}

function createSchemaDocument(fileName, xmlText, schemaModel) {
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
    title: `${fileName} (schema)`,
    fileName,
    kind: "xsd",
    root: parsed.root,
    schemaId: null,
    schemaReferences: [],
    mode: "freeform",
    allowAutoLeaveMigration: false,
    selectedId: parsed.root.id,
    analysis: { problems: [], nodeInfoById: new Map(), attributeInfoById: new Map() },
    schemaRegistrationId: schemaId,
  };
}

function createDraftDocument(fileName, draftJson) {
  const loaded = importDraftDocument(draftJson);
  return {
    id: documentId(loaded.kind || "draft"),
    title: loaded.title || fileName,
    fileName,
    kind: loaded.kind || "xml",
    root: loaded.root,
    schemaId: loaded.schemaId || null,
    schemaReferences: loaded.schemaReferences || [],
    mode: loaded.mode || "edit",
    allowAutoLeaveMigration: loaded.allowAutoLeaveMigration ?? true,
    selectedId: loaded.selectedId || loaded.root?.id,
    analysis: { problems: [], nodeInfoById: new Map(), attributeInfoById: new Map() },
    schemaRegistrationId: loaded.schemaRegistrationId || null,
  };
}

function loadDemoWorkspace() {
  for (const source of DEMO_FILES) {
    if (source.kind === "xsd") {
      const schemaModel = parseXmlSchema(source.content);
      const documentState = createSchemaDocument(source.fileName, source.content, schemaModel);
      const registered = state.schemas.get(documentState.schemaRegistrationId);
      registered.documentId = documentState.id;
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

function refreshDocument(documentState) {
  syncDocumentValidation(documentState);
  syncSchemaLibraryFromDocument(documentState);
  render();
}

function nodeSelectionContext(documentState) {
  const selected = findNodeById(documentState.root, documentState.selectedId);
  if (!selected) {
    return { kind: "node", node: documentState.root };
  }

  if (selected.kind === "attribute") {
    return { kind: "attribute", node: selected.node, attribute: selected.attribute };
  }

  if (selected.kind === "text") {
    return { kind: "text", node: selected.node };
  }

  return { kind: "node", node: selected };
}

function editableValueTarget(documentState) {
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

function openPalette(configuration) {
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
    document.querySelector("[data-palette-input]")?.focus();
    document.querySelector("[data-palette-input]")?.select?.();
  });
}

function closePalette() {
  state.palette = null;
  render();
}

function runPaletteSelection(option) {
  if (!state.palette) {
    return;
  }

  const handler = state.palette.onSelect;
  closePalette();
  handler?.(option);
}

function getPaletteResults() {
  if (!state.palette) {
    return [];
  }

  if (state.palette.mode === "search") {
    return fuzzySearch(state.palette.query, state.palette.options).slice(0, 12);
  }

  return state.palette.options || [];
}

function openInputPalette(title, value, onSelect, options = {}) {
  openPalette({
    mode: options.multiline ? "textarea" : "input",
    title,
    subtitle: options.subtitle || "",
    value,
    placeholder: options.placeholder || "",
    submitLabel: options.submitLabel || "Save",
    onSelect,
  });
}

function updateNodeName(documentState, node, name, elementDef = null) {
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

function openReplaceNodePalette(initialQuery = "") {
  const documentState = getActiveDocument();
  if (!documentState) {
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

  const rawOptions = getReplacementCandidates(documentState.root, schema, node.id, documentState.mode);

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
      updateNodeName(documentState, node, option.value, option.elementDef);
      setNotice(`Replaced node with "${option.value}".`);
    },
  });
}

function openInsertChildPalette() {
  const documentState = getActiveDocument();
  if (!documentState) {
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
      const newNode = createMinimalNodeFromDefinition(schema, option.elementDef);
      targetNode.children.push(newNode);
      documentState.selectedId = newNode.id;
      refreshDocument(documentState);
      setNotice(`Inserted child "${option.value}".`);
    },
  });
}

function openInsertAttributePalette() {
  const documentState = getActiveDocument();
  if (!documentState) {
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
      value: definition,
    }));

  if (!options.length) {
    setNotice("All allowed attributes are already present.");
    return;
  }

  openPalette({
    title: "Insert attribute",
    options,
    onSelect: (option) => {
      targetNode.attributes.push({
        id: `attr-${crypto.randomUUID()}`,
        name: option.value.name,
        value: "",
        placeholder: true,
        expectedValues: option.value.valueType?.enumerations || [],
      });
      refreshDocument(documentState);
      setNotice(`Inserted attribute "${option.value.name}".`);
    },
  });
}

function deleteSelection() {
  const documentState = getActiveDocument();
  if (!documentState) {
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

  const removeNode = (node, targetId) => {
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

function copySelection() {
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

function pasteClipboard() {
  const documentState = getActiveDocument();
  if (!documentState || !state.clipboard) {
    return;
  }

  const selection = nodeSelectionContext(documentState);
  const targetNode = selection.node;
  const schema = getSchemaForDocument(documentState);
  const pastedNode = cloneNodeTree(state.clipboard);

  if (schema && !canAppendChild(documentState.root, schema, targetNode.id, pastedNode.name, pastedNode)) {
    setNotice("The copied node is not valid at the current position.");
    return;
  }

  targetNode.children.push(pastedNode);
  documentState.selectedId = pastedNode.id;
  refreshDocument(documentState);
  setNotice(`Pasted "${pastedNode.name}".`);
}

function editCurrentValue() {
  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  const target = editableValueTarget(documentState);
  if (!target) {
    setNotice("The current selection has no editable value.");
    return;
  }

  if (target.kind === "attribute") {
    openInputPalette(`Edit ${target.attribute.name}`, target.attribute.value, (value) => {
      target.attribute.value = value;
      target.attribute.placeholder = false;
      refreshDocument(documentState);
      const schema = getSchemaForDocument(documentState);
      const issues = documentState.analysis.problems.filter((problem) => problem.attrId === target.attribute.id);
      setNotice(issues.length ? issues[0].message : `Updated "${target.attribute.name}".`);
    }, {
      placeholder: target.attribute.expectedValues?.length
        ? target.attribute.expectedValues.join(", ")
        : "Attribute value",
    });
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

function toggleMigrationMode() {
  const documentState = getActiveDocument();
  if (!documentState || documentState.kind !== "xml") {
    return;
  }

  documentState.mode = documentState.mode === "migration" ? "edit" : "migration";
  refreshDocument(documentState);
  setNotice(`Switched to ${documentState.mode} mode.`);
}

function jumpToNextProblem() {
  const documentState = getActiveDocument();
  if (!documentState?.analysis?.problems?.length) {
    return;
  }

  const problems = documentState.analysis.problems;
  documentState.problemCursor = ((documentState.problemCursor || -1) + 1) % problems.length;
  const nextProblem = problems[documentState.problemCursor];
  documentState.selectedId = nextProblem.attrId || nextProblem.nodeId;
  render();
}

function maybeOpenLinkedSchema() {
  const documentState = getActiveDocument();
  if (!documentState?.schemaReferences?.length) {
    return;
  }

  for (const reference of documentState.schemaReferences) {
    const name = basename(reference);
    const schemaEntry = [...state.schemas.values()].find((schema) => schema.fileName === name);
    if (schemaEntry?.documentId) {
      selectDocument(schemaEntry.documentId);
      return;
    }
  }

  setNotice("The referenced schema is not loaded yet.");
}

function createNewDocument() {
  const active = getActiveDocument();
  const preferredSchemaId = active?.kind === "xml" ? active.schemaId : [...state.schemas.keys()][0];
  if (!preferredSchemaId) {
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
        allowAutoLeaveMigration: false,
        selectedId: null,
        analysis: { problems: [], nodeInfoById: new Map(), attributeInfoById: new Map() },
      });
      setNotice(`Created freeform document "${trimmed}".`);
    }, { placeholder: "Root element name" });
    return;
  }

  const schema = state.schemas.get(preferredSchemaId).model;
  const rootOptions = schema.rootElements.map((name) => ({ label: name, value: name, detail: "root element" }));
  openPalette({
    title: "Create document from schema",
    subtitle: "A minimal valid tree is generated with placeholders where the schema branches.",
    options: rootOptions,
    onSelect: (option) => {
      addDocument({
        id: documentId("xml"),
        title: `${option.value}.xml`,
        fileName: `${option.value}.xml`,
        kind: "xml",
        root: createMinimalDocument(schema, option.value),
        schemaId: preferredSchemaId,
        schemaReferences: [],
        mode: "edit",
        allowAutoLeaveMigration: true,
        selectedId: null,
        analysis: { problems: [], nodeInfoById: new Map(), attributeInfoById: new Map() },
      });
      setNotice(`Created a new "${option.value}" document.`);
    },
  });
}

function downloadFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function saveDraft() {
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
    selectedId: documentState.selectedId,
    allowAutoLeaveMigration: documentState.allowAutoLeaveMigration,
    schemaRegistrationId: documentState.schemaRegistrationId || null,
  });
  const extension = documentState.mode === "migration" ? ".migration.json" : ".draft.json";
  downloadFile(`${basename(documentState.fileName)}${extension}`, payload, "application/json");
  setNotice("Saved the placeholder-aware draft representation.");
}

function exportCurrentDocument() {
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
    setNotice(error.message);
  }
}

function handleFiles(files, processor) {
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        processor(file.name, String(reader.result || ""));
      } catch (error) {
        setNotice(error.message);
      }
    };
    reader.readAsText(file);
  }
}

function closeDocument(documentIdValue) {
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

function updateSchemaLink(schemaId) {
  const documentState = getActiveDocument();
  if (!documentState || documentState.kind !== "xml") {
    return;
  }

  documentState.schemaId = schemaId || null;
  documentState.mode = "edit";
  refreshDocument(documentState);
  setNotice(schemaId ? "Linked schema to the current document." : "Detached the schema from the current document.");
}

function moveSelection(delta) {
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

function collapseOrMoveToParent() {
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

function expandOrMoveToChild() {
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

function renderNode(documentState, node) {
  const selectionClass = documentState.selectedId === node.id ? " selected" : "";
  const problemCount = documentState.analysis.problems.filter((problem) => problem.nodeId === node.id).length;
  const pills = [];
  if (node.placeholder) {
    pills.push('<span class="node-pill placeholder">placeholder</span>');
  }
  if (problemCount) {
    pills.push(`<span class="problem-pill error">${problemCount} problem${problemCount === 1 ? "" : "s"}</span>`);
  }
  if (documentState.mode === "migration") {
    pills.push('<span class="node-pill migration">migration</span>');
  }

  const attributeRow = node.attributes.length
    ? `<div class="attribute-row">${node.attributes.map((attribute) => {
        const classes = ["attr-chip"];
        if (documentState.selectedId === attribute.id) {
          classes.push("selected");
        }
        if (attribute.placeholder) {
          classes.push("placeholder");
        }
        return `<button class="${classes.join(" ")}" data-select-id="${attribute.id}">
          <strong>${escapeHtml(attribute.name)}</strong>
          <span>${escapeHtml(attribute.value || "value?")}</span>
        </button>`;
      }).join("")}</div>`
    : "";

  const showText = node.text || node.textPlaceholder;
  const textRow = showText
    ? `<div class="text-row">
        <button class="text-chip${documentState.selectedId === `text:${node.id}` ? " selected" : ""}${node.textPlaceholder ? " placeholder" : ""}" data-select-id="text:${node.id}">
          <strong>value</strong>
          <span>${escapeHtml(node.text || "value?")}</span>
        </button>
      </div>`
    : "";

  const children = !node.collapsed && node.children.length
    ? `<div class="children">${node.children.map((child) => renderNode(documentState, child)).join("")}</div>`
    : "";

  return `<div class="node-card${node.placeholder ? " placeholder" : ""}${selectionClass}" data-select-id="${node.id}">
    <div class="node-header">
      <button class="node-toggle" data-action="toggle-collapse" data-node-id="${node.id}">${node.children.length ? (node.collapsed ? "+" : "-") : "o"}</button>
      <span class="node-name">${escapeHtml(node.placeholder ? "placeholder" : node.name)}</span>
      ${pills.join("")}
    </div>
    ${node.placeholder && node.allowedNames.length ? `<div class="muted">Allowed here: ${escapeHtml(node.allowedNames.join(", "))}</div>` : ""}
    ${attributeRow}
    ${textRow}
    ${children}
  </div>`;
}

function renderSidebar(documentState) {
  const selection = nodeSelectionContext(documentState);
  const schema = getSchemaForDocument(documentState);
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
          ${schema && info ? `<div class="header-note">Allowed children: ${escapeHtml(([...new Set(info.allowedChildren || [])]).join(", ") || "none")}</div>` : ""}
          ${schema && info ? `<div class="header-note">Allowed attributes: ${escapeHtml((info.allowedAttributes || []).join(", ") || "none")}</div>` : ""}
        </div>
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
        <div class="meta-item">Arrow keys navigate the tree</div>
        <div class="meta-item">Type on a node to replace it</div>
        <div class="meta-item">Enter edits the selected value</div>
        <div class="meta-item">I inserts a child, A inserts an attribute</div>
        <div class="meta-item">Delete removes the selection, C copies, V pastes</div>
        <div class="meta-item">M toggles migration, N jumps to the next problem</div>
      </div>
    </div>
  `;
}

function renderPalette() {
  if (!state.palette) {
    return "";
  }

  const results = getPaletteResults();
  if (state.palette.mode === "input" || state.palette.mode === "textarea") {
    const field = state.palette.mode === "textarea"
      ? `<textarea data-palette-input placeholder="${escapeHtml(state.palette.placeholder)}">${escapeHtml(state.palette.value)}</textarea>`
      : `<input data-palette-input value="${escapeHtml(state.palette.value)}" placeholder="${escapeHtml(state.palette.placeholder)}" />`;

    return `<div class="palette-backdrop" data-action="close-palette">
      <div class="palette" data-stop-close="true">
        <h2 class="panel-title">${escapeHtml(state.palette.title)}</h2>
        ${state.palette.subtitle ? `<div class="muted">${escapeHtml(state.palette.subtitle)}</div>` : ""}
        ${field}
        <button data-action="submit-palette">${escapeHtml(state.palette.submitLabel)}</button>
      </div>
    </div>`;
  }

  return `<div class="palette-backdrop" data-action="close-palette">
    <div class="palette" data-stop-close="true">
      <h2 class="panel-title">${escapeHtml(state.palette.title)}</h2>
      ${state.palette.subtitle ? `<div class="muted">${escapeHtml(state.palette.subtitle)}</div>` : ""}
      <input data-palette-input value="${escapeHtml(state.palette.query)}" placeholder="Type to filter..." />
      <div class="palette-list">
        ${results.length
          ? results.map((option, index) => `
            <button class="palette-option${index === state.palette.activeIndex ? " active" : ""}" data-palette-index="${index}">
              <strong>${escapeHtml(option.label)}</strong>
              <small>${escapeHtml(option.detail || "")}</small>
            </button>
          `).join("")
          : '<div class="meta-item">No matches</div>'}
      </div>
    </div>
  </div>`;
}

function render() {
  const documentState = getActiveDocument();
  if (documentState) {
    ensureSelection(documentState);
  }

  const schemaOptions = [...state.schemas.values()].map((schema) =>
    `<option value="${schema.id}"${documentState?.schemaId === schema.id ? " selected" : ""}>${escapeHtml(schema.title)}</option>`).join("");

  app.innerHTML = `
    <div class="app-shell">
      <div class="topbar">
        <div class="topbar-group">
          <button data-action="new-document">New</button>
          <button data-action="open-xml">Open XML</button>
          <button data-action="open-xsd">Open XSD</button>
          <button data-action="open-draft">Open draft</button>
          <button data-action="load-demo">Load demo</button>
        </div>
        <div class="topbar-group">
          <button data-action="save-draft" ${documentState ? "" : "disabled"}>Save</button>
          <button data-action="export" ${documentState ? "" : "disabled"}>Export</button>
          <button data-action="validate" ${documentState ? "" : "disabled"}>Validate</button>
          <button data-action="toggle-migration" ${documentState?.kind === "xml" ? "" : "disabled"}>Migration</button>
        </div>
        <div class="topbar-spacer"></div>
        <div class="topbar-group">
          <span class="toolbar-label">Schema</span>
          <select data-action="schema-link" ${documentState?.kind === "xml" ? "" : "disabled"}>
            <option value="">No schema</option>
            ${schemaOptions}
          </select>
          <button data-action="open-linked-schema" ${documentState?.schemaReferences?.length ? "" : "disabled"}>Open linked schema</button>
        </div>
        <input id="xml-input" type="file" accept=".xml,text/xml" multiple hidden />
        <input id="xsd-input" type="file" accept=".xsd,.xml,text/xml" multiple hidden />
        <input id="draft-input" type="file" accept=".json,application/json" multiple hidden />
      </div>
      <div class="tabbar">
        ${state.documents.map((entry) => `
          <button class="tab${entry.id === state.activeDocumentId ? " active" : ""}" data-tab-id="${entry.id}">
            ${escapeHtml(entry.title)}
            <span class="schema-pill">${escapeHtml(entry.mode)}</span>
            <span data-close-id="${entry.id}">x</span>
          </button>
        `).join("")}
      </div>
      <div class="workspace">
        <div class="panel editor-panel">
          ${documentState
            ? `<h1 class="panel-title">${escapeHtml(documentState.title)}</h1>
               <div class="header-note">${escapeHtml(documentState.kind === "xml"
                 ? getSchemaForDocument(documentState)
                   ? `Schema-guided editing${documentState.mode === "migration" ? " in migration mode" : ""}.`
                   : "Freeform XML editing. Load a schema for validation and guided insert/replace actions."
                 : "Schema source tab. Edits here can refresh linked XML documents once the schema is well-formed.")}</div>
               <div class="tree-root">${renderNode(documentState, documentState.root)}</div>`
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
    else if (action === "new-document") {
      createNewDocument();
      return;
    }
    else if (action === "open-xml") {
      document.querySelector("#xml-input")?.click();
      return;
    }
    else if (action === "open-xsd") {
      document.querySelector("#xsd-input")?.click();
      return;
    }
    else if (action === "open-draft") {
      document.querySelector("#draft-input")?.click();
      return;
    }
    else if (action === "load-demo") {
      loadDemoWorkspace();
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
    else if (action === "toggle-collapse") {
      const active = getActiveDocument();
      const node = active ? findNodeById(active.root, actionTarget.dataset.nodeId) : null;
      if (node && !node.kind) {
        node.collapsed = !node.collapsed;
        render();
      }
      return;
    }
    else if (action === "submit-palette") {
      const input = document.querySelector("[data-palette-input]");
      const value = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : "";
      runPaletteSelection(value);
      return;
    }
  }

  const selectTarget = target.closest("[data-select-id]");
  if (selectTarget instanceof HTMLElement) {
    const active = getActiveDocument();
    if (active) {
      active.selectedId = selectTarget.dataset.selectId;
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
    closeDocument(closeTarget.dataset.closeId);
    return;
  }

  const tabTarget = target.closest("[data-tab-id]");
  if (tabTarget instanceof HTMLElement) {
    selectDocument(tabTarget.dataset.tabId);
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
    if (target.id === "xml-input" && target.files?.length) {
      handleFiles(target.files, (fileName, text) => {
        const documentState = createXmlDocument(fileName, text);
        addDocument(documentState);
        setNotice(`Opened "${fileName}".`);
      });
    }

    if (target.id === "xsd-input" && target.files?.length) {
      handleFiles(target.files, (fileName, text) => {
        const schemaModel = parseXmlSchema(text);
        const documentState = createSchemaDocument(fileName, text, schemaModel);
        const registered = state.schemas.get(documentState.schemaRegistrationId);
        registered.documentId = documentState.id;
        addDocument(documentState);
        setNotice(`Loaded schema "${fileName}".`);
      });
    }

    if (target.id === "draft-input" && target.files?.length) {
      handleFiles(target.files, (fileName, text) => {
        const documentState = createDraftDocument(fileName, text);
        addDocument(documentState);
        setNotice(`Restored draft "${fileName}".`);
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

  if (target.matches("[data-palette-input]")) {
    if (state.palette.mode === "search") {
      const cursor = target instanceof HTMLInputElement ? target.selectionStart : null;
      state.palette.query = target.value;
      state.palette.activeIndex = 0;
      render();
      queueMicrotask(() => {
        const input = document.querySelector("[data-palette-input]");
        if (input instanceof HTMLInputElement) {
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

  const documentState = getActiveDocument();
  if (!documentState) {
    return;
  }

  if (event.ctrlKey || event.metaKey) {
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

  const lower = event.key.toLowerCase();
  if (lower === "i") {
    event.preventDefault();
    openInsertChildPalette();
    return;
  }
  if (lower === "a") {
    event.preventDefault();
    openInsertAttributePalette();
    return;
  }
  if (lower === "c") {
    event.preventDefault();
    copySelection();
    return;
  }
  if (lower === "v") {
    event.preventDefault();
    pasteClipboard();
    return;
  }
  if (lower === "m") {
    event.preventDefault();
    toggleMigrationMode();
    return;
  }
  if (lower === "n") {
    event.preventDefault();
    jumpToNextProblem();
    return;
  }

  if (/^[\w-]$/.test(event.key)) {
    const selection = nodeSelectionContext(documentState);
    if (selection.kind === "node") {
      event.preventDefault();
      openReplaceNodePalette(event.key);
    }
  }
});

render();
