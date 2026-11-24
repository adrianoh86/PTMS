# PTMS — Pallet Tracking Management System

Initial development foundation for the RFID-enabled, multi-site pallet tracking system.

## Technology
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: Microsoft SQL Server using the mssql driver

## Run in GitHub Codespaces
1. Confirm the Codespace is on branch dev.
2. Run npm install from the repository root.
3. Copy .env.example to backend/.env and update the SQL Server connection settings.
4. Run npm run dev.
5. Open forwarded port 5173 for the frontend. The backend listens on port 4000.

## Database setup
1. Create a dedicated database named PTMS.
2. Review database/migrations/001_initial_schema.sql with the DBA.
3. Execute the migration against the PTMS database.
4. Create a least-privilege application login for the backend.

A Codespace cannot connect to SQL Server running on your laptop using localhost. Use an approved private network/VPN or a reachable development SQL Server. Do not expose SQL Server directly to the public internet. SQL Server Developer edition is for development and testing, not production.

## Implemented in this foundation
- API health endpoint and SQL Server connectivity check
- Site master read endpoint and starter dashboard
- SQL Server tables for sites, zones, pallets, EPC assignments, pallet contents, RFID readers, raw RFID events, confirmed movements, RFID exceptions and integration outbox

## RFID design rules
Raw RFID reads are stored separately from confirmed pallet movements. A raw EPC read must never directly update a pallet's confirmed zone. Gate middleware must correlate antenna sequence, presence/direction sensors, timing and zone-transition rules before creating a confirmed movement. Ambiguous reads, unknown EPCs and reader failures must enter an exception workflow. Fixed gates provide zone-level visibility, not continuous positioning.

## Not implemented yet
Authentication/authorization, RFID middleware ingestion and gate correlation, confirmed movement transaction workflow, OLMS adapter, transfer workflow, audit controls, operational dashboards, automated tests and deployment hardening.
