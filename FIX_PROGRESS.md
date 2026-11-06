# XML Weaver fix progress

Scope: fixes for the 6 November 2026 architecture review. All implementation commits remain in this subrepository; parent website publication and submodule-pointer commits are excluded.

| Review finding | Status | Verification |
| --- | --- | --- |
| 2. Draft HTML injection | Fixed | Runtime draft shape/depth checks, fresh restored IDs, escaped renderer identifiers; regression tests. |
| 1. Lossy XML round trips | Fixed | Ordered siblings, mixed text/tails, QName and whitespace round-trip regressions. |
| 3. XSD particle ordering | Fixed | Alternating element/choice/element conformance and scaffolding regression. |
| 4. Syntax and schema validation | Fixed | Malformed XML, final export, numeric lexical/range checks and unsupported schema regressions. |
| 5. Namespace validation | Fixed | Namespace URI matching, qualified scaffolds, alternate xsi prefix and unbound-prefix tests. |
| 6. Durable draft schema binding | Fixed | Cross-session embedded schema, legacy missing-schema and hostile-ID controller tests. |
| 7. Edit invariants | Fixed | Required-child deletion, invalid paste and transactional controller rollback tests. |
| 8. Resource limits | Fixed | Input/depth limits, strict occurrences, recursive scaffolding and bounded matching. |
| 9. Schema lifecycle | Fixed | Remote registration, distinct URI identity and stale-schema/recompile controller tests. |
| 10. Recovery and history | Fixed | Undo/redo, dirty-close protection, validated browser recovery and corrupt-recovery tests. |
| Additional: focus and rendering | Fixed | Preserve input/caret and native controls; count problems once and update notices locally. |
| Additional: standalone theme | Fixed | Removed implicit parent stylesheet; local CSS owns all variables. |
| Additional: CI/conformance/browser tests | Pending | |

## Changes

### Fix 2 — validate draft input and protect HTML identifiers

Draft imports validate tree and metadata shapes before use. Restoring a draft allocates fresh IDs and clears stale selection. Renderer identifier attributes are escaped even for internally produced IDs. Malformed JSON structures fail before workspace insertion.

### Fix 1 — preserve ordered XML content

Replaced object-key serialization with ordered XML emission. Element QNames and text tails survive import, draft storage, and export; formatting does not introduce new text. Unsupported comments/processing instructions are rejected explicitly rather than discarded. The current UI edits leading text; trailing mixed-content text remains preserved in the model. Full tests and typecheck pass.

### Fix 3 — compile particles in declaration order

The schema parser preserves original child order separately from named lookup. Particle compilation consumes that order, so repeated element tags no longer jump across intervening choices or sequences. Tests cover both valid and invalid permutations and generated scaffolding.

### Fix 4 — fail closed at parsing and export

Added explicit XML syntax/character/name checks and final-output revalidation. Unsupported XSD features and unresolved element/type references fail compilation. Numeric builtin lexical rules and integer bounds replace JavaScript Number coercion; empty numeric/boolean values are invalid. Documented the deliberately limited XSD contract instead of claiming general conformance.

### Fix 5 — validate namespace identities

Schema compilation resolves QName namespaces and rejects foreign/unbound references. Document analysis compares namespace URIs for elements/attributes and applies schema qualification defaults. Scaffolds carry explicit default bindings; schema-instance references work with any bound prefix. Corrected the bundled subset meta-schema to be a namespace-correct XSD. The supported schema contract remains single-schema: imports/includes are explicitly rejected.

### Fix 6 — version drafts and restore schema enforcement

Version 1 drafts embed the selected schema source and an explicit schema requirement. Restoring compiles a fresh registry entry rather than trusting session IDs. Legacy missing links produce a visible blocking error until loaded or explicitly detached. XSD drafts receive a new registration identity. Controller tests exercise actual workspace operations with a minimal DOM adapter.

### Fix 8 — bound parsing, matching and scaffolding

Inputs are limited to 1 MiB, 5,000 elements, 128 levels and 1,000 attributes per element. Finite occurrence bounds are integers up to 1,000; required recursive scaffolds fail with a useful error rather than stack overflow. Matching has a 10,000-step budget per content model. File sizes are checked before reading; fetched bodies are streamed with a byte limit. Worker offloading remains optional within these explicit limits.

### Fix 7 — validate edits as transactions

All content-edit actions use a shared transaction boundary: snapshot, mutate, syntax/namespace check, full schema analysis, commit or rollback. Normal mode allows only placeholder problems; migration mode explicitly permits schema violations. Paste/delete/replacement suggestions use complete analysis. Child insertion offers positions before existing siblings as well as append. Scaffolding merges required children by matching names instead of child counts. Core and controller regressions cover the reported failures.

### Fix 9 — explicit schema identity and compilation state

Remote XSDs are compiled, registered and linked by full URI. Local references link only when an exact filename match is unique; remote paths never fall back to basenames. Registry entries carry revision/error state, and failed recompilation blocks dependents instead of silently validating against old models. Edited schema-location attributes are recomputed. Fetching has a timeout and bounded streaming. Multi-schema imports remain explicitly unsupported.

### Fix 10 — history, dirty state and browser recovery

Content transactions record bounded undo/redo snapshots (30 steps, approximately 4 MiB history per document). Tabs show unsaved state; closing dirty documents and leaving the page invoke browser protection. Save/export establishes a saved baseline. Editable documents are recovered through validated versioned drafts in localStorage, with atomic rollback on corrupt recovery. Storage failure is reported and disk saving remains available. Recovery is local to this browser and origin; it is not cloud storage.

### Additional fix — preserve focus and reduce repeated rendering

Full renders restore the active palette input/caret or toolbar control. Native text/select controls keep their keyboard behavior outside palettes. Source-viewer shortcuts are isolated. Notices update their DOM region without rebuilding the tree, and per-node problem counts are computed once per render. Palette action errors surface as notices; rejected rename notices are no longer overwritten by success text. Browser interaction checks are included in the final validation stage.

### Additional fix — standalone styling

Removed the parent-repository theme URL and unused host theme markers. Existing local CSS supplies the application appearance, including an explicit panel-blur fallback. No parent page or asset was modified.

### Validation follow-up — nullable required groups

Independent lxml comparisons exposed rejection of empty content for required groups whose children are optional. Matching now handles zero-consuming occurrences without an infinite loop, including repeated nullable groups. Added core regressions; the independent comparison now passes.

### Validation follow-up — supported-schema symbol and grammar checks

Simple types now resolve forward references with cycle detection. Builtin types remain distinct from same-local-name user types. Duplicate declarations, invalid declaration structure and widening enumeration restrictions fail compilation. Enumeration equality preserves decimal precision and floating infinity semantics. Added regressions and retained the explicit subset contract.
