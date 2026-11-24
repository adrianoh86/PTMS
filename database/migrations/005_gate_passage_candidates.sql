/*
  PTMS Migration 005: Gate passage correlation configuration and candidates
  Initial passage window: 5000 ms (5 seconds)
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.RfidGate', N'PassageWindowMs') IS NULL
BEGIN
    ALTER TABLE dbo.RfidGate
      ADD PassageWindowMs int NOT NULL
          CONSTRAINT DF_RfidGate_PassageWindowMs DEFAULT (5000);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.RfidGate')
      AND name = N'CK_RfidGate_PassageWindowMs'
)
BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.RfidGate
        ADD CONSTRAINT CK_RfidGate_PassageWindowMs
        CHECK (PassageWindowMs BETWEEN 500 AND 30000);';
END;

IF OBJECT_ID(N'dbo.RfidGatePassageCandidate', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RfidGatePassageCandidate
    (
        CandidateId         bigint IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_RfidGatePassageCandidate PRIMARY KEY,
        CandidateKey        nvarchar(160) NOT NULL,
        GateId              bigint NOT NULL,
        Epc                 nvarchar(128) NULL,
        PalletId            bigint NULL,
        Direction           varchar(10) NOT NULL,
        FromZoneId          bigint NOT NULL,
        ToZoneId            bigint NOT NULL,
        SensorStartAt       datetime2(3) NOT NULL,
        SensorEndAt         datetime2(3) NOT NULL,
        RfidFirstSeenAt     datetime2(3) NULL,
        RfidLastSeenAt      datetime2(3) NULL,
        RfidReadCount       int NOT NULL CONSTRAINT DF_RfidGatePassageCandidate_RfidReadCount DEFAULT (0),
        ConfidenceScore     decimal(5,2) NULL,
        CandidateStatus     varchar(20) NOT NULL
            CONSTRAINT DF_RfidGatePassageCandidate_Status DEFAULT ('PENDING'),
        ExceptionReason     varchar(40) NULL,
        ReviewNote          nvarchar(1000) NULL,
        CreatedAt           datetime2(3) NOT NULL
            CONSTRAINT DF_RfidGatePassageCandidate_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt           datetime2(3) NOT NULL
            CONSTRAINT DF_RfidGatePassageCandidate_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_RfidGatePassageCandidate_CandidateKey UNIQUE (CandidateKey),
        CONSTRAINT FK_RfidGatePassageCandidate_Gate
            FOREIGN KEY (GateId) REFERENCES dbo.RfidGate(GateId),
        CONSTRAINT FK_RfidGatePassageCandidate_Pallet
            FOREIGN KEY (PalletId) REFERENCES dbo.Pallet(PalletId),
        CONSTRAINT FK_RfidGatePassageCandidate_FromZone
            FOREIGN KEY (FromZoneId) REFERENCES dbo.Zone(ZoneId),
        CONSTRAINT FK_RfidGatePassageCandidate_ToZone
            FOREIGN KEY (ToZoneId) REFERENCES dbo.Zone(ZoneId),
        CONSTRAINT CK_RfidGatePassageCandidate_Direction
            CHECK (Direction IN ('A_TO_B', 'B_TO_A')),
        CONSTRAINT CK_RfidGatePassageCandidate_Status
            CHECK (CandidateStatus IN ('PENDING', 'CONFIRMED', 'REJECTED', 'EXCEPTION')),
        CONSTRAINT CK_RfidGatePassageCandidate_ReadCount
            CHECK (RfidReadCount >= 0),
        CONSTRAINT CK_RfidGatePassageCandidate_Confidence
            CHECK (ConfidenceScore IS NULL OR ConfidenceScore BETWEEN 0 AND 100),
        CONSTRAINT CK_RfidGatePassageCandidate_TimeOrder
            CHECK (SensorEndAt >= SensorStartAt)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.RfidGatePassageCandidate')
      AND name = N'IX_RfidGatePassageCandidate_Status_CreatedAt'
)
    CREATE INDEX IX_RfidGatePassageCandidate_Status_CreatedAt
      ON dbo.RfidGatePassageCandidate (CandidateStatus, CreatedAt DESC);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.RfidGatePassageCandidate')
      AND name = N'IX_RfidGatePassageCandidate_Gate_SensorStart'
)
    CREATE INDEX IX_RfidGatePassageCandidate_Gate_SensorStart
      ON dbo.RfidGatePassageCandidate (GateId, SensorStartAt DESC);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.RfidGatePassageCandidate')
      AND name = N'IX_RfidGatePassageCandidate_Epc_CreatedAt'
)
    CREATE INDEX IX_RfidGatePassageCandidate_Epc_CreatedAt
      ON dbo.RfidGatePassageCandidate (Epc, CreatedAt DESC)
      WHERE Epc IS NOT NULL;

IF DATABASE_PRINCIPAL_ID(N'ptms_app') IS NOT NULL
BEGIN
    GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.RfidGatePassageCandidate TO ptms_app;
END;

COMMIT TRANSACTION;
