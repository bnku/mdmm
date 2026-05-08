# Template Whole

Шаблонный whole include в compact one-line форме:

```mermaid-include
template.customer-overview owner="Risk Ops" reviewer=Legal
```

Шаблонный whole include в multiline форме:

```mermaid-include
template.customer-overview
owner = Sales Ops
escalator = Head of Operations
```

Шаблонный whole include по explicit path с аргументами:

```mermaid-include
../shared/customer-templates.md#template.customer-overview owner="Customer Success" reviewer=Compliance escalator="COO"
```
