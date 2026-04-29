# KeeperHub Features

Based on the official KeeperHub docs: [https://docs.keeperhub.com/](https://docs.keeperhub.com/)

## Core Platform

- Visual onchain workflow builder (trigger -> actions -> conditions)
- Managed execution and reliability layer for blockchain automations
- Works across Ethereum, Base, Arbitrum, Polygon, Sepolia, and other EVM-compatible chains

## Trigger Types

- Manual trigger
- Schedule trigger (recurring intervals)
- Webhook trigger (HTTP request driven)
- Blockchain event trigger
- Block interval trigger

## Actions and Workflow Nodes

- Web3 actions:
  - Check balances
  - Read smart contracts
  - Write smart contracts
  - Transfer native tokens and ERC-20 tokens
  - Query event logs
  - Decode calldata
- Notification actions:
  - Discord
  - Telegram
  - SendGrid email
  - Webhook notifications/integrations
- System/logic actions:
  - HTTP requests
  - Conditional branching
  - Loops (`For Each`)
  - Aggregation (`Collect`)
  - Template rendering
- Math actions:
  - Sum
  - Count
  - Average
  - Median
  - Min
  - Max
  - Product

## Reliability and Operations

- Automatic gas estimation
- Transaction ordering and nonce management
- Configurable retries on failure
- Run logs and execution status tracking
- Performance monitoring and troubleshooting support

## Security and Wallets

- Turnkey-backed wallets
- Hardware-backed key storage / secure enclave model
- Read-only actions without wallet signing; writes execute through managed wallet

## AI and Agent Features

- AI-assisted workflow generation from natural language prompts
- MCP server support for AI agents to create, run, and monitor workflows
- Positioned as an execution layer for autonomous onchain AI agents

## Developer Tooling

- REST API for programmatic workflow and execution management
- CLI (`kh`) with commands for auth, workflows, runs, execute, wallets, projects, tags, templates, and diagnostics

## Collaboration and Admin

- User and organization management
- Team collaboration support
- Access control
- API key management
- Projects and tags

## Plugin Ecosystem (examples listed in docs)

- DeFi/Web3 plugins (examples): Aave V3, Compound V3, Curve, Lido, Morpho, Pendle, Rocket Pool, Spark, Uniswap, Yearn V3, and more
- Communication/integration plugins: Discord, Telegram, SendGrid, Webhook

