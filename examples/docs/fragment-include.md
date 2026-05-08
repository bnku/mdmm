# Fragment Include

Базовый фрагмент по short ref:

```mermaid
flowchart LR
Start[Получить заявку] --> kyc__entry
%% include: verification-fragment.fragment as kyc
kyc__success --> Offer[Продолжить оформление]
kyc__fail --> Rework[Вернуть на доработку]
```

Тот же базовый фрагмент по explicit path ref:

```mermaid
flowchart LR
Start[Получить заявку] --> explicit__entry
%% include: ../shared/verification-fragment.md#verification-fragment.fragment as explicit
explicit__success --> Offer[Продолжить оформление]
explicit__fail --> Rework[Вернуть на доработку]
```
