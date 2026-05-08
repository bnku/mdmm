# Whole Include

Каноническая диаграмма по short ref:

```mermaid
flowchart TD
A[Собрать документы] --> B{Документы валидны?}
B -- Да --> C[Одобрить клиента]
B -- Нет --> D[Запросить корректировки]
```

Короткий подпроцесс по explicit path ref:

```mermaid
flowchart LR
Start[Получить заявку] --> Review[Проверить документы]
Review --> Done[Зафиксировать результат]
```
