Overview
Relevant source files
Purpose and Scope
This document provides a high-level introduction to the Powerhouse monorepo, explaining its architecture as a document-centric application framework with support for multiple runtime environments (browser, server, local development) and dynamic extensibility through packages. This overview establishes the core concepts and system components that are detailed in subsequent wiki pages.

For repository structure details, see Repository Structure and Monorepo Architecture. For core terminology and architectural concepts, see Key Concepts and Terminology.

What is Powerhouse
Powerhouse is a monorepo-based application framework designed for building collaborative document management systems with offline-first capabilities and real-time synchronization. The system centers around the concept of Documents as first-class entities with versioned state, cryptographically signed operations, and multi-party collaboration support.

The framework consists of:

Frontend applications (apps/connect, apps/switchboard) for document management and system administration
Runtime engines (packages/reactor*) that execute document operations in different environments (browser, server, local)
Storage and sync layer (document-drive, document-model) for persistence and multi-device synchronization
Development tools (clis/ph-cli, packages/codegen) for code generation and project scaffolding
Package system (packages/registry) for runtime extensibility
Sources: 
package.json
1-90
 
tsconfig.json
1-107
 
apps/connect/package.json
1-108
 
apps/switchboard/package.json
1-73

Core Architectural Principles
Document-Centric Architecture
Every entity in Powerhouse is modeled as a Document with a well-defined structure:

Header containing metadata (documentType, revision, signers)
State representing current document data
Operations log capturing all state transitions
Scope-based organization (global, local, document, auth) for operation segregation
Documents are defined by Document Models in the document-model package, which specify schemas, operations, and reducers. The codegen package generates TypeScript implementations from these specifications.

Sources: 
packages/document-model/package.json
1-102
 
packages/codegen/package.json
1-91

Multi-Environment Reactor System
The core processing engine is the reactor, which exists in multiple variants for different deployment scenarios:














Multi-Environment Reactor Architecture

All variants share the same core logic (packages/reactor) but adapt to their environment's storage and API needs. This allows documents to be processed identically whether in a browser, on a server, or during local development.

Sources: 
packages/reactor/package.json
1-52
 
packages/reactor-browser/package.json
1-85
 
packages/reactor-api/package.json
1-110
 
packages/reactor-local/package.json
1-39
 
packages/reactor-mcp/tsconfig.json
1-30

Local-First with Synchronization
Powerhouse implements a local-first architecture where:

Browser clients (reactor-browser) store documents locally in PGLite
Operations are executed immediately for instant feedback
Synchronization happens bidirectionally with remote drives
Conflict resolution uses timestamp-based reshuffling for deterministic convergence
The document-drive package provides the abstraction layer for storage and sync:

Component	Purpose	Key Classes
Storage Interfaces	Abstract persistence	IDocumentStorage, IDriveOperationStorage
Storage Backends	Concrete implementations	PrismaStorage, MemoryStorage, BrowserStorage
Sync Manager	Coordination	ISynchronizationManager, SyncManager
Listeners/Transmitters	Push/Pull changes	IListenerManager, ITransmitter
Sources: 
packages/document-drive/package.json
1-102
 
packages/reactor-browser/package.json
1-85

Dynamic Extensibility via Packages
The system supports runtime extensibility through:

HTTP Registry (packages/registry) serving packages over HTTP
Package Manager dynamically loading document models and processors
Vetra Editor (packages/vetra) for authoring document model packages
GraphQL Federation where packages contribute subgraphs at runtime
When a new document type is installed, the system automatically:

Loads the document model definition
Generates GraphQL schema and resolvers
Registers reducers with the reactor
Enables UI components for editing
Sources: 
packages/registry/package.json
1-48
 
packages/vetra/tsconfig.json
1-61

System Components Overview
Applications Layer











Applications and Runtime Components

Connect (
apps/connect/package.json
1-108
): Primary user-facing application for managing drives and documents. Built with React, Vite, and uses reactor-browser for offline-capable document processing.

Switchboard (
apps/switchboard/package.json
1-73
): Backend orchestration service hosting reactor-api and managing system configuration. Runs on Express with support for PostgreSQL and Redis.

Switchboard GUI (
packages/switchboard-gui/tsconfig.json
1-45
): Administrative interface for inspecting sync status, remotes, channels, and debugging the system.

Sources: 
apps/connect/package.json
1-108
 
apps/switchboard/package.json
1-73
 
packages/design-system/package.json
1-161

Core Processing Layer
The reactor system processes all document operations:

Package	Environment	Storage	Protocol
@powerhousedao/reactor	Core library	Abstract	N/A
@powerhousedao/reactor-browser	Browser	PGLite	GraphQL client
@powerhousedao/reactor-api	Server	PostgreSQL	GraphQL server
@powerhousedao/reactor-local	Development	Filesystem	HTTP + Vite
@powerhousedao/reactor-mcp	AI agents	Delegated	MCP protocol
All variants implement the IReactor interface and share the job-based execution model, write cache, and read model coordination.

Sources: 
packages/reactor/package.json
1-52
 
packages/reactor-browser/package.json
1-85
 
packages/reactor-api/package.json
1-110
 
packages/reactor-local/package.json
1-39
 
packages/reactor-mcp/tsconfig.json
1-30

Data and Storage Layer















Data Layer Architecture with Storage Backends

document-model (
packages/document-model/package.json
1-102
): Core package defining document structure, operation types, and reducer functions. Uses Zod for schema validation.

