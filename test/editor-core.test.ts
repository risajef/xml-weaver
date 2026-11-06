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
    expect(root.attributes.find((attribute) => attribute.name === "format")?.name).toBe("format");
    expect(root.attributes.find((attribute) => attribute.name === "format")?.placeholder).toBe(true);
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


describe("draft trust boundary", () => {
  it("rejects malformed nested trees and metadata", () => {
    expect(() => importDraftDocument('{"root":{"name":"x"}}')).toThrow("Invalid");
    expect(() => importDraftDocument('{"schemaReferences":[4]}')).toThrow("references");
    expect(() => importDraftDocument('{"mode":"anything"}')).toThrow("mode");
    expect(() => importDraftDocument('[]')).toThrow("object");
  });
});


describe("ordered XML round trips", () => {
  it.each([
    '<r><a>1</a><b>2</b><a>3</a></r>',
    '<p>before <b>bold</b> after <i>italic</i> end</p>',
    '<p:r xmlns:p="urn:correct"><p:a>one</p:a></p:r>',
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r" type="xs:string"></xs:element></xs:schema>',
    '<r>  white space  </r>',
  ])("preserves content and lexical namespaces: %s", (input) => {
    expect(serializeXml(parseXmlString(input).root, null).split("\n").slice(1).join("\n")).toBe(input);
  });
  it("rejects constructs it cannot preserve", () => {
    expect(() => parseXmlString('<r><!--note--></r>')).toThrow("not supported");
    expect(() => parseXmlString('<?custom x?><r/>')).toThrow("not supported");
  });
});


