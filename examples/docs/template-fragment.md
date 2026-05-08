# Template Fragment

Шаблонный fragment include в compact one-line форме:

```mermaid
flowchart LR
Start --> risk__entry
%% include: template.verification-fragment as risk owner="Risk Ops" reviewer=Legal
risk__done --> End
```

Шаблонный fragment include по explicit path и multiline args:

```mermaid
flowchart LR
Start --> ops__entry
%% include: ../shared/customer-templates.md#template.verification-fragment as ops
%% owner = Sales Ops
%% reviewer = Finance
ops__done --> End
```
