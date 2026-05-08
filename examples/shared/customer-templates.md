# Шаблонная библиотека Mermaid

<!-- mermaid:block template.customer-overview -->
```mermaid
flowchart TD
start([Старт]) --> owner["%owner%"]
owner --> review{"Проверка %reviewer|Finance%"}
review -->|OK| done([Готово])
review -->|Эскалация| escalator["%escalator|Head of Operations%"]
escalator --> done
```
<!-- /mermaid:block -->

<!-- mermaid:block template.verification-fragment type=fragment exports=entry,done -->
```mermaid
flowchart TD
entry["%owner|Sales Ops%"]
entry --> review{"Проверка %reviewer|Finance%"}
review --> done["Решение для %owner|Sales Ops%"]
```
<!-- /mermaid:block -->

<!-- mermaid:block template.audit-fragment type=fragment exports=entry,done -->
```mermaid
flowchart TD
entry["Аудит %owner|Sales Ops%: %reviewer|Finance%"]
entry --> done["Закрыть"]
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
