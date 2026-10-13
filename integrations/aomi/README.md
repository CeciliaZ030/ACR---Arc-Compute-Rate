# ACR on Aomi

**ACR (Arc Compute Rate) as an Aomi App.** It gives any Aomi agent the ability to
tell its user whether a bill for AI inference, GPU time or data is fair, and
whether a wallet is overpaying its compute vendors. Every verdict is checked
against cited public prices, never asserted.

Aomi turns intent into on-chain transactions. Before an agent pays for compute,
something has to say whether the price is right. That is what ACR does: it
publishes an on-chain reference index for machine compute from an oracle on Arc,
and it benchmarks real bills against real published prices. This App puts both
answers inside Aomi's agent as five read-only tools. It asks for no wallet powers
(`namespaces = []`), so nothing here signs or spends.

## What an Aomi agent gets

| tool | the user asks | it answers with |
|---|---|---|
| `acr_check_bill` | "I was billed 0.47 USDC for 23k tokens. Should I pay?" | pay / reroute / hold / escalate / refuse, the rule, bp over or under the going rate, the cheapest cited seller, the avoidable USDC |
| `acr_wallet_cost` | "Is this agent overpaying?" | purchases, spend, slippage vs the benchmark, overpaid USDC, the cheaper seller it should use |
| `acr_seller_rating` | "Can I trust this compute seller?" | a grade with how much of it is actually measured, or "Unrated" and why |
| `acr_rate` | "Where is the ACR index, and is it fresh?" | the on-chain print, its confidence interval, the USDC it costs to move it 1 bp, its age |
| `acr_receipts` | "Did my payment to ACR land?" | recent USDC settlements with their references |

## Live, through Aomi's own plugin loader

Captured 2026-10-13. The App was loaded with `aomi_sdk::DynFnHandle`, the host-side
loader Aomi's backend uses, and each tool was called across the FFI boundary
against the live ACR press:

```
you  › "My agent was billed 0.47 USDC for 23,000 tokens of inference. Should it pay?"
tool › acr_check_bill {"billed_usdc":0.47,"quantity":23,"unit":"$/1k tokens"}
acr  › verdict over_par · +500,870 bp · the spend agent would ESCALATE
       you paid 0.0204 per 1k tokens; the going rate is 0.0004 across 5 published prices
       cheapest: GPT-4o mini at 0.0002625 per 1k (openrouter.ai, data[id=openai/gpt-4o-mini].pricing)
       0.464 USDC of this bill was avoidable

you  › "Has wallet 0xc2903b52… been overpaying its compute vendors?"
tool › acr_wallet_cost {"wallet":"0xc2903b52a3ad365fd237b78389a2fde99e886999"}
acr  › seen · 3 purchases · 0.00461 USDC · slippage -1139.8 bp (paid less than the benchmark) · overpaid 0

you  › "Rate seller 0xefe0E462…."
tool › acr_seller_rating {"seller":"0xefe0E4625AFf072c3FCff230b47f8150A17aDF19"}
acr  › Unrated: thin tape (n=1 < 20) · 40% of the grade measured. It refuses to invent a score.

you  › "Where is the ACR inference index?"
tool › acr_rate {"index":"ACR-INF"}
acr  › 0.49773 (CI 0.49449–0.49780) · costs 0.0156 USDC to move by 1 bp · posted 58 min ago, current
       scale: ACR's own nominal index level, not a market price
```

## Honesty is built into the tools, not left to the prompt

- **An index level is never a price.** ACR-INF sits about 1,250× above public
  inference prices (`anchors/GAP.md`), so `acr_rate` says so on every answer. Questions
  about what compute costs go to `acr_check_bill`, which compares against cited quotes.
- **Every rate states its age.** Past the 2-hour settle window it reads `current: false`,
  meaning "the last known value".
- **Every bill states its basis.** A bill from a seller ACR operates is judged only
  against ACR's own fleet prices. The tool says so and gives the call that prices the
  same bill against the market instead.
