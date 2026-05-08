# Template Nested

Nested include with short `fragmentRef`:

```mermaid-include
template.wrapper fragmentRef=template.audit-fragment reviewer=Legal
```

Nested include with another short `fragmentRef`:

```mermaid-include
template.wrapper fragmentRef=template.verification-fragment reviewer=Legal
```

Nested include with explicit path `fragmentRef`:

```mermaid-include
template.wrapper
fragmentRef = ../shared/customer-templates.md#template.audit-fragment
reviewer = Legal
owner = Risk Ops
```
