import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  arrayify,
  analyzeDocument,
  AttributeUse,
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
  isSchemaInfrastructureAttribute,
  localName,
  normalizeOccurs,
  parseXmlSchema,
  parseXmlString,
  ProblemCode,
  removeNodeFromTree,
  replaceNodeInTree,
  ReplacementMode,
  resolveBuiltinSimpleType,
  serializeXml,
  SimpleBase,
  validateSimpleValue,
  VisibleItemType,
} from "../src/editor-core";

const BOOKS_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:simpleType name="formatType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="hardcover" />
      <xs:enumeration value="paperback" />
    </xs:restriction>
  </xs:simpleType>
  <xs:complexType name="bookType">
    <xs:sequence>
      <xs:element name="title" type="xs:string" />
      <xs:choice minOccurs="1">
        <xs:element name="author" type="xs:string" />
        <xs:element name="editor" type="xs:string" />
      </xs:choice>
    </xs:sequence>
    <xs:attribute name="format" type="formatType" use="required" />
  </xs:complexType>
  <xs:element name="book" type="bookType" />
</xs:schema>`;

const schema = parseXmlSchema(BOOKS_SCHEMA);
const fixtureLibrarySchema = readFileSync(new URL("../fixtures/library.xsd", import.meta.url), "utf8");
const fixtureLibraryValidXml = readFileSync(new URL("../fixtures/library-valid.xml", import.meta.url), "utf8");

function makeValidBook() {
  const { root } = parseXmlString(`<book format="hardcover"><title>XML</title><author>Ada</author></book>`);
  return root;
}

describe("editor core helpers", () => {
  it("arrayify normalizes scalars and arrays", () => {
    expect(arrayify("x")).toEqual(["x"]);
    expect(arrayify(["x", "y"])).toEqual(["x", "y"]);
    expect(arrayify(null)).toEqual([]);
  });

  it("localName strips prefixes and attribute markers", () => {
    expect(localName("@_xsi:schemaLocation")).toBe("schemaLocation");
    expect(localName("xs:element")).toBe("element");
  });

  it("builtin simple types map to enum-backed bases", () => {
    expect(resolveBuiltinSimpleType("xs:boolean").base).toBe(SimpleBase.Boolean);
    expect(resolveBuiltinSimpleType("xs:int").base).toBe(SimpleBase.Number);
    expect(resolveBuiltinSimpleType("xs:string").base).toBe(SimpleBase.String);
  });

  it("schema infrastructure attributes are ignored during validation", () => {
    expect(isSchemaInfrastructureAttribute("xmlns:xsi")).toBe(true);
    expect(isSchemaInfrastructureAttribute("xsi:schemaLocation")).toBe(true);
    expect(isSchemaInfrastructureAttribute("format")).toBe(false);
  });

  it("normalizeOccurs supports defaults and unbounded maxima", () => {
    expect(normalizeOccurs({})).toEqual({ minOccurs: 1, maxOccurs: 1 });
    expect(normalizeOccurs({ "@_minOccurs": "0", "@_maxOccurs": "unbounded" })).toEqual({
      minOccurs: 0,
      maxOccurs: Number.POSITIVE_INFINITY,
    });
  });

  it("validateSimpleValue enforces enum, boolean, and number expectations", () => {
    expect(validateSimpleValue(resolveBuiltinSimpleType("xs:boolean"), "maybe")).toContain("boolean");
    expect(validateSimpleValue(resolveBuiltinSimpleType("xs:int"), "abc")).toContain("numeric");
    expect(validateSimpleValue(schema.simpleTypes.get("formatType"), "spiral")).toContain("hardcover");
    expect(validateSimpleValue(schema.simpleTypes.get("formatType"), "hardcover")).toBeNull();
  });
});

describe("schema parsing and analysis", () => {
  it("parses xml schema documents with an xml declaration", () => {
    expect(schema.rootElements).toEqual(["book"]);
    expect(schema.elements.get("book")?.name).toBe("book");
  });

  it("parses fixture schemas from disk", () => {
    const fixtureSchema = parseXmlSchema(fixtureLibrarySchema);
    expect(fixtureSchema.rootElements).toEqual(["library"]);
  });

  it("extracts schema references from xml documents", () => {
    const parsed = parseXmlString(`
      <book xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xsi:noNamespaceSchemaLocation="book.xsd"
            format="hardcover">
        <title>XML</title>
        <author>Ada</author>
      </book>
    `);
    expect(parsed.schemaReferences).toEqual(["book.xsd"]);
  });

  it("minimal document scaffolds required placeholders", () => {
    const root = createMinimalDocument(schema, "book");
    expect(root.name).toBe("book");
    expect(root.attributes[0]?.name).toBe("format");
    expect(root.attributes[0]?.placeholder).toBe(true);
    expect(root.children[0]?.name).toBe("title");
    expect(root.children[0]?.textPlaceholder).toBe(true);
    expect(root.children[1]?.placeholder).toBe(true);
    expect(root.children[1]?.allowedNames.sort()).toEqual(["author", "editor"]);
  });

  it("reports invalid attribute values", () => {
    const { root } = parseXmlString(`<book format="spiral"><title>XML</title><author>Ada</author></book>`);
    const analysis = analyzeDocument(root, schema);
    expect(analysis.problems.some((problem) => problem.code === ProblemCode.InvalidAttributeValue)).toBe(true);
  });

  it("treats namespace attributes as non-errors", () => {
    const { root } = parseXmlString(`
      <book xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xsi:noNamespaceSchemaLocation="book.xsd"
            format="hardcover">
        <title>XML</title>
        <author>Ada</author>
      </book>
    `);
    const analysis = analyzeDocument(root, schema);
    expect(analysis.problems).toEqual([]);
  });

  it("validates fixture xml against its fixture schema", () => {
    const fixtureSchema = parseXmlSchema(fixtureLibrarySchema);
    const parsed = parseXmlString(fixtureLibraryValidXml);
    const analysis = analyzeDocument(parsed.root, fixtureSchema);
    expect(analysis.problems).toEqual([]);
  });
});

describe("tree operations", () => {
  it("finds nodes, attributes, and text pseudo-nodes", () => {
    const root = makeValidBook();
    const title = root.children[0];
    const attribute = root.attributes[0];
    expect(findNodeById(root, root.id)).toBe(root);
    expect(findNodeById(root, attribute.id)).toMatchObject({ kind: "attribute", attribute });
    expect(findNodeById(root, `text:${title.id}`)).toMatchObject({ kind: "text", node: title });
  });

  it("clones and replaces nodes immutably", () => {
    const root = makeValidBook();
    const clone = cloneNodeTree(root);
    const replaced = replaceNodeInTree(root, root.children[1]!.id, (node) => ({ ...node, name: "editor" }));
    expect(clone).not.toBe(root);
    expect(replaced.children[1]?.name).toBe("editor");
    expect(root.children[1]?.name).toBe("author");
  });

  it("removes nodes without mutating the original tree", () => {
    const root = makeValidBook();
    const next = removeNodeFromTree(root, root.children[1]!.id);
    expect(root.children).toHaveLength(2);
    expect(next.children).toHaveLength(1);
  });

  it("exposes schema info and allowed edits", () => {
    const root = makeValidBook();
    const info = getNodeSchemaInfo(root, schema, root.id);
    expect(info?.allowedAttributes).toEqual(["format"]);
    expect(getAllowedAttributeDefinitions(root, schema, root.id).map((attribute) => attribute.name)).toEqual(["format"]);
    expect(getAllowedChildDefinitions(root, schema, root.id).map((child) => child.name)).toEqual(["title", "author", "editor"]);
  });

  it("fills required scaffolding on renamed nodes", () => {
    const titleDefinition = schema.elements.get("book")!;
    const node = createElementNode("book");
    fillRequiredScaffolding(node, schema, titleDefinition);
    expect(node.attributes[0]?.name).toBe("format");
    expect(node.children[0]?.name).toBe("title");
  });

  it("offers replacement candidates and respects migration mode", () => {
    const root = makeValidBook();
    const candidates = getReplacementCandidates(root, schema, root.children[1]!.id);
    expect(candidates.map((candidate) => candidate.name)).toContain("author");
    expect(getReplacementCandidates(root, schema, root.children[1]!.id, ReplacementMode.Migration).length).toBeGreaterThan(0);
  });

  it("checks delete and append permissions from the schema", () => {
    const root = makeValidBook();
    expect(canDeleteNode(root, schema, root.children[1]!.id)).toBe(false);
    expect(canDeleteAttribute(root, schema, root.id, root.attributes[0]!.id)).toBe(false);
    const placeholderRoot = createMinimalDocument(schema, "book");
    const titleNode = placeholderRoot.children[0]!;
    const authorDef = getAllowedChildDefinitions(placeholderRoot, schema, placeholderRoot.id).find((child) => child.name === "author")!;
    expect(canAppendChild(placeholderRoot, schema, titleNode.id, authorDef)).toBe(false);
  });

  it("creates minimal nodes from definitions", () => {
    const minimalRoot = createMinimalDocument(schema, "book");
    const authorDef = getAllowedChildDefinitions(minimalRoot, schema, minimalRoot.id)
      .find((child) => child.name === "author")!;
    const node = createMinimalNodeFromDefinition(schema, authorDef);
    expect(node.name).toBe("author");
    expect(node.textPlaceholder).toBe(true);
  });
});

describe("serialization and drafts", () => {
  it("exports valid xml with a declaration", () => {
    const xml = serializeXml(makeValidBook(), schema);
    expect(xml).toMatch(/^\<\?xml version="1\.0" encoding="UTF-8"\?\>/);
    expect(xml).toContain('<book format="hardcover">');
    expect(xml).toContain("<author>Ada</author>");
  });

  it("round-trips draft payloads", () => {
    const payload = { root: makeValidBook(), mode: "edit" };
    expect(importDraftDocument<typeof payload>(exportDraftDocument(payload))).toEqual(payload);
  });

  it("flattens the visible tree structure", () => {
    const items = flattenVisibleItems(makeValidBook());
    expect(items[0]).toMatchObject({ type: VisibleItemType.Node });
    expect(items.some((item) => item.type === VisibleItemType.Attribute)).toBe(true);
    expect(items.some((item) => item.type === VisibleItemType.Text)).toBe(true);
  });

  it("ranks fuzzy matches by relevance", () => {
    const options = fuzzySearch("auth", [
      { label: "author", detail: "person node" },
      { label: "editor", detail: "other node" },
    ]);
    expect(options[0]?.label).toBe("author");
  });

  it("preserves attribute-use enums in parsed schemas", () => {
    expect(schema.complexTypes.get("bookType")?.attributes[0]?.use).toBe(AttributeUse.Required);
  });
});