- **"Not seen" is never "zero".** A wallet ACR has no record of is reported as unseen,
  not as spending nothing.
- **An empty receipt list says why.** Receipts live in the memory of the press that
  sold them, so the tool says that rather than "nobody paid".

## Verified

- **SDK pin = what Aomi's backend requires today.** `aomi-build sdk check` (the 5.1.1 CLI)
  asks `api.aomi.dev` and passes: required 5.1.1, `Cargo.toml` exact 5.1.1, `Cargo.lock`
  5.1.1. The backend's own answer, `GET /api/platforms/server-tags`, is
  `{"server_tags":["prod"],"sdk_version":"5.1.1"}`.
- **It loads the way the backend loads it.** Through `DynFnHandle`, and read back by
  `aomi-build manifest`: `acr-compute-rate 0.1.0 · sdk 5.1.1 · namespaces []`, five tools,
  one optional secret slot (`ACR_API`).
- **It builds the way Aomi's builder builds it.** The builder stages this folder on its
  own, so it was copied out of the repo by itself and passed `cargo test --locked` and
  `cargo build --release --locked` there.
- **Every tool answers from a plain thread AND from inside a Tokio runtime.** HTTP uses
  `reqwest`'s blocking client, as Aomi's template prescribes, because a tool runs inside a
  synchronous FFI boundary.
- **Tests.** `cargo test`: 22 deterministic tests. 21 run the tools on recorded live
  responses, each watched failing on a deliberately broken tool. The 22nd fails if the
  SDK pin Aomi's deploy gate reads (the repo-root `Cargo.toml`) and the pin this App
  builds with ever differ. `cargo test -- --ignored` runs all five tools against the real
  press. ACR's CI runs the suite on every push.

## Deploy it from the dashboard

The App lives in this subdirectory of the ACR repo. Aomi finds it through the root
`.aomi/config.json`, the layout Aomi's own `docs/community-deployment.md` documents for
an App in a subdirectory.

1. Sign in at **[build.aomi.dev](https://build.aomi.dev)** with **Continue with GitHub**.
2. **Import from GitHub**, install the Aomi Build GitHub App on the ACR repository, and
   select it. The wizard builds the release from the pushed commit and activates it.
3. The App then appears under Projects, Deployments and Observability, and **Chat**
   opens chat.aomi.dev with it selected.

`aomi.toml` declares `server_tags = ["prod"]`, because `api.aomi.dev` advertises only
`prod`, and an App left on the default `["staging"]` would never load there.

The repo root also holds a small `Cargo.toml` that builds nothing. Aomi's deploy gate reads
the SDK pin only from the root of a repository, and stops with "no Cargo.toml found"
without one. So that file declares the pin and excludes this folder, which Aomi's builder
compiles on its own.

**From a terminal instead.** A human deploy signs in with GitHub, so no activation token
is needed. The Aomi Build GitHub App must be installed on the repo (step 2 above), and
the commit being shipped must be pushed.

```bash
cargo install aomi-sdk --version 5.1.1 --locked --features cli   # installs aomi-build
export AOMI_BACKEND_URL=https://api.aomi.dev
aomi-build sdk check --path .                                     # from the repo root
aomi-build login --build-url https://build.aomi.dev               # opens GitHub in a browser
aomi-build deploy --repo kaustubh76/ACR---Arc-Compute-Rate        # preflight, PR, build, activate
```

**Optional setting:** `ACR_API`, set in the App's Environment tab, points the tools at
another ACR press, for example `https://acr-api-1fto.onrender.com` for Arc testnet. Left
unset, the App reads the default Arc mainnet press.

## Develop

```bash
cargo test                       # 22 deterministic tests
cargo test -- --ignored          # every tool against the live ACR press
cargo build --release            # target/release/libacr_compute_rate.{dylib,so}
```

The layout follows Aomi's guidance. `src/lib.rs` holds registration and the preamble,
`src/client.rs` is the one HTTP client, and `src/tool.rs` holds the tools.
`fixtures/` holds the recorded responses the tests run on.
