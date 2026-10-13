//! ACR — Arc Compute Rate — as an Aomi App.
//!
//! ACR publishes an on-chain reference rate for machine compute (AI inference,
//! GPU time, data) and benchmarks what agents actually pay against it. This App
//! hands those answers to Aomi's agent as five read-only tools. It asks for no
//! wallet powers (`namespaces = []`): nothing here signs or spends.
//!
//! Layout follows Aomi's own guidance: this file is the public inventory
//! (registration and the preamble), `client.rs` is the one HTTP door to ACR's
//! press, and `tool.rs` holds the tools.

mod client;
mod tool;

use aomi_sdk::{Secret, dyn_aomi_app};

/// The App value the runtime builds once per chat session. Stateless: the HTTP
/// client is a process-wide static in `client.rs`, so a session costs nothing.
#[derive(Clone, Default)]
pub struct AcrApp;

const PREAMBLE: &str = "You can read ACR (Arc Compute Rate). ACR publishes an on-chain reference index for machine \
compute (AI inference, GPU time, data delivery) from an oracle on Arc, and it checks what agents and wallets actually pay \
against real, cited public market prices.

Which tool:
- What is ACR's index print, how fresh is it, how costly is it to manipulate? -> acr_rate (ACR-INF per 1k tokens, \
ACR-GPU per GPU-second, ACR-DATA per MB). These are index levels on ACR's own nominal scale, NOT market prices.
- Is this bill, invoice or price fair, and should it be paid? -> acr_check_bill. Pass the TOTAL billed and the \
quantity in the unit (23 for 23,000 tokens at \"$/1k tokens\"). Leave vendor out for any third-party provider.
- Is this wallet or agent overpaying, and where should it buy instead? -> acr_wallet_cost.
- Is this seller trustworthy or fairly priced? -> acr_seller_rating.
- Did a payment to ACR land? -> acr_receipts.

Rules you must keep:
- Never quote an acr_rate value as what compute costs. For what the market actually charges, use acr_check_bill, which \
compares against cited public prices.
- Always say how old a rate is. If acr_rate returns current: false, call it the last known value, never today's price.
- Always say what a bill was compared against. If priced_against is \"fleet\" or priced is false, do NOT present it as \
a market verdict: relay the hint and, if it says so, call acr_check_bill again without vendor.
- A wallet with seen: false has no purchases on ACR's tape. Never report that as zero spend.
- Verdicts are suggestions, not promises, and compare against published list prices, not the user's contract.
- Quote the cheapest seller by its label and cite its source when you recommend switching.
- None of these tools pays, signs or moves funds.";

dyn_aomi_app!(
    app = AcrApp,
    name = "acr-compute-rate",
    version = "0.1.0",
    preamble = PREAMBLE,
    tools = [
        tool::RateTool,
        tool::CheckBillTool,
        tool::WalletCostTool,
        tool::SellerRatingTool,
        tool::ReceiptsTool
    ],
    secrets = [Secret::new(
        "ACR_API",
        "Optional. The ACR press to read, e.g. https://acr-api-1fto.onrender.com for Arc testnet. \
         Leave unset for the default Arc mainnet press.",
        false
    )],
    namespaces = []
);
