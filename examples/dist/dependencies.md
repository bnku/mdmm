# mdmm Dependency Report

Scope: `examples`
Generated: `2026-05-10T06:29:21.980Z`
View: `direct dependencies only`

## Summary

| Metric | Value |
| --- | ---: |
| Processed files | 7 |
| Direct dependencies | 16 |
| Unique referenced blocks | 9 |
| Markdown dependencies | 4 |
| Diagram dependencies | 8 |
| Fragment dependencies | 4 |

## Hotspots

### Most Reused Blocks

| Type | Block | Uses | Consumer files |
| --- | --- | ---: | ---: |
| `diagram` | `examples/shared/customer-templates.md#template.customer-overview` | 3 | 1 |
| `diagram` | `examples/shared/customer-templates.md#template.wrapper` | 3 | 1 |
| `markdown` | `examples/shared/customer-templates.md#template.markdown` | 2 | 1 |
| `fragment` | `examples/shared/customer-templates.md#template-verification` | 2 | 1 |
| `fragment` | `examples/shared/verification-fragment.md#verification-fragment` | 2 | 1 |
| `markdown` | `examples/shared/markdown-sections.md#customer-verification.alias-section` | 1 | 1 |
| `markdown` | `examples/shared/markdown-sections.md#customer-verification.section` | 1 | 1 |
| `diagram` | `examples/shared/customer-verification.md#customer-verification.overview` | 1 | 1 |
| `diagram` | `examples/shared/customer-verification.md#customer-verification.short` | 1 | 1 |

### Files With Most Dependencies

| File | Dependencies | Type mix |
| --- | ---: | --- |
| `examples/docs/template-diagram.md` | 3 | `3 diagram` |
| `examples/docs/template-nested.md` | 3 | `3 diagram` |
| `examples/docs/diagram-include.md` | 2 | `2 diagram` |
| `examples/docs/fragment-include.md` | 2 | `2 fragment` |
| `examples/docs/markdown-include.md` | 2 | `2 markdown` |
| `examples/docs/template-fragment.md` | 2 | `2 fragment` |
| `examples/docs/template-markdown.md` | 2 | `2 markdown` |

## Block Usage Index

### Markdown Blocks

#### `examples/shared/customer-templates.md#template.markdown`
Type: `markdown`
Uses: `2`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/template-markdown.md` | `template.markdown` | - | `name="Alice"` |
| `examples/docs/template-markdown.md` | `template.markdown` | - | `name="Bob"` |

#### `examples/shared/markdown-sections.md#customer-verification.alias-section`
Type: `markdown`
Uses: `1`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/markdown-include.md` | `../shared/markdown-sections.md#customer-verification.alias-section` | - | - |

#### `examples/shared/markdown-sections.md#customer-verification.section`
Type: `markdown`
Uses: `1`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/markdown-include.md` | `customer-verification.section` | - | - |

### Diagram Blocks

#### `examples/shared/customer-templates.md#template.customer-overview`
Type: `diagram`
Uses: `3`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/template-diagram.md` | `../shared/customer-templates.md#template.customer-overview` | - | `escalator="COO", owner="Customer Success", reviewer="Compliance"` |
| `examples/docs/template-diagram.md` | `template.customer-overview` | - | `owner="Risk Ops", reviewer="Legal"` |
| `examples/docs/template-diagram.md` | `template.customer-overview` | - | `escalator="Head of Operations", owner="Sales Ops"` |

#### `examples/shared/customer-templates.md#template.wrapper`
Type: `diagram`
Uses: `3`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/template-nested.md` | `template.wrapper` | - | `fragmentRef="template-audit", reviewer="Legal"` |
| `examples/docs/template-nested.md` | `template.wrapper` | - | `fragmentRef="template-verification", reviewer="Legal"` |
| `examples/docs/template-nested.md` | `template.wrapper` | - | `fragmentRef="../shared/customer-templates.md#template-audit", owner="Risk Ops", reviewer="Legal"` |

#### `examples/shared/customer-verification.md#customer-verification.overview`
Type: `diagram`
Uses: `1`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/diagram-include.md` | `customer-verification.overview` | - | - |

#### `examples/shared/customer-verification.md#customer-verification.short`
Type: `diagram`
Uses: `1`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/diagram-include.md` | `../shared/customer-verification.md#customer-verification.short` | - | - |

### Fragment Blocks

#### `examples/shared/customer-templates.md#template-verification`
Type: `fragment`
Uses: `2`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/template-fragment.md` | `../shared/customer-templates.md#template-verification` | `ops` | `owner="Sales Ops", reviewer="Finance"` |
| `examples/docs/template-fragment.md` | `template-verification` | `risk` | `owner="Risk Ops", reviewer="Legal"` |

