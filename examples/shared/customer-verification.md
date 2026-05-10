# Shared Diagram Library

<!-- mermaid:block customer-verification.overview -->
```mermaid
flowchart TD
A[Collect documents] --> B{Are the documents valid?}
B -- Yes --> C[Approve customer]
B -- No --> D[Request corrections]
```
<!-- /mermaid:block -->

<!-- mm:block customer-verification.short -->
```mermaid
flowchart LR
Start[Receive request] --> Review[Review documents]
Review --> Done[Record result]
```
<!-- /mm:block -->
