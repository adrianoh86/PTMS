/*
  PTMS Migration 004: RFID gate photoelectric sensor configuration and events
  SQL Server 2025
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.RfidGateSensor', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RfidGateSensor
    (
        SensorId        int IDENTITY(1,1) NOT NULL CONSTRAINT PK_RfidGateSensor PRIMARY KEY,
        GateId          int NOT NULL,
        SensorCode      nvarchar(80) NOT NULL,
        SensorName      nvarchar(120) NOT NULL,
        SensorSide      char(1) NOT NULL,
        SensorType      varchar(30) NOT NULL CONSTRAINT DF_RfidGateSensor_SensorType DEFAULT ('PHOTOELECTRIC'),
        IsActive        bit NOT NULL CONSTRAINT DF_RfidGateSensor_IsActive DEFAULT (1),
        CreatedAt       datetime2(3) NOT NULL CONSTRAINT DF_RfidGateSensor_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt       datetime2(3) NOT NULL CONSTRAINT DF_RfidGateSensor_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_RfidGateSensor_RfidGate
            FOREIGN KEY (GateId) REFERENCES dbo.RfidGate(GateId),
        CONSTRAINT CK_RfidGateSensor_SensorSide CHECK (SensorSide IN ('A', 'B')),
        CONSTRAINT CK_RfidGateSensor_SensorType CHECK (SensorType = 'PHOTOELECTRIC'),
        CONSTRAINT UQ_RfidGateSensor_GateSide UNIQUE (GateId, SensorSide),
        CONSTRAINT UQ_RfidGateSensor_SensorCode UNIQUE (SensorCode)
    );
END;

IF OBJECT_ID(N'dbo.RfidGateSensorEvent', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RfidGateSensorEvent
    (
        SensorEventId       bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RfidGateSensorEvent PRIMARY KEY,
        SourceEventKey      nvarchar(120) NOT NULL,
        SensorId            int NOT NULL,
        SensorState         varchar(10) NOT NULL,
        ObservedAt          datetime2(3) NOT NULL,
        ReceivedAt          datetime2(3) NOT NULL CONSTRAINT DF_RfidGateSensorEvent_ReceivedAt DEFAULT (SYSUTCDATETIME()),
        RawPayload          nvarchar(max) NULL,
        ProcessingStatus    varchar(20) NOT NULL CONSTRAINT DF_RfidGateSensorEvent_ProcessingStatus DEFAULT ('NEW'),
        CONSTRAINT FK_RfidGateSensorEvent_RfidGateSensor
            FOREIGN KEY (SensorId) REFERENCES dbo.RfidGateSensor(SensorId),
        CONSTRAINT UQ_RfidGateSensorEvent_SourceEventKey UNIQUE (SourceEventKey),
        CONSTRAINT CK_RfidGateSensorEvent_SensorState CHECK (SensorState IN ('BLOCKED', 'CLEAR')),
        CONSTRAINT CK_RfidGateSensorEvent_ProcessingStatus
            CHECK (ProcessingStatus IN ('NEW', 'PROCESSED', 'IGNORED', 'EXCEPTION')),
        CONSTRAINT CK_RfidGateSensorEvent_RawPayloadJson
            CHECK (RawPayload IS NULL OR ISJSON(RawPayload) = 1)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.RfidGateSensorEvent') AND name = N'IX_RfidGateSensorEvent_Sensor_ObservedAt')
    CREATE INDEX IX_RfidGateSensorEvent_Sensor_ObservedAt
        ON dbo.RfidGateSensorEvent (SensorId, ObservedAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.RfidGateSensorEvent') AND name = N'IX_RfidGateSensorEvent_Status_ReceivedAt')
    CREATE INDEX IX_RfidGateSensorEvent_Status_ReceivedAt
        ON dbo.RfidGateSensorEvent (ProcessingStatus, ReceivedAt);

IF DATABASE_PRINCIPAL_ID(N'ptms_app') IS NOT NULL
BEGIN
    GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.RfidGateSensor TO ptms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.RfidGateSensorEvent TO ptms_app;
END;

COMMIT TRANSACTION;
