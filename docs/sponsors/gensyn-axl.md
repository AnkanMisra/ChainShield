# Gensyn AXL Features for Hackers

Based on the official docs: <https://docs.gensyn.ai/tech/agent-exchange-layer>

## Overview

Agent eXchange Layer (AXL) is a decentralized peer-to-peer communication layer for building AI-agent and distributed applications without relying on centralized servers.

It provides a local node that handles encrypted transport, routing, and peer communication, while your app talks to it over a simple HTTP interface.

## Core Features

- **Decentralized P2P networking**
  - Direct machine-to-machine communication over a mesh network
  - No central relay required for standard operation

- **Simple local developer interface**
  - Local HTTP bridge exposed at `localhost:9002`
  - Language-agnostic integration (any stack that can make HTTP requests)

- **No root/TUN dependency**
  - Runs fully in userspace
  - No root privileges or system-level tunnel setup required

- **NAT and firewall friendliness**
  - Designed to work behind NAT/firewalls without manual port forwarding in typical setups
  - For new network bootstrapping, at least one publicly reachable node is needed

- **End-to-end encryption**
  - TLS for direct peering links
  - Yggdrasil path-level encryption for end-to-end privacy across hops

- **App-agnostic data transport**
  - Supports arbitrary payloads: JSON, protobuf, raw bytes, tensors, etc.
  - Node focuses on transport; application logic stays in your app

## Protocol and Agent Support

- Built-in support for **MCP** (Model Context Protocol)
- Built-in support for **A2A** (Agent-to-Agent)
- Suitable for structured request/response between AI agents and multi-agent systems

## Builder Benefits

- No cloud account or DNS requirement for basic peer communication
- Permissionless participation (anyone can run a node)
- Private network creation is supported
- Multiple applications can share one running node

## What Hackers Can Build

- **AI agent collaboration**
  - Cross-machine agents sharing tasks and signals over MCP

- **Distributed ML inference**
  - Tensor/message exchange across peers

- **Pub/Sub systems**
  - Gossip-style message propagation across the mesh

- **Aggregation pipelines**
  - Convergecast/tree-based multi-node data collection

- **Custom decentralized backends**
  - Any app needing encrypted, serverless, peer-to-peer transport

## Practical Setup Model (At a Glance)

1. Run an AXL node locally.
2. Node joins the mesh and generates a public-key identity.
3. Exchange public keys with peers.
4. Communicate app-to-app through local nodes over HTTP.

## Notes for Hackathon Teams

- Keep app logic separate from transport logic: use AXL as the networking substrate.
- Start with a 2-node proof of communication, then add protocol-level semantics (MCP/A2A).
- If creating a brand-new isolated mesh, plan one public bootstrap node early.

