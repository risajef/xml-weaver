# XML Weaver fix progress

Scope: fixes for the 6 November 2026 architecture review. All implementation commits remain in this subrepository; parent website publication and submodule-pointer commits are excluded.

| Review finding | Status | Verification |
| --- | --- | --- |
| 2. Draft HTML injection | Fixed | Runtime draft shape/depth checks, fresh restored IDs, escaped renderer identifiers; regression tests. |
| 1. Lossy XML round trips | Fixed | Ordered siblings, mixed text/tails, QName and whitespace round-trip regressions. |
| 3. XSD particle ordering | Pending | |
| 4. Syntax and schema validation | Pending | |
| 5. Namespace validation | Pending | |
| 6. Durable draft schema binding | Pending | |
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
