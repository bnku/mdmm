# Template Fragment

Templated fragment include in compact one-line form:

```mermaid
flowchart LR
Start --> risk__entry
risk__entry["Risk Ops"]
risk__entry --> risk__review{"Review by Legal"}
risk__review --> risk__done["Decision for Risk Ops"]
risk__done --> End
```

Templated fragment include via explicit path with multiline args:

```mermaid
flowchart LR
Start --> ops__entry
ops__entry["Sales Ops"]
ops__entry --> ops__review{"Review by Finance"}
ops__review --> ops__done["Decision for Sales Ops"]
ops__done --> End
```
