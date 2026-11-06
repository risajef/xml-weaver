# xml-weaver

Keyboard-first XML and XSD editor for schema-guided editing in the browser.

## Demo

Click [here](retoweber.info/tools/xml-weaver)

## Features

- compact tree view for XML and XSD
- schema-guided editing with placeholders
- migration mode for fixing invalid documents
- open local and remote linked schemas
- export XML/XSD and save draft state

## Development

```bash
npm install
npm run dev
```

## Build and test

```bash
npm test
npm run build
```

## Supported XML and XSD

XML 1.0 elements, attributes, namespaces, text and ordered mixed content round-trip. Comments, processing instructions other than the XML declaration, and DTD/entity declarations are rejected explicitly. The tree view edits leading text while preserving trailing mixed-content text.

Schema validation uses an explicit XSD subset: named/inline simple and complex types, element references, ordered sequences/choices, occurrence bounds, attributes, simple-content extension, and enumeration restrictions. Builtins: string, boolean, integer, int, long, short, decimal, float, double. Unsupported constructs/facets (including patterns, imports/includes, complex-content derivation, lists, unions, wildcards and identity constraints) produce compilation errors. This is not a full XSD implementation.

Resource limits: 1 MiB XML input, 8 MiB draft input, 5,000 elements, 128 levels, 1,000 attributes per element, finite occurrence bounds up to 1,000, and 10,000 matching steps per content model. Oversized or excessively ambiguous documents fail explicitly.

## Recovery

Undo/redo: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y). Unsaved tabs show an asterisk. Editable workspaces are stored locally in this browser for crash/reload recovery, up to 16 MiB (subject to browser storage quota); failures are reported. Use Save for a portable draft, including its schema, or Export for validated XML. Browser recovery contains document content, so clear site storage when using a shared browser.

## Regression checks

Node 22.12+ is required (CI uses Node 24). `npm ci` installs the browser-test dependency and its Chromium. Run `npm test`, `npm run build`, and `npm run test:browser`. Independent schema comparisons use `npm run test:conformance` and require Python 3 with lxml (`python3 -m pip install lxml==6.0.2`). CI runs all four commands. Browser tests cover imports, injection protection, keyboard focus, transactions, undo/redo, reload recovery and actual downloads.
