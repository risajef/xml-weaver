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
| 7. Edit invariants | Pending | |
| 8. Resource limits | Pending | |
| 9. Schema lifecycle | Pending | |
| 10. Recovery and history | Pending | |
| Additional: focus, rendering, CI, standalone theme | Pending | |

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
