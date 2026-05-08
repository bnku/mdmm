# Фрагмент верификации
<!-- mermaid:block verification-fragment.fragment type=fragment exports=entry,success,fail -->
```mermaid-fragment
entry[Начать верификацию]
entry --> check{Документы валидны?}
check -- Да --> success[Верификация пройдена]
check -- Нет --> fail[Нужны корректировки]
```
<!-- /mermaid:block -->