document-drive (
packages/document-drive/package.json
1-102
): Provides storage abstraction (IDocumentStorage, IDriveOperationStorage) and implements concrete backends for different environments. Handles synchronization via ISynchronizationManager.

Sources: 
packages/document-model/package.json
1-102
 
packages/document-drive/package.json
1-102

Development Tools

















Development Tools and Code Generation

ph-cli (
clis/ph-cli/package.json
1-64
): Main command-line interface providing ph init, ph dev, ph codegen, ph migrate, and ph checkout commands.

codegen (
packages/codegen/package.json
1-91
): Generates TypeScript code from document model specifications using Hygen templates and ts-morph. Produces reducers, controllers, GraphQL schemas, and processor apps.

builder-tools (
packages/builder-tools/package.json
1-51
): Vite plugins and build utilities for hot module replacement of external packages during development.

Sources: 
clis/ph-cli/package.json
1-64
 
clis/ph-cmd/package.json
1-53
 
packages/codegen/package.json
1-91
 
packages/builder-tools/package.json
1-51

Package System
The dynamic package system enables runtime extensibility:

Component	Purpose	Package
HTTP Registry	Serves packages over HTTP	@powerhousedao/registry
Package Manager	Runtime loading (Vite/Import)	Part of reactor-api
Vetra Editor	Package authoring UI	@powerhousedao/vetra
Powerhouse Packages	Official package collection	@powerhousedao/powerhouse-vetra-packages
Packages follow the Vetra format, which bundles:

Document model definitions
Reducers and controllers
GraphQL subgraph definitions
Editor UI components
Processor apps for analytics
Sources: 
packages/registry/package.json
1-48
 
packages/vetra/tsconfig.json
1-61

Technology Stack
Core Technologies
Layer	Technologies
Languages	TypeScript (5.9.3), JavaScript (ESNext)
Runtime	Node.js ≥24, Bun (for builds)
Package Manager	pnpm with workspace protocol
Build System	NX (20.4.6), TypeScript project references
Bundlers	Vite (7.3.1), esbuild
Frontend Stack
Category	Technologies
Framework	React 19.2.4, Preact
Styling	Tailwind CSS 4.1.18
UI Components	Radix UI, custom design-system
State Management	Zustand (via reactor-browser), TanStack Query
Routing	React Router 6.x
Backend Stack
Category	Technologies
Server	Express 4.x
GraphQL	Apollo Server 5.x, Apollo Gateway 2.x
Database	PostgreSQL (via pg 8.18), PGLite 0.3.15
ORM/Query	Prisma 5.17, Kysely 0.28.11
Cache/Queue	Redis 4.7.x
Development Tools
Category	Technologies
Code Generation	Hygen 6.x, ts-morph 27.x
Testing	Vitest 3.2.4, Playwright 1.51.x, Cypress 14.x
Linting	ESLint 9.x, Prettier 3.8.1
Type Checking	TypeScript with strict mode
Sources: 
package.json
1-90
 
pnpm-lock.yaml
1-255

Repository Structure
The monorepo is organized into three main directories:

powerhouse/
├── apps/                    # User-facing applications
│   ├── connect/            # @powerhousedao/connect - Main UI
│   ├── switchboard/        # @powerhousedao/switchboard - Backend service
│   └── academy/            # Documentation site (Docusaurus)
├── packages/               # Shared libraries and tools
│   ├── reactor/            # Core reactor engine
│   ├── reactor-api/        # GraphQL server variant
│   ├── reactor-browser/    # Browser variant with PGLite
│   ├── reactor-local/      # Local dev server
│   ├── reactor-mcp/        # MCP protocol server
│   ├── document-drive/     # Storage & sync abstraction
│   ├── document-model/     # Schema definitions
│   ├── codegen/            # Code generator
│   ├── design-system/      # UI components
│   ├── builder-tools/      # Vite plugins
│   ├── registry/           # HTTP package registry
│   ├── vetra/              # Package editor
│   ├── analytics-engine/   # Analytics subsystem
│   └── ...                 # Additional utilities
└── clis/                   # Command-line tools
    ├── ph-cli/             # @powerhousedao/ph-cli - Main CLI
    └── ph-cmd/             # ph-cmd - Legacy CLI
Workspace Configuration
The repository uses pnpm workspaces with the workspace protocol for internal dependencies. The 
package.json
74-79
 defines overrides to ensure document-model and document-drive always use local versions during development.

TypeScript project references (
tsconfig.json
1-107
) establish build dependencies between packages, enabling incremental compilation and proper type checking across the monorepo.

Sources: 
package.json
1-90
 
tsconfig.json
1-107
 
pnpm-lock.yaml
1-255

Summary
Powerhouse is a document-centric application framework with the following key characteristics:

Multi-environment execution: The reactor core runs identically in browsers (PGLite), servers (PostgreSQL), and development environments (filesystem)

Local-first architecture: Browser clients operate offline with immediate feedback, synchronizing bidirectionally when connected

Dynamic extensibility: Packages can be loaded at runtime, adding new document types, GraphQL schemas, and UI components without redeployment

Cryptographic operations: All document changes are signed operations that form an immutable, verifiable audit log

Type-safe development: Code generation from schemas ensures type safety across reducers, controllers, GraphQL APIs, and UI components

The framework powers collaborative document management systems where multiple parties can work on shared documents with offline support, real-time sync, and deterministic conflict resolution.

Sources: 
package.json
1-90
 
apps/connect/package.json
1-108
 
apps/switchboard/package.json
1-73
 
packages/reactor/package.json
1-52
 
packages/document-drive/package.json
1-102