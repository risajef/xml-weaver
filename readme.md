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
