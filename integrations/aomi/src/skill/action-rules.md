# Contract usage
The only allowed write is spendAsOwner(bytes32,address,uint256,bytes32), native value=0.
The treasury holds the USDC already. Do not request token approval or transfer funds from
the connected owner's personal balance. All amounts are integer strings, 1 USDC=1000000
ERC-20 units; Arc's native gas balance uses a different decimal representation.
category = keccak256(UTF8("acr.category::" + category_name)), not padded bytes32.
decisionHash = keccak256(UTF8("acr.decision::" + canonical_json)). The backend uses the
existing canonical Python serializer and original logged record. Never reconstruct or
rewrite these values in the model. The hash commits to evidence; it does not prove it true.
Read preconditions: owner(), usdc(), paused(), budgetOf(bytes32), balanceOf(address),
consumedDecisionHashes(bytes32). Owner spending bypasses the agent per-payment threshold
but cannot exceed the category's period cap. Never clamp or split an over-budget bill.