describe("XSD particle ordering", () => {
  const ordered = parseXmlSchema(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
    <xs:element name="r"><xs:complexType><xs:sequence>
      <xs:element name="a" type="xs:string"/>
      <xs:choice><xs:element name="b" type="xs:string"/><xs:element name="c" type="xs:string"/></xs:choice>
      <xs:element name="d" type="xs:string"/>
    </xs:sequence></xs:complexType></xs:element></xs:schema>`);
  it("accepts the declared order and rejects the grouped permutation", () => {
    expect(analyzeDocument(parseXmlString('<r><a>1</a><b>2</b><d>3</d></r>').root, ordered).problems).toEqual([]);
    expect(analyzeDocument(parseXmlString('<r><a>1</a><d>3</d><b>2</b></r>').root, ordered).problems.length).toBeGreaterThan(0);
    expect(createMinimalDocument(ordered, "r").children.map((node) => node.name)).toEqual(["a", "placeholder", "d"]);
  });
});


describe("fail-closed validation", () => {
  it.each(['<r><a>one</r>', '<r/><s/>', '<!DOCTYPE r><r/>'])('rejects invalid/unsupported XML %s', (text) => {
    expect(() => parseXmlString(text)).toThrow();
  });
  it.each(['1.5', '0x10', '', '2147483648', 'Infinity'])('rejects invalid xs:int %s', (value) => {
    const schema = parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r" type="xs:int"/></xs:schema>');
    expect(() => serializeXml(parseXmlString(`<r>${value}</r>`).root, schema)).toThrow();
  });
  it("rejects unsupported facets and unresolved types", () => {
    expect(() => parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r" type="missing"/></xs:schema>')).toThrow("unresolved");
    expect(() => parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="t"><xs:restriction base="xs:string"><xs:pattern value="[A-Z]+"/></xs:restriction></xs:simpleType></xs:schema>')).toThrow("Unsupported");
  });
  it("checks names and characters at export", () => {
    expect(() => serializeXml(createElementNode("bad name"), null)).toThrow("name");
    expect(() => serializeXml(createElementNode("r", {text: "\u0001"}), null)).toThrow("character");
  });
});


describe("namespace identity", () => {
  const schema = parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:expected"><xs:element name="r" type="xs:string"/></xs:schema>');
  it("rejects a wrong namespace and accepts any prefix for the right URI", () => {
    expect(() => serializeXml(parseXmlString('<r xmlns="urn:wrong">ok</r>').root, schema)).toThrow();
    expect(serializeXml(parseXmlString('<p:r xmlns:p="urn:expected">ok</p:r>').root, schema)).toContain('<p:r');
    const minimal = createMinimalDocument(schema, "r");
    minimal.text = "ok"; minimal.textPlaceholder = false;
    expect(serializeXml(minimal, schema)).toContain('xmlns="urn:expected"');
  });
  it("resolves schema-instance attributes by URI", () => {
    expect(parseXmlString('<r xmlns:s="http://www.w3.org/2001/XMLSchema-instance" s:noNamespaceSchemaLocation="a.xsd"/>').schemaReferences).toEqual(["a.xsd"]);
  });
  it("rejects unbound prefixes and non-XSD schema namespaces", () => {
    expect(() => parseXmlString('<p:r/>')).toThrow("Unbound");
    expect(() => parseXmlSchema('<schema><element name="r" type="string"/></schema>')).toThrow("namespace");
  });
});


describe("resource budgets", () => {
  it("rejects required recursive scaffolds with an actionable error", () => {
    const recursive = parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r"><xs:complexType><xs:sequence><xs:element ref="r"/></xs:sequence></xs:complexType></xs:element></xs:schema>');
    expect(() => createMinimalDocument(recursive, "r")).toThrow("finite minimal tree");
    expect(analyzeDocument(parseXmlString('<r/>').root, recursive).problems.length).toBeGreaterThan(0);
  });
  it.each([{ "@_minOccurs":"2x" }, { "@_minOccurs":"-1" }, { "@_minOccurs":"2", "@_maxOccurs":"1" }, { "@_minOccurs":"999999999" }])("rejects invalid occurrence bounds %j", (input) => {
    expect(() => normalizeOccurs(input)).toThrow();
  });
  it("rejects oversized and excessively deep input before parsing", () => {
    expect(() => parseXmlString('<r>' + 'x'.repeat(1024*1024) + '</r>')).toThrow("limit");
    expect(() => parseXmlString('<r>'.repeat(200) + '</r>'.repeat(200))).toThrow("limits");
  });
});


describe("complete edit validation", () => {
  it("prevents deleting required children even when an optional sibling remains", () => {
    const s = parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r"><xs:complexType><xs:sequence><xs:element name="a" type="xs:string" minOccurs="0"/><xs:element name="b" type="xs:string"/></xs:sequence></xs:complexType></xs:element></xs:schema>');
    const root = parseXmlString('<r><a>x</a><b>y</b></r>').root;
    expect(canDeleteNode(root, s, root.children[1].id)).toBe(false);
  });
  it("checks values inside pasted descendants", () => {
    const s = parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r"><xs:complexType><xs:sequence><xs:element name="a" type="xs:int" minOccurs="0" maxOccurs="unbounded"/></xs:sequence></xs:complexType></xs:element></xs:schema>');
    const root = parseXmlString('<r/>').root;
    expect(canAppendChild(root, s, root.id, "a", parseXmlString('<a>invalid</a>').root)).toBe(false);
  });
});


describe("nullable content groups", () => {
  it("allows required groups whose children are optional", () => {
    const s = parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r"><xs:complexType><xs:sequence minOccurs="2" maxOccurs="2"><xs:element name="a" type="xs:string" minOccurs="0"/></xs:sequence></xs:complexType></xs:element></xs:schema>');
    expect(analyzeDocument(parseXmlString('<r/>').root,s).problems).toEqual([]);
    expect(analyzeDocument(parseXmlString('<r><a>x</a></r>').root,s).problems).toEqual([]);
  });
});


describe("supported schema symbol resolution", () => {
  it("resolves forward simple types and preserves builtin namespace identity", () => {
    const s = parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="derived"><xs:restriction base="base"/></xs:simpleType><xs:simpleType name="base"><xs:restriction base="xs:int"/></xs:simpleType><xs:simpleType name="string"><xs:restriction base="xs:int"/></xs:simpleType><xs:element name="r" type="xs:string"/></xs:schema>');
    expect(s.simpleTypes.get("derived")?.base).toBe(SimpleBase.Number);
    expect(analyzeDocument(parseXmlString('<r>text</r>').root,s).problems).toEqual([]);
  });
  it("rejects duplicate declarations and widening enumeration restrictions", () => {
    expect(() => parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r" type="xs:string"/><xs:element name="r" type="xs:int"/></xs:schema>')).toThrow("Duplicate");
    expect(() => parseXmlSchema('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="a"><xs:restriction base="xs:string"><xs:enumeration value="a"/></xs:restriction></xs:simpleType><xs:simpleType name="b"><xs:restriction base="a"><xs:enumeration value="b"/></xs:restriction></xs:simpleType></xs:schema>')).toThrow("enumeration");
  });
});
