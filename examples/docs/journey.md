# Пользовательский путь

Ниже большая диаграмма собирается из общего Mermaid-фрагмента.

```mermaid
flowchart LR
Start[Получить заявку] --> kyc__entry
%% include: verification-fragment.fragment as kyc
kyc__success --> Offer[Продолжить оформление]
kyc__fail --> Rework[Вернуть на доработку]
```
