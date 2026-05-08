# Template Nested

Nested include с short `fragmentRef`:

```mermaid-include
template.wrapper fragmentRef=template.audit-fragment reviewer=Legal
```

Nested include с другим short `fragmentRef`:

```mermaid-include
template.wrapper fragmentRef=template.verification-fragment reviewer=Legal
```

Nested include с explicit path `fragmentRef`:

```mermaid-include
template.wrapper
fragmentRef = ./customer-templates.md#template.audit-fragment
reviewer = Legal
owner = Risk Ops
```
