# Mermaid Template Library

<!-- mermaid:block template.customer-overview -->
```mermaid
flowchart TD
start([Start]) --> owner["%owner%"]
owner --> review{"Review by %reviewer|Finance%"}
review -->|OK| done([Done])
review -->|Escalate| escalator["%escalator|Head of Operations%"]
escalator --> done
```
<!-- /mermaid:block -->

<!-- mermaid:block template.verification-fragment type=fragment exports=entry,done -->
```mermaid
flowchart TD
entry["%owner|Sales Ops%"]
entry --> review{"Review by %reviewer|Finance%"}
review --> done["Decision for %owner|Sales Ops%"]
```
<!-- /mermaid:block -->

<!-- mermaid:block template.audit-fragment type=fragment exports=entry,done -->
```mermaid
flowchart TD
entry["Audit %owner|Sales Ops%: %reviewer|Finance%"]
entry --> done["Close"]
```
<!-- /mermaid:block -->

<!-- mermaid:block template.wrapper -->
```mermaid
flowchart LR
Start --> lane__entry
%% include: %fragmentRef|template.verification-fragment% as lane
%% reviewer = %reviewer|Finance%
%% owner = %owner|Sales Ops%
lane__done --> End
```
<!-- /mermaid:block -->
