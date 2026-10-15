# Review, prepare, authorize, reconcile
1. List pending bills and explain the selected bill's evidence and escalation reason.
   Give the recorded evidence age; it is not a fresh price quote. Missing comparisons
   do not prevent an informed owner from explicitly choosing to pay.
2. Connect the actual PolicyWallet owner execution account on the configured chain.
   Prepare only the selected obligation_id; recipient, amount and hash come from its log.
3. Present business, bill, recipient, exact six-decimal USDC amount, treasury, chain,
   decision hash, and remaining budget. Preparation is unsigned and does not pay.
4. Follow the stage_tx route byte-for-byte. Use its authoritative pending_tx_id to
   simulate_batch. If simulation fails, stop. Never invent transaction IDs.
5. Obtain explicit owner approval of these exact details, then use commit_txs for that
   single staged transaction. Wallet authorization is required for every payment. Do not
   use unattended or auto-sign execution; if the host cannot provide interactive owner
   authorization, stop. Changed payment details require a new review and simulation.
6. On broadcast, call acr_verify_payment with obligation_id and the callback transaction_hash.
   Only status=paid means verified and reconciled. pending/pending_finality mean wait and
   recheck the same hash. If broadcast outcome is unknown, inspect the wallet activity
   and recover its hash; never automatically submit a second transaction.
Cancellation before signing means no payment. Preparation reserves no money. Refresh
budget and simulate again when resuming. A failed ledger write after a confirmed transfer
means retry verification, never payment. A conflicting resolution needs manual review.