#### `examples/shared/verification-fragment.md#verification-fragment`
Type: `fragment`
Uses: `2`
Consumer files: `1`

| Used by | Reference | Alias | Args |
| --- | --- | --- | --- |
| `examples/docs/fragment-include.md` | `../shared/verification-fragment.md#verification-fragment` | `explicit` | - |
| `examples/docs/fragment-include.md` | `verification-fragment` | `kyc` | - |

## File Dependency Index

### `examples/docs/diagram-include.md`
Dependencies: `2`
Type mix: `2 diagram`

| Type | Reference | Target block | Alias | Args |
| --- | --- | --- | --- | --- |
| `diagram` | `customer-verification.overview` | `examples/shared/customer-verification.md#customer-verification.overview` | - | - |
| `diagram` | `../shared/customer-verification.md#customer-verification.short` | `examples/shared/customer-verification.md#customer-verification.short` | - | - |

### `examples/docs/fragment-include.md`
Dependencies: `2`
Type mix: `2 fragment`

| Type | Reference | Target block | Alias | Args |
| --- | --- | --- | --- | --- |
| `fragment` | `verification-fragment` | `examples/shared/verification-fragment.md#verification-fragment` | `kyc` | - |
| `fragment` | `../shared/verification-fragment.md#verification-fragment` | `examples/shared/verification-fragment.md#verification-fragment` | `explicit` | - |

### `examples/docs/markdown-include.md`
Dependencies: `2`
Type mix: `2 markdown`

| Type | Reference | Target block | Alias | Args |
| --- | --- | --- | --- | --- |
| `markdown` | `customer-verification.section` | `examples/shared/markdown-sections.md#customer-verification.section` | - | - |
| `markdown` | `../shared/markdown-sections.md#customer-verification.alias-section` | `examples/shared/markdown-sections.md#customer-verification.alias-section` | - | - |

### `examples/docs/template-diagram.md`
Dependencies: `3`
Type mix: `3 diagram`

| Type | Reference | Target block | Alias | Args |
| --- | --- | --- | --- | --- |
| `diagram` | `template.customer-overview` | `examples/shared/customer-templates.md#template.customer-overview` | - | `owner="Risk Ops", reviewer="Legal"` |
| `diagram` | `template.customer-overview` | `examples/shared/customer-templates.md#template.customer-overview` | - | `escalator="Head of Operations", owner="Sales Ops"` |
| `diagram` | `../shared/customer-templates.md#template.customer-overview` | `examples/shared/customer-templates.md#template.customer-overview` | - | `escalator="COO", owner="Customer Success", reviewer="Compliance"` |

### `examples/docs/template-fragment.md`
Dependencies: `2`
Type mix: `2 fragment`

| Type | Reference | Target block | Alias | Args |
| --- | --- | --- | --- | --- |
| `fragment` | `template-verification` | `examples/shared/customer-templates.md#template-verification` | `risk` | `owner="Risk Ops", reviewer="Legal"` |
| `fragment` | `../shared/customer-templates.md#template-verification` | `examples/shared/customer-templates.md#template-verification` | `ops` | `owner="Sales Ops", reviewer="Finance"` |

### `examples/docs/template-markdown.md`
Dependencies: `2`
Type mix: `2 markdown`

| Type | Reference | Target block | Alias | Args |
| --- | --- | --- | --- | --- |
| `markdown` | `template.markdown` | `examples/shared/customer-templates.md#template.markdown` | - | `name="Alice"` |
| `markdown` | `template.markdown` | `examples/shared/customer-templates.md#template.markdown` | - | `name="Bob"` |

### `examples/docs/template-nested.md`
Dependencies: `3`
Type mix: `3 diagram`

| Type | Reference | Target block | Alias | Args |
| --- | --- | --- | --- | --- |
| `diagram` | `template.wrapper` | `examples/shared/customer-templates.md#template.wrapper` | - | `fragmentRef="template-audit", reviewer="Legal"` |
| `diagram` | `template.wrapper` | `examples/shared/customer-templates.md#template.wrapper` | - | `fragmentRef="template-verification", reviewer="Legal"` |
| `diagram` | `template.wrapper` | `examples/shared/customer-templates.md#template.wrapper` | - | `fragmentRef="../shared/customer-templates.md#template-audit", owner="Risk Ops", reviewer="Legal"` |

## Notes

- This report shows direct dependencies only.
- Block identity is `type + target file + block id`.
- Unused shared blocks are not listed.
- Short references are resolved within their block type inside `sharedDir`.
