# ETHGlobal 2026 - Agent Build Notes (0G Track)

This repo captures sponsor research and product notes for building an autonomous agent project on 0G.

## 0G Features We Can Build On Top Of

### 1) 0G Storage SDK
- Store and retrieve large datasets using Go and TypeScript clients.
- Best suited for persistent agent memory, shared multi-agent state, and long-term logs/history.

### 2) 0G Inference / Compute
- Integrate AI inference into applications through SDKs.
- Useful for agent reasoning, reflection loops, and fact-check/verification passes.

### 3) Fine-tuning Tooling (CLI)
- Customize model behavior for specific use cases.
- Helpful for role-specific specialist agents (planner/researcher/critic/executor) and personalized digital twins.

### 4) Galileo Testnet
- Deploy and test on 0G testnet.
- Enables real end-to-end demos with autonomous loops, persistent memory, and onchain actions.

### 5) Node and Validator Path
- Documentation includes node operation and validator setup flows.
- Valuable for teams that want deeper infra integration and stronger network-native architecture.

### 6) Builder-Focused Docs Surface
- Developer Hub + Builder Hub give clear implementation paths.
- Supports fast hackathon iteration from prototype to demo-ready deployment.

## Why This Fits the Agent Track

The track is focused on building actual agents (single-agent, swarms, and creative open agent systems). A strong 0G-native architecture combines:

- Persistent memory on **0G Storage**
- Reasoning and verification on **0G Inference/Compute**
- Autonomous goal loops and onchain ownership/composability patterns (including iNFT-style ideas)

## Suggested MVP Direction

Start with one high-confidence execution path:

1. Build a goal-driven agent loop (observe -> reason -> act -> reflect).
2. Persist memory and trajectory in 0G Storage.
3. Use inference calls for planning and self-checking before actions.
4. Demonstrate continuity across sessions (agent remembers prior context).
5. Add collaborative role split (optional) for a swarm upgrade path.

## References

- [0G Documentation](https://docs.0g.ai/)

