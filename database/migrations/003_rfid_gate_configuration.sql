SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.RfidGate', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RfidGate (
    GateId bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RfidGate PRIMARY KEY,
    GateCode nvarchar(50) NOT NULL,
    GateName nvarchar(150) NOT NULL,
    ReaderId bigint NOT NULL,
    FromZoneId bigint NOT NULL,
    ToZoneId bigint NOT NULL,
    IsActive bit NOT NULL CONSTRAINT DF_RfidGate_IsActive DEFAULT(1),
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_RfidGate_CreatedAt DEFAULT(SYSUTCDATETIME()),
    UpdatedAt datetime2(3) NOT NULL CONSTRAINT DF_RfidGate_UpdatedAt DEFAULT(SYSUTCDATETIME()),
    CONSTRAINT UQ_RfidGate_GateCode UNIQUE(GateCode),
    CONSTRAINT FK_RfidGate_Reader FOREIGN KEY(ReaderId) REFERENCES dbo.RfidReader(ReaderId),
    CONSTRAINT FK_RfidGate_FromZone FOREIGN KEY(FromZoneId) REFERENCES dbo.Zone(ZoneId),
    CONSTRAINT FK_RfidGate_ToZone FOREIGN KEY(ToZoneId) REFERENCES dbo.Zone(ZoneId),
    CONSTRAINT CK_RfidGate_DifferentZones CHECK(FromZoneId <> ToZoneId)
  );
END;

IF OBJECT_ID('dbo.RfidGateAntenna', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RfidGateAntenna (
    GateAntennaId bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RfidGateAntenna PRIMARY KEY,
    GateId bigint NOT NULL,
    AntennaNo int NOT NULL,
    AntennaSide char(1) NOT NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_RfidGateAntenna_CreatedAt DEFAULT(SYSUTCDATETIME()),
    CONSTRAINT FK_RfidGateAntenna_Gate FOREIGN KEY(GateId) REFERENCES dbo.RfidGate(GateId),
    CONSTRAINT UQ_RfidGateAntenna_Gate_Antenna UNIQUE(GateId, AntennaNo),
    CONSTRAINT CK_RfidGateAntenna_Number CHECK(AntennaNo BETWEEN 1 AND 256),
    CONSTRAINT CK_RfidGateAntenna_Side CHECK(AntennaSide IN('A','B'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_RfidGate_ActiveReader' AND object_id=OBJECT_ID('dbo.RfidGate'))
  CREATE UNIQUE INDEX UX_RfidGate_ActiveReader ON dbo.RfidGate(ReaderId) WHERE IsActive=1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RfidGate_ZonePair_Active' AND object_id=OBJECT_ID('dbo.RfidGate'))
  CREATE INDEX IX_RfidGate_ZonePair_Active ON dbo.RfidGate(FromZoneId, ToZoneId, IsActive);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RfidGateAntenna_Gate_Side' AND object_id=OBJECT_ID('dbo.RfidGateAntenna'))
  CREATE INDEX IX_RfidGateAntenna_Gate_Side ON dbo.RfidGateAntenna(GateId, AntennaSide);

COMMIT TRANSACTION;
