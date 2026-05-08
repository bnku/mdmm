# Пользовательский путь

Ниже большая диаграмма собирается из общего Mermaid-фрагмента.

```mermaid
flowchart LR
Start[Получить заявку] --> kyc__entry
kyc__entry[Начать верификацию]
kyc__entry --> kyc__check{Документы валидны?}
kyc__check -- Да --> kyc__success[Верификация пройдена]
kyc__check -- Нет --> kyc__fail[Нужны корректировки]
kyc__success --> Offer[Продолжить оформление]
kyc__fail --> Rework[Вернуть на доработку]
```
