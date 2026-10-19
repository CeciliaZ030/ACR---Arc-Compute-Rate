# Cecilia's isolated staging demo

This fork branch is a recording environment, not ACR's production treasury.
The homepage's market data still comes from ACR; the treasury API holds synthetic
bills and the treasury token is a test-only MockUSDC deployment.

- Source: CeciliaZ030/ACR---Arc-Compute-Rate, branch codex/acr-staging-demo.
- Aomi staging Project 1669; private application 2937815.
- Application: acr-treasury-cecilia-demo.
- Namespace: evm-core, with the generated chain/PolicyWallet/spendAsOwner guard.
- Arc testnet: 5042002.
- Demo PolicyWallet: 0x03eD66010c1C7afF4A7d749Ba64b47d3EBee68F9.
- Mock USDC: 0x493d4061BfF3EeCc6df6513c6ca0409eF8487E2e.
- Development owner: 0x5D907BEa404e6F821d467314a9cA07663CF64c9B.
- Business: acr-video-demo; synthetic obligation demo-inference-001.
- Local frontend: http://127.0.0.1:3017.
- Local treasury API: http://127.0.0.1:8789, reached by staging through the
  temporary HTTPS tunnel in treasury-deployment.demo.json.

The API token and app key are local ignored files, never release source.
The frontend's ignored .env.local selects application 2937815 and its private
app key. The API process does not receive a signing key.

The temporary API/tunnel must remain running while recording. If the tunnel
origin changes, rebuild the app using the new trusted deployment origin.
Do not publish the local frontend, its environment file, or the local .demo folder.

Suggested sequence:
1. Show the testnet homepage with the isolated-demo banner.
2. Ask the agent to list pending bills and explain missing pricing evidence.
3. Read the demo PolicyWallet owner, pause state, token and inference budget.
4. Connect the actual owner on Arc testnet; prepare demo-inference-001.
5. Review 25.000001 mock USDC, stage and simulate the exact prepared payment.
6. Request explicit owner authorization; show a successful receipt only if
   signing, broadcast and acr_verify_payment really complete.

Do not describe setup transactions or a local integration test as an Aomi
wallet-authorized payment. Do not claim an ACR production payment occurred.

Verified on 2026-10-19:
- Hosted source commit 9e892c7348e93aec3bdbba7f22e04f2cbc7b1e56.
- Release apps-141779906-radc71cb03b-acr-treasury-cecilia-demo-9e892c7348e9.
- Release workflow: https://github.com/aomi-labs/community-apps/actions/runs/39212330833 (passed).
- Application 2937815 active, private, artifact-ready and loaded on staging.
- Required treasury credential is provisioned in the app scope.
- Completed HTTP chat identifies the demo correctly.
- Local Chrome chat successfully reads owner(), paused(), usdc(),
  remaining(bytes32), token balance, and acr_pending_payments.
- At block 67971431, inference remaining = 100.000000 mock USDC and
  treasury balance = 1,000.000000 mock USDC. These are observations, not
  permanently current balances.
- New demo contracts have no explorer ABI metadata; get_contract failed,
  then direct signature-based calls succeeded. Use known signatures for filming.
- Local tests: 32 app tests, 30 payment API tests, 428 frontend tests, plus
  the native plugin/API/local-contract payment round trip.
- No owner-wallet signing or live payment was performed through Aomi.
  Connect the actual demo owner before recording preparation/signing.
- The local frontend development server regenerates next-env.d.ts; this is
  local Next.js output, not a change to the published application artifact.
