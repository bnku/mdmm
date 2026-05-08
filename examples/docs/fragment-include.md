# Fragment Include

Base fragment via short ref:

```mermaid
flowchart LR
Start[Receive request] --> kyc__entry
%% include: verification-fragment as kyc
kyc__success --> Offer[Continue processing]
kyc__fail --> Rework[Return for rework]
```

The same base fragment via explicit path ref:

```mermaid
flowchart LR
Start[Receive request] --> explicit__entry
%% include: ../shared/verification-fragment.md#verification-fragment as explicit
explicit__success --> Offer[Continue processing]
explicit__fail --> Rework[Return for rework]
```
