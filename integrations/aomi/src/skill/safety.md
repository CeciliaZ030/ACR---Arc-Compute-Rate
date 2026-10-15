# Enforcement boundaries
The app guard restricts chain, target PolicyWallet and spendAsOwner selector. It does not
validate every argument, impose an independent USD cap or prove invoice legitimacy.
The contract enforces owner identity, pause, budget, and one spend per decision hash.
The app derives arguments from recorded obligations; the owner reviews the exact payment.
Do not claim prompts or guard confirmation hints are enforced authorization.
No futures, arbitrary transfers, withdrawals, budget changes, agent permissions, approvals,
or server-held signing keys. No automatic retry after uncertain submission. ReceiptMirror
or acr_receipts results are not proof that a treasury obligation was paid. Use the verifier,
which checks finality, the exact Spent event and its emitting contract before ledger updates.
