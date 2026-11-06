import { beforeEach, describe, expect, it, vi } from "vitest";

class Div { innerHTML = ""; }
const root = new Div();
vi.stubGlobal("HTMLDivElement", Div);
vi.stubGlobal("document", { querySelector: () => root, addEventListener: vi.fn() });
const app = await import("../src/app");
const schemaText = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r" type="xs:int"/></xs:schema>';

beforeEach(() => {
  app.state.documents = [];
  app.state.activeDocumentId = null;
  for (const key of app.state.schemas.keys()) if (key !== "builtin-xsd-subset-meta") app.state.schemas.delete(key);
});

describe("draft workspace restoration", () => {
  it("uses embedded schemas across workspace sessions", () => {
    app.openDetectedDocument("r.xml", "<r>bad</r>");
    const original = app.state.documents.at(-1)!;
    const restored = app.createDraftDocument("r.draft.json", JSON.stringify({ formatVersion: 1, root: original.root, schemaId: "expired-session-id", schemaRequired: true, schemaSource: {fileName:"r.xsd",sourceText:schemaText} }));
    app.addDocument(restored);
    expect(restored.analysis.problems.some((problem) => problem.code === "invalid-text")).toBe(true);
    expect(restored.root.id).not.toBe(original.root.id);
  });
  it("keeps a missing legacy schema visible and blocks validation", () => {
    app.openDetectedDocument("r.xml", "<r>5</r>");
    const restored = app.createDraftDocument("old.json", JSON.stringify({ root: app.state.documents[0].root, schemaId:"old-id" }));
    app.addDocument(restored);
    expect(restored.analysis.problems.some((problem) => problem.code === "schema-unavailable")).toBe(true);
    app.updateSchemaLink("");
    expect(restored.analysis.problems).toEqual([]);
  });
  it("never renders imported identifiers as HTML", () => {
    app.openDetectedDocument("r.xml", "<r/>");
    const tree = structuredClone(app.state.documents[0].root);
    tree.id = 'x"><img src=x onerror="alert(1)">';
    app.addDocument(app.createDraftDocument("hostile.json", JSON.stringify({root:tree})));
    expect(root.innerHTML).not.toContain("<img");
  });
});


describe("edit transaction boundary", () => {
  it("rolls back invalid values in edit mode and permits them in explicit migration mode", () => {
    app.openDetectedDocument("r.xsd", schemaText);
    app.openDetectedDocument("r.xml", '<r>5</r>');
    const doc = app.state.documents.at(-1)!;
    app.updateSchemaLink([...app.state.schemas.keys()].find((key) => key !== "builtin-xsd-subset-meta")!);
    expect(app.commitDocumentEdit(doc, () => { doc.root.text = "bad"; })).toBe(false);
    expect(doc.root.text).toBe("5");
    doc.mode = "migration"; doc.allowAutoLeaveMigration = false;
    expect(app.commitDocumentEdit(doc, () => { doc.root.text = "bad"; })).toBe(true);
    expect(doc.analysis.problems.some((problem) => problem.code === "invalid-text")).toBe(true);
  });
});


describe("schema lifecycle", () => {
  it("registers remote schemas for validation without basename collisions", async () => {
    app.openDetectedDocument("r.xml", '<r xmlns:i="http://www.w3.org/2001/XMLSchema-instance" i:noNamespaceSchemaLocation="https://example.test/a/schema.xsd">bad</r>');
    const doc = app.state.documents[0];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(schemaText)));
    await app.openSchemaReference("https://example.test/a/schema.xsd");
    expect(doc.analysis.problems.some((problem) => problem.code === "invalid-text")).toBe(true);
    await app.openSchemaReference("https://example.test/b/schema.xsd");
    expect(app.state.documents.filter((entry) => entry.kind === "xsd")).toHaveLength(2);
  });
  it("blocks dependents when the current schema fails compilation", () => {
    app.openDetectedDocument("r.xsd", schemaText);
    const xsd = app.state.documents[0];
    app.openDetectedDocument("r.xml", '<r>5</r>');
    const doc = app.state.documents[1];
    app.updateSchemaLink(xsd.schemaRegistrationId!);
    xsd.root.children[0].attributes.find((attribute) => attribute.name === "type")!.value = "missing";
    app.refreshDocument(xsd);
    expect(doc.analysis.problems.some((problem) => problem.code === "schema-unavailable")).toBe(true);
    xsd.root.children[0].attributes.find((attribute) => attribute.name === "type")!.value = "xs:int";
    app.refreshDocument(xsd);
    expect(doc.analysis.problems).toEqual([]);
  });
});
