SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH('dbo.RfidReader', 'ReaderModel') IS NULL
  ALTER TABLE dbo.RfidReader ADD ReaderModel nvarchar(100) NULL;
IF COL_LENGTH('dbo.RfidReader', 'IntegrationMode') IS NULL
  ALTER TABLE dbo.RfidReader ADD IntegrationMode varchar(20) NOT NULL CONSTRAINT DF_RfidReader_IntegrationMode DEFAULT('HTTP');
IF COL_LENGTH('dbo.RfidReader', 'ConnectionEndpoint') IS NULL
  ALTER TABLE dbo.RfidReader ADD ConnectionEndpoint nvarchar(500) NULL;
IF COL_LENGTH('dbo.RfidReader', 'SerialNumber') IS NULL
  ALTER TABLE dbo.RfidReader ADD SerialNumber nvarchar(100) NULL;
IF COL_LENGTH('dbo.RfidReader', 'LastError') IS NULL
  ALTER TABLE dbo.RfidReader ADD LastError nvarchar(1000) NULL;
IF COL_LENGTH('dbo.RfidReader', 'CreatedAt') IS NULL
  ALTER TABLE dbo.RfidReader ADD CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_RfidReader_CreatedAt DEFAULT(SYSUTCDATETIME());
IF COL_LENGTH('dbo.RfidReader', 'UpdatedAt') IS NULL
  ALTER TABLE dbo.RfidReader ADD UpdatedAt datetime2(3) NOT NULL CONSTRAINT DF_RfidReader_UpdatedAt DEFAULT(SYSUTCDATETIME());

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_RfidReader_IntegrationMode')
  EXEC(N'ALTER TABLE dbo.RfidReader ADD CONSTRAINT CK_RfidReader_IntegrationMode CHECK(IntegrationMode IN(''VENDOR_SDK'',''LLRP'',''MQTT'',''HTTP''))');
IF COL_LENGTH('dbo.RfidRawEvent', 'RawPayload') IS NULL
  ALTER TABLE dbo.RfidRawEvent ADD RawPayload nvarchar(max) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_RfidRawEvent_RawPayload_Json')
  EXEC(N'ALTER TABLE dbo.RfidRawEvent ADD CONSTRAINT CK_RfidRawEvent_RawPayload_Json CHECK(RawPayload IS NULL OR ISJSON(RawPayload)=1)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RfidReader_Zone_Active' AND object_id=OBJECT_ID('dbo.RfidReader'))
  CREATE INDEX IX_RfidReader_Zone_Active ON dbo.RfidReader(ZoneId, IsActive);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RawEvent_Reader_Received' AND object_id=OBJECT_ID('dbo.RfidRawEvent'))
  CREATE INDEX IX_RawEvent_Reader_Received ON dbo.RfidRawEvent(ReaderId, ReceivedAt DESC);

COMMIT TRANSACTION;
