# Template Nested

Nested include with short `fragmentRef`:

```mermaid-include
template.wrapper fragmentRef=template-audit reviewer=Legal
```

Nested include with another short `fragmentRef`:

```mermaid-include
template.wrapper fragmentRef=template-verification reviewer=Legal
```

Nested include with explicit path `fragmentRef`:

```mermaid-include
template.wrapper
fragmentRef = ../shared/customer-templates.md#template-audit
reviewer = Legal
owner = Risk Ops
```
