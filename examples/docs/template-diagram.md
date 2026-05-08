# Template Diagram

Templated diagram include in compact one-line form:

```mermaid-include
template.customer-overview owner="Risk Ops" reviewer=Legal
```

Templated diagram include in multiline form:

```mermaid-include
template.customer-overview
owner = Sales Ops
escalator = Head of Operations
```

Templated diagram include via explicit path with arguments:

```mermaid-include
../shared/customer-templates.md#template.customer-overview owner="Customer Success" reviewer=Compliance escalator="COO"
```
