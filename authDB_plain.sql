--
-- PostgreSQL database dump
--

\restrict hIVZbrn0NFigTURqnt30hlfFtQitFoGXwJUUVmlZGRjUob1Qee2apWTBeEChIBs

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AdminCashFunding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdminCashFunding" (
    "ID" bigint NOT NULL,
    "LocationId" integer NOT NULL,
    "FromUserId" integer NOT NULL,
    "ToUserId" integer NOT NULL,
    "ToSessionId" bigint,
    "FundingType" character varying(24) NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "Status" character varying(12) DEFAULT 'Pending'::character varying NOT NULL,
    "Notes" character varying(500),
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "AcceptedAt" timestamp with time zone,
    "AcceptedBy" integer,
    "CancelledAt" timestamp with time zone,
    "CancelledBy" integer,
    "CustodySourceAccountId" bigint,
    CONSTRAINT "AdminCashFunding_AcceptanceShape" CHECK ((((("Status")::text = 'Pending'::text) AND ("ToSessionId" IS NULL) AND ("AcceptedAt" IS NULL) AND ("AcceptedBy" IS NULL) AND ("CancelledAt" IS NULL) AND ("CancelledBy" IS NULL)) OR ((("Status")::text = 'Accepted'::text) AND ("ToSessionId" IS NOT NULL) AND ("AcceptedAt" IS NOT NULL) AND ("AcceptedBy" = "ToUserId") AND ("CancelledAt" IS NULL) AND ("CancelledBy" IS NULL)) OR ((("Status")::text = 'Cancelled'::text) AND ("ToSessionId" IS NULL) AND ("AcceptedAt" IS NULL) AND ("AcceptedBy" IS NULL) AND ("CancelledAt" IS NOT NULL) AND ("CancelledBy" IS NOT NULL)))),
    CONSTRAINT "AdminCashFunding_Amount_check" CHECK (("Amount" > (0)::numeric)),
    CONSTRAINT "AdminCashFunding_FundingType_check" CHECK ((("FundingType")::text = ANY (ARRAY[('INITIAL_OPENING'::character varying)::text, ('BUSINESS_SUPPORT'::character varying)::text]))),
    CONSTRAINT "AdminCashFunding_Status_check" CHECK ((("Status")::text = ANY (ARRAY[('Pending'::character varying)::text, ('Accepted'::character varying)::text, ('Cancelled'::character varying)::text])))
);


--
-- Name: AdminCashFunding_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."AdminCashFunding" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."AdminCashFunding_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Bonus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Bonus" (
    "ID" integer NOT NULL,
    "Name" character varying(200) NOT NULL,
    "IsActive" boolean DEFAULT true NOT NULL,
    "LocationId" integer NOT NULL,
    "DateCreated" timestamp without time zone DEFAULT now() NOT NULL,
    "DateUpdated" timestamp without time zone
);


--
-- Name: BonusAwards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BonusAwards" (
    "ID" bigint NOT NULL,
    "LocationId" bigint NOT NULL,
    "EmployeeSessionId" bigint NOT NULL,
    "EmployeeId" bigint NOT NULL,
    "BonusId" integer,
    "BonusPayoutId" integer,
    "BonusName" character varying(200) NOT NULL,
    "PayoutDescription" character varying(300) NOT NULL,
    "MachineId" bigint NOT NULL,
    "CustomerId" integer NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "ImageUrl" text NOT NULL,
    "CreatedBy" bigint NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "ReviewStatus" character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    "ReviewedBy" bigint,
    "ReviewedAt" timestamp with time zone,
    CONSTRAINT "BonusAwards_Amount_check" CHECK (("Amount" > (0)::numeric)),
    CONSTRAINT "BonusAwards_ReviewStatus_check" CHECK ((("ReviewStatus")::text = ANY (ARRAY[('Pending'::character varying)::text, ('Approved'::character varying)::text, ('Rejected'::character varying)::text])))
);


--
-- Name: BonusAwards_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."BonusAwards_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: BonusAwards_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."BonusAwards_ID_seq" OWNED BY public."BonusAwards"."ID";


--
-- Name: BonusPayout; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BonusPayout" (
    "ID" integer NOT NULL,
    "BonusId" integer NOT NULL,
    "Description" character varying(300) NOT NULL,
    "Amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "SortOrder" integer DEFAULT 0 NOT NULL
);


--
-- Name: BonusPayout_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."BonusPayout" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."BonusPayout_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: BonusScheduleBlock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BonusScheduleBlock" (
    "ID" integer NOT NULL,
    "BonusId" integer NOT NULL,
    "IsAllDay" boolean DEFAULT true NOT NULL,
    "StartTime" time without time zone,
    "EndTime" time without time zone,
    "SortOrder" integer DEFAULT 0 NOT NULL,
    "EndDayOffset" smallint DEFAULT 0 NOT NULL,
    CONSTRAINT "BonusScheduleBlock_EndDayOffset_check" CHECK (("EndDayOffset" = ANY (ARRAY[0, 1])))
);


--
-- Name: BonusScheduleBlock_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."BonusScheduleBlock" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."BonusScheduleBlock_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: BonusScheduleDay; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BonusScheduleDay" (
    "ID" integer NOT NULL,
    "ScheduleBlockId" integer NOT NULL,
    "DayOfWeek" smallint NOT NULL,
    CONSTRAINT "BonusScheduleDay_day_check" CHECK ((("DayOfWeek" >= 1) AND ("DayOfWeek" <= 7)))
);


--
-- Name: BonusScheduleDay_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."BonusScheduleDay" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."BonusScheduleDay_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Bonus_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Bonus" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Bonus_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: CheckIn; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CheckIn" (
    "ID" bigint NOT NULL,
    "CustomerId" integer,
    "CheckInDate" timestamp without time zone,
    "Photo" character varying(500),
    "Status" boolean,
    "LocationId" integer,
    "ApprovedBy" integer,
    "ApprovedDate" timestamp without time zone,
    "FaceDistance" double precision,
    "CheckOutDate" timestamp with time zone,
    "IsCheckOut" boolean DEFAULT false
);


--
-- Name: CheckIn_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."CheckIn" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."CheckIn_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Companies" (
    "ID" integer NOT NULL,
    "Name" character varying(200) NOT NULL,
    "Code" character varying(50),
    "IsActive" boolean DEFAULT true NOT NULL,
    "DateCreated" timestamp without time zone DEFAULT now() NOT NULL,
    "DateUpdated" timestamp without time zone
);


--
-- Name: Companies_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Companies" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Companies_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: CreditTypes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CreditTypes" (
    "ID" integer NOT NULL,
    "Name" character varying(100) NOT NULL,
    "IsActive" boolean DEFAULT true NOT NULL,
    "CreatedBy" integer,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "LocationId" integer,
    "Code" character varying(50)
);


--
-- Name: CreditTypes_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."CreditTypes" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."CreditTypes_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Customer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Customer" (
    "ID" integer NOT NULL,
    "Firstname" character varying(50),
    "Lastname" character varying(50),
    "DOB" date,
    avatar character varying(500),
    "Phone" character varying(20),
    "Points" integer,
    "DateCreated" timestamp without time zone,
    "IsActive" boolean DEFAULT true,
    locationid integer,
    "Embedding" public.vector(128),
    "IsBlacklist" boolean DEFAULT false,
    "CreatedBy" integer,
    "IsVIP" boolean DEFAULT false,
    "PrivilegedMatchRule" boolean,
    "PhoneVerified" boolean DEFAULT false NOT NULL,
    "PhoneVerifiedAt" timestamp without time zone,
    "VerificationMethod" character varying(20)
);


--
-- Name: CustomerLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CustomerLog" (
    "ID" integer NOT NULL,
    "CustomerID" integer NOT NULL,
    "UserID" integer NOT NULL,
    "LogType" character varying(50),
    "OldValue" text,
    "NewValue" text,
    "Description" text,
    "DateCreated" timestamp without time zone DEFAULT now()
);


--
-- Name: CustomerLog_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."CustomerLog_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: CustomerLog_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."CustomerLog_ID_seq" OWNED BY public."CustomerLog"."ID";


--
-- Name: CustomerMatch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CustomerMatch" (
    "ID" bigint NOT NULL,
    "CustomerId" integer,
    "MachineId" integer,
    "Points" numeric,
    "DateAssign" timestamp without time zone,
    "ImageUrl" character varying(500),
    "AssignedBy" integer,
    "LocationId" integer,
    "CheckinId" bigint,
    "ReviewStatus" character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    "ReviewedBy" integer,
    "ReviewedAt" timestamp without time zone,
    "EmployeeSessionId" integer,
    "IsExtraMatch" boolean DEFAULT false NOT NULL,
    CONSTRAINT "CustomerMatch_ReviewStatus_check" CHECK ((("ReviewStatus")::text = ANY (ARRAY[('Pending'::character varying)::text, ('Approved'::character varying)::text, ('Rejected'::character varying)::text])))
);


--
-- Name: CustomerMatch_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."CustomerMatch" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."CustomerMatch_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Customer_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Customer" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Customer_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: EmployeeSession; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EmployeeSession" (
    "ID" bigint NOT NULL,
    "UserId" integer NOT NULL,
    "LocationId" integer NOT NULL,
    "ClockIn" timestamp with time zone DEFAULT now() NOT NULL,
    "ClockOut" timestamp with time zone,
    "TotalWorkingHours" numeric(10,2) DEFAULT 0,
    "IsPaid" boolean DEFAULT false,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "ReadingSessionId" bigint
);


--
-- Name: EmployeeSession_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."EmployeeSession" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."EmployeeSession_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ExpenseTypes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExpenseTypes" (
    "ID" integer NOT NULL,
    "LocationId" integer NOT NULL,
    "Name" character varying(100) NOT NULL,
    "IsActive" boolean DEFAULT true NOT NULL,
    "CreatedBy" integer,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "IsGeneral" boolean DEFAULT false NOT NULL
);


--
-- Name: ExpenseTypes_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."ExpenseTypes" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."ExpenseTypes_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Games" (
    "ID" integer NOT NULL,
    "GameName" character varying(200),
    "MachineTypeId" integer,
    "IsActive" boolean DEFAULT true,
    "CompanyId" integer,
    "DateCreated" timestamp without time zone DEFAULT now() NOT NULL,
    "DateUpdated" timestamp without time zone
);


--
-- Name: Games_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Games" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Games_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: LocationCashAccounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LocationCashAccounts" (
    "ID" bigint NOT NULL,
    "LocationId" integer NOT NULL,
    "Kind" text NOT NULL,
    "UserId" integer,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "LocationCashAccounts_Kind_check" CHECK (("Kind" = ANY (ARRAY['OWNER'::text, 'ADMIN'::text, 'BANK'::text]))),
    CONSTRAINT "LocationCashAccounts_kind_user_check" CHECK (((("Kind" = 'BANK'::text) AND ("UserId" IS NULL)) OR (("Kind" <> 'BANK'::text) AND ("UserId" IS NOT NULL))))
);


--
-- Name: LocationCashAccounts_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."LocationCashAccounts" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."LocationCashAccounts_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: LocationCashCapital; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LocationCashCapital" (
    "ID" bigint NOT NULL,
    "LocationId" integer NOT NULL,
    "ToAccountId" bigint NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "Status" text DEFAULT 'Pending'::text NOT NULL,
    "Notes" text,
    "CreatedBy" integer NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "AcceptedBy" integer,
    "AcceptedAt" timestamp with time zone,
    "CancelledBy" integer,
    "CancelledAt" timestamp with time zone,
    CONSTRAINT "LocationCashCapital_Amount_check" CHECK (("Amount" > (0)::numeric)),
    CONSTRAINT "LocationCashCapital_Status_check" CHECK (("Status" = ANY (ARRAY['Pending'::text, 'Accepted'::text, 'Cancelled'::text])))
);


--
-- Name: LocationCashCapital_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."LocationCashCapital" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."LocationCashCapital_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: LocationCashEntries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LocationCashEntries" (
    "ID" bigint NOT NULL,
    "LocationId" integer NOT NULL,
    "AccountId" bigint NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "Kind" text NOT NULL,
    "TransferId" bigint,
    "MovementKey" uuid,
    "CapitalId" bigint,
    "ReadingProfitPostingId" bigint,
    "FundingId" bigint,
    "ExpenseTypeId" integer,
    "SessionTransactionId" bigint,
    "Notes" text,
    "CreatedBy" integer NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "LocationCashEntries_Amount_check" CHECK (("Amount" <> (0)::numeric)),
    CONSTRAINT "LocationCashEntries_Kind_check" CHECK (("Kind" = ANY (ARRAY['INITIAL_CAPITAL'::text, 'MACHINE_COLLECTION'::text, 'TRANSFER'::text, 'BANK_DEPOSIT'::text, 'BANK_WITHDRAWAL'::text, 'OWNER_DISTRIBUTION'::text, 'CUTOVER_OPENING'::text, 'EMPLOYEE_SUPPORT'::text, 'EMPLOYEE_CASH_TAKEN'::text, 'DIRECT_EXPENSE'::text])))
);


--
-- Name: LocationCashEntries_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."LocationCashEntries" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."LocationCashEntries_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: LocationCashTransfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LocationCashTransfers" (
    "ID" bigint NOT NULL,
    "LocationId" integer NOT NULL,
    "FromAccountId" bigint NOT NULL,
    "ToAccountId" bigint NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "Kind" text NOT NULL,
    "Status" text DEFAULT 'Pending'::text NOT NULL,
    "Notes" text,
    "CreatedBy" integer NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "AcceptedBy" integer,
    "AcceptedAt" timestamp with time zone,
    "CancelledBy" integer,
    "CancelledAt" timestamp with time zone,
    CONSTRAINT "LocationCashTransfers_Amount_check" CHECK (("Amount" > (0)::numeric)),
    CONSTRAINT "LocationCashTransfers_Kind_check" CHECK (("Kind" = ANY (ARRAY['OWNER_TO_ADMIN'::text, 'ADMIN_TO_OWNER'::text]))),
    CONSTRAINT "LocationCashTransfers_Status_check" CHECK (("Status" = ANY (ARRAY['Pending'::text, 'Accepted'::text, 'Cancelled'::text]))),
    CONSTRAINT "LocationCashTransfers_different_accounts" CHECK (("FromAccountId" <> "ToAccountId"))
);


--
-- Name: LocationCashTransfers_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."LocationCashTransfers" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."LocationCashTransfers_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: LocationRuleSettings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LocationRuleSettings" (
    "ID" integer NOT NULL,
    "LocationId" integer NOT NULL,
    "MatchRuleEnabled" boolean DEFAULT false NOT NULL,
    "MatchRuleName" character varying(100) DEFAULT 'MATCH'::character varying NOT NULL,
    "MatchCooldownHours" integer DEFAULT 3 NOT NULL,
    "MatchMaxPerDay" integer DEFAULT 2 NOT NULL,
    "MatchResetTimes" jsonb DEFAULT '["07:00", "19:00"]'::jsonb NOT NULL,
    "MatchResetDayTime" time without time zone DEFAULT '07:00:00'::time without time zone NOT NULL,
    "NfcTicketOutEnabled" boolean DEFAULT false NOT NULL,
    "AuditVerificationEnabled" boolean DEFAULT false NOT NULL,
    "PhoneVerificationRequired" boolean DEFAULT false NOT NULL,
    "NuVueBoostEnabled" boolean DEFAULT false NOT NULL,
    "TicketPhotoRequired" boolean DEFAULT false NOT NULL,
    "TicketPhotoMinAmount" numeric(12,2) DEFAULT 10 NOT NULL,
    "VipMatchEnabled" boolean DEFAULT false NOT NULL,
    "VipMatchMinPoints" integer DEFAULT 10 NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "UpdatedBy" integer,
    CONSTRAINT "CK_LocationRuleSettings_MatchCooldownHours" CHECK (("MatchCooldownHours" >= 0)),
    CONSTRAINT "CK_LocationRuleSettings_MatchMaxPerDay" CHECK (("MatchMaxPerDay" >= 0)),
    CONSTRAINT "CK_LocationRuleSettings_MatchResetTimes_Array" CHECK ((jsonb_typeof("MatchResetTimes") = 'array'::text)),
    CONSTRAINT "CK_LocationRuleSettings_TicketPhotoMinAmount" CHECK (("TicketPhotoMinAmount" >= (0)::numeric)),
    CONSTRAINT "CK_LocationRuleSettings_VipMatchMinPoints" CHECK (("VipMatchMinPoints" >= 0))
);


--
-- Name: LocationRuleSettings_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."LocationRuleSettings" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."LocationRuleSettings_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Locations" (
    "ID" integer NOT NULL,
    name character varying(100),
    "IsActive" boolean,
    "CompanyId" integer,
    "AllowFaceCheckin" boolean DEFAULT false
);


--
-- Name: Locations_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Locations" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Locations_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: LuckyBird; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LuckyBird" (
    "ID" integer NOT NULL,
    "Name" character varying(150) NOT NULL,
    "IsActive" boolean DEFAULT true NOT NULL,
    "LocationId" integer NOT NULL,
    "DateCreated" timestamp with time zone DEFAULT now() NOT NULL,
    "DateUpdated" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: LuckyBirdAwards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LuckyBirdAwards" (
    "ID" integer NOT NULL,
    "LocationId" integer NOT NULL,
    "EmployeeSessionId" integer NOT NULL,
    "EmployeeId" integer NOT NULL,
    "LuckyBirdId" integer,
    "LuckyBirdPayoutId" integer,
    "LuckyBirdName" character varying(150) NOT NULL,
    "PayoutDescription" character varying(200) NOT NULL,
    "MachineId" integer NOT NULL,
    "CustomerId" integer NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "ImageUrl" text NOT NULL,
    "CreatedBy" integer NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: LuckyBirdAwards_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LuckyBirdAwards_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LuckyBirdAwards_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LuckyBirdAwards_ID_seq" OWNED BY public."LuckyBirdAwards"."ID";


--
-- Name: LuckyBirdPayout; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LuckyBirdPayout" (
    "ID" integer NOT NULL,
    "LuckyBirdId" integer NOT NULL,
    "Description" character varying(200) NOT NULL,
    "Amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "SortOrder" integer DEFAULT 0 NOT NULL
);


--
-- Name: LuckyBirdPayout_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LuckyBirdPayout_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LuckyBirdPayout_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LuckyBirdPayout_ID_seq" OWNED BY public."LuckyBirdPayout"."ID";


--
-- Name: LuckyBirdScheduleBlock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LuckyBirdScheduleBlock" (
    "ID" integer NOT NULL,
    "LuckyBirdId" integer NOT NULL,
    "IsAllDay" boolean DEFAULT false NOT NULL,
    "StartTime" time without time zone,
    "EndTime" time without time zone,
    "EndDayOffset" integer DEFAULT 0 NOT NULL,
    "SortOrder" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "LuckyBirdScheduleBlock_EndDayOffset_check" CHECK (("EndDayOffset" = ANY (ARRAY[0, 1])))
);


--
-- Name: LuckyBirdScheduleBlock_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LuckyBirdScheduleBlock_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LuckyBirdScheduleBlock_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LuckyBirdScheduleBlock_ID_seq" OWNED BY public."LuckyBirdScheduleBlock"."ID";


--
-- Name: LuckyBirdScheduleDay; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LuckyBirdScheduleDay" (
    "ID" integer NOT NULL,
    "ScheduleBlockId" integer NOT NULL,
    "DayOfWeek" integer NOT NULL,
    CONSTRAINT "LuckyBirdScheduleDay_DayOfWeek_check" CHECK ((("DayOfWeek" >= 1) AND ("DayOfWeek" <= 7)))
);


--
-- Name: LuckyBirdScheduleDay_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LuckyBirdScheduleDay_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LuckyBirdScheduleDay_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LuckyBirdScheduleDay_ID_seq" OWNED BY public."LuckyBirdScheduleDay"."ID";


--
-- Name: LuckyBird_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LuckyBird_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LuckyBird_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LuckyBird_ID_seq" OWNED BY public."LuckyBird"."ID";


--
-- Name: MachineLogs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MachineLogs" (
    "ID" integer NOT NULL,
    "MachineId" integer NOT NULL,
    "ActionType" character varying(100) NOT NULL,
    "FieldName" character varying(100),
    "OldValue" text,
    "NewValue" text,
    "Reason" character varying(1000),
    "ChangedBy" integer,
    "DateCreated" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: MachineLogs_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."MachineLogs" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."MachineLogs_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: MachineReadings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MachineReadings" (
    "ID" bigint NOT NULL,
    "SessionId" bigint,
    "MachineId" integer NOT NULL,
    "ReadingType" character varying(10) NOT NULL,
    "CurrentIn" numeric(18,0),
    "CurrentOut" numeric(18,0),
    "ReadingAt" timestamp with time zone DEFAULT now() NOT NULL,
    "PreviousIn" numeric(18,0),
    "PreviousOut" numeric(18,0)
);


--
-- Name: MachineReadings_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."MachineReadings" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."MachineReadings_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: MachineStatus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MachineStatus" (
    "ID" integer NOT NULL,
    "Description" character varying(100)
);


--
-- Name: MachineStatusLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MachineStatusLog" (
    "ID" bigint NOT NULL,
    "MachineId" integer,
    "MachineStatusId" integer,
    "Reason" character varying(500),
    "ChangeBy" integer
);


--
-- Name: MachineStatusLog_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."MachineStatusLog" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."MachineStatusLog_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: MachineStatus_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."MachineStatus" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."MachineStatus_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: MachineTypes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MachineTypes" (
    "ID" integer NOT NULL,
    "TypeName" character varying(100),
    "CompanyId" integer,
    "IsActive" boolean DEFAULT true NOT NULL,
    "DateCreated" timestamp without time zone DEFAULT now() NOT NULL,
    "DateUpdated" timestamp without time zone
);


--
-- Name: MachineTypes_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."MachineTypes" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."MachineTypes_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Machines" (
    "ID" integer NOT NULL,
    "MachineNumber" integer,
    "MachineTypeId" integer,
    "GameId" integer,
    "StatusId" integer,
    locationid integer,
    "StatusReason" character varying(1000),
    "DateCreated" timestamp without time zone DEFAULT now() NOT NULL,
    "DateUpdated" timestamp without time zone,
    "UpdatedBy" integer
);


--
-- Name: Machines_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Machines" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Machines_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: Permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Permissions" (
    "ID" integer NOT NULL,
    "Code" character varying(150) NOT NULL,
    "Module" character varying(100) NOT NULL,
    "Action" character varying(50) NOT NULL,
    "Description" character varying(300)
);


--
-- Name: Permissions_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Permissions" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Permissions_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PromotionAuditLogs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PromotionAuditLogs" (
    "ID" bigint NOT NULL,
    "CompanyId" integer,
    "PromotionId" bigint,
    "TemplateId" bigint,
    "UserId" bigint,
    "Action" character varying(100) NOT NULL,
    "EntityType" character varying(50),
    "EntityId" bigint,
    "Details" jsonb,
    "CreatedAt" timestamp with time zone DEFAULT now()
);


--
-- Name: PromotionAuditLogs_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PromotionAuditLogs_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PromotionAuditLogs_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PromotionAuditLogs_ID_seq" OWNED BY public."PromotionAuditLogs"."ID";


--
-- Name: PromotionDeliveryLogs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PromotionDeliveryLogs" (
    "ID" bigint NOT NULL,
    "PromotionId" bigint NOT NULL,
    "PromotionRecipientId" bigint,
    "CustomerId" bigint,
    "TwilioMessageSid" character varying(100),
    "Channel" character varying(20),
    "Status" character varying(50),
    "ErrorCode" character varying(50),
    "ErrorMessage" text,
    "RawPayload" jsonb,
    "CreatedAt" timestamp with time zone DEFAULT now()
);


--
-- Name: PromotionDeliveryLogs_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PromotionDeliveryLogs_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PromotionDeliveryLogs_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PromotionDeliveryLogs_ID_seq" OWNED BY public."PromotionDeliveryLogs"."ID";


--
-- Name: PromotionRecipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PromotionRecipients" (
    "ID" bigint NOT NULL,
    "PromotionId" bigint NOT NULL,
    "CustomerId" bigint NOT NULL,
    "CustomerName" character varying(200),
    "Phone" character varying(40),
    "Channel" character varying(20),
    "Status" character varying(30) DEFAULT 'Pending'::character varying,
    "TwilioMessageSid" character varying(100),
    "TwilioStatus" character varying(50),
    "TwilioErrorCode" character varying(50),
    "TwilioErrorMessage" text,
    "QueuedAt" timestamp with time zone,
    "SentAt" timestamp with time zone,
    "DeliveredAt" timestamp with time zone,
    "FailedAt" timestamp with time zone,
    "UpdatedAt" timestamp with time zone DEFAULT now()
);


--
-- Name: PromotionRecipients_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PromotionRecipients_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PromotionRecipients_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PromotionRecipients_ID_seq" OWNED BY public."PromotionRecipients"."ID";


--
-- Name: PromotionTemplates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PromotionTemplates" (
    "ID" bigint NOT NULL,
    "CompanyId" integer,
    "Name" character varying(200) NOT NULL,
    "Description" text,
    "TemplateType" character varying(30) DEFAULT 'Custom'::character varying NOT NULL,
    "DesignJson" jsonb,
    "PreviewImageUrl" text,
    "FinalImageUrl" text,
    "Width" integer,
    "Height" integer,
    "IsSystemTemplate" boolean DEFAULT false,
    "IsActive" boolean DEFAULT true,
    "CreatedBy" bigint NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now(),
    "UpdatedBy" bigint,
    "UpdatedAt" timestamp with time zone,
    "IsDeleted" boolean DEFAULT false,
    "SourceTemplateId" bigint
);


--
-- Name: PromotionTemplates_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PromotionTemplates_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PromotionTemplates_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PromotionTemplates_ID_seq" OWNED BY public."PromotionTemplates"."ID";


--
-- Name: Promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Promotions" (
    "ID" bigint NOT NULL,
    "CompanyId" integer NOT NULL,
    "LocationId" integer,
    "TemplateId" bigint,
    "Name" character varying(200) NOT NULL,
    "MessageText" text,
    "Channel" character varying(20),
    "FinalImageUrl" text,
    "Status" character varying(30) DEFAULT 'Draft'::character varying,
    "ScheduledAt" timestamp with time zone,
    "StartedAt" timestamp with time zone,
    "CompletedAt" timestamp with time zone,
    "CreatedBy" bigint NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now(),
    "UpdatedBy" bigint,
    "UpdatedAt" timestamp with time zone,
    "IsDeleted" boolean DEFAULT false
);


--
-- Name: Promotions_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Promotions_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Promotions_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Promotions_ID_seq" OWNED BY public."Promotions"."ID";


--
-- Name: RaffleAttempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RaffleAttempts" (
    "ID" bigint NOT NULL,
    "RaffleId" bigint NOT NULL,
    "AttemptNo" integer NOT NULL,
    "MachineId" bigint NOT NULL,
    "CustomerId" bigint,
    "SpunAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "RaffleAttempts_AttemptNo_check" CHECK ((("AttemptNo" >= 1) AND ("AttemptNo" <= 2)))
);


--
-- Name: RaffleAttempts_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."RaffleAttempts_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: RaffleAttempts_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."RaffleAttempts_ID_seq" OWNED BY public."RaffleAttempts"."ID";


--
-- Name: RaffleSettings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RaffleSettings" (
    "ID" bigint NOT NULL,
    "LocationId" bigint NOT NULL,
    "ExcludedMachineIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "AllowRepeatMachine" boolean DEFAULT false NOT NULL,
    "SpinDurationSeconds" integer DEFAULT 8 NOT NULL,
    "UpdatedBy" bigint,
    "UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "RaffleSettings_SpinDurationSeconds_check" CHECK ((("SpinDurationSeconds" >= 3) AND ("SpinDurationSeconds" <= 30)))
);


--
-- Name: RaffleSettings_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."RaffleSettings_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: RaffleSettings_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."RaffleSettings_ID_seq" OWNED BY public."RaffleSettings"."ID";


--
-- Name: Raffles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Raffles" (
    "ID" bigint NOT NULL,
    "LocationId" bigint NOT NULL,
    "EmployeeSessionId" bigint NOT NULL,
    "EmployeeId" bigint NOT NULL,
    "Status" character varying(30) DEFAULT 'OPEN'::character varying NOT NULL,
    "WinningMachineId" bigint,
    "WinnerCustomerId" bigint,
    "WinningAmount" numeric(14,2),
    "WinnerImageUrl" text,
    "SessionTransactionId" bigint,
    "StartedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "CompletedAt" timestamp with time zone,
    "CreatedBy" bigint NOT NULL,
    "ReviewStatus" character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    "ReviewedBy" bigint,
    "ReviewedAt" timestamp with time zone,
    CONSTRAINT "Raffles_Amount_chk" CHECK ((("WinningAmount" IS NULL) OR ("WinningAmount" > (0)::numeric))),
    CONSTRAINT "Raffles_ReviewStatus_check" CHECK ((("ReviewStatus")::text = ANY (ARRAY[('Pending'::character varying)::text, ('Approved'::character varying)::text, ('Rejected'::character varying)::text]))),
    CONSTRAINT "Raffles_Status_chk" CHECK ((("Status")::text = ANY (ARRAY[('OPEN'::character varying)::text, ('WINNER'::character varying)::text, ('NO_WINNER'::character varying)::text])))
);


--
-- Name: Raffles_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Raffles_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Raffles_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Raffles_ID_seq" OWNED BY public."Raffles"."ID";


--
-- Name: ReadingProfitPostings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ReadingProfitPostings" (
    "ID" bigint NOT NULL,
    "LocationId" integer NOT NULL,
    "ReadingSessionId" bigint NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "PostedBy" integer NOT NULL,
    "PostedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "Notes" text
);


--
-- Name: ReadingProfitPostings_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."ReadingProfitPostings" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."ReadingProfitPostings_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ReadingSessionCashTransactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ReadingSessionCashTransactions" (
    "ID" integer NOT NULL,
    "LocationId" integer NOT NULL,
    "ReadingSessionId" integer NOT NULL,
    "Type" character varying(20) NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "ExpenseTypeId" integer,
    "CreditTypeId" integer,
    "CreatedBy" integer,
    "Notes" character varying(500),
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "LegacyLocationCashEntryId" integer,
    CONSTRAINT "CK_ReadingSessionCashTransactions_Amount" CHECK (("Amount" > (0)::numeric)),
    CONSTRAINT "CK_ReadingSessionCashTransactions_Type" CHECK ((("Type")::text = ANY (ARRAY[('CREDIT'::character varying)::text, ('EXPENSE'::character varying)::text]))),
    CONSTRAINT "CK_ReadingSessionCashTransactions_TypeReference" CHECK ((((("Type")::text = 'EXPENSE'::text) AND ("ExpenseTypeId" IS NOT NULL) AND ("CreditTypeId" IS NULL)) OR ((("Type")::text = 'CREDIT'::text) AND ("CreditTypeId" IS NOT NULL) AND ("ExpenseTypeId" IS NULL))))
);


--
-- Name: ReadingSessionCashTransactions_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ReadingSessionCashTransactions_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ReadingSessionCashTransactions_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ReadingSessionCashTransactions_ID_seq" OWNED BY public."ReadingSessionCashTransactions"."ID";


--
-- Name: ReadingSessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ReadingSessions" (
    "ID" bigint NOT NULL,
    "DateCreated" timestamp with time zone DEFAULT now() NOT NULL,
    "StartedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "EndedAt" timestamp with time zone,
    "Status" integer,
    "LocationId" integer,
    "isDeleted" boolean DEFAULT false,
    CONSTRAINT "ReadingSessions_Status_check" CHECK (("Status" = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: ReadingSessions_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."ReadingSessions" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."ReadingSessions_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: RolePermissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RolePermissions" (
    "RoleId" integer NOT NULL,
    "PermissionId" integer NOT NULL
);


--
-- Name: Roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Roles" (
    "ID" integer NOT NULL,
    "Name" character varying(100) NOT NULL,
    "Description" character varying(300),
    "IsSystem" boolean DEFAULT false NOT NULL,
    "IsActive" boolean DEFAULT true NOT NULL,
    "DateCreated" timestamp without time zone DEFAULT now() NOT NULL,
    "DateUpdated" timestamp without time zone
);


--
-- Name: Roles_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Roles" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Roles_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: SessionCashClosings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SessionCashClosings" (
    "SessionId" bigint NOT NULL,
    "LocationId" integer NOT NULL,
    "ClosingBalance" numeric(14,2) NOT NULL,
    "HandoverId" bigint,
    "ClosedBy" integer NOT NULL,
    "ClosedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "ActualCash" numeric(14,2) NOT NULL,
    "Variance" numeric(14,2) NOT NULL,
    CONSTRAINT "SessionCashClosings_ClosingBalance_check" CHECK (("ClosingBalance" >= (0)::numeric))
);


--
-- Name: SessionCashHandovers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SessionCashHandovers" (
    "ID" bigint NOT NULL,
    "FromSessionId" bigint NOT NULL,
    "FromUserId" integer NOT NULL,
    "ToUserId" integer NOT NULL,
    "ToSessionId" bigint,
    "LocationId" integer NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "Status" character varying(12) DEFAULT 'Pending'::character varying NOT NULL,
    "Notes" character varying(500),
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "AcceptedAt" timestamp with time zone,
    "AcceptedBy" integer,
    CONSTRAINT "SessionCashHandovers_AcceptanceShape" CHECK ((((("Status")::text = 'Pending'::text) AND ("ToSessionId" IS NULL) AND ("AcceptedAt" IS NULL) AND ("AcceptedBy" IS NULL)) OR ((("Status")::text = 'Accepted'::text) AND ("ToSessionId" IS NOT NULL) AND ("AcceptedAt" IS NOT NULL) AND ("AcceptedBy" = "ToUserId")))),
    CONSTRAINT "SessionCashHandovers_Amount_check" CHECK (("Amount" >= (0)::numeric)),
    CONSTRAINT "SessionCashHandovers_Status_check" CHECK ((("Status")::text = ANY (ARRAY[('Pending'::character varying)::text, ('Accepted'::character varying)::text]))),
    CONSTRAINT "SessionCashHandovers_check" CHECK (("FromUserId" <> "ToUserId"))
);


--
-- Name: SessionCashHandovers_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."SessionCashHandovers" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."SessionCashHandovers_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: SessionCashTransactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SessionCashTransactions" (
    "ID" bigint NOT NULL,
    "SessionId" bigint NOT NULL,
    "LocationId" integer NOT NULL,
    "Type" character varying(24) NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "ExpenseTypeId" integer,
    "Notes" character varying(500),
    "TransferId" bigint,
    "CreatedBy" integer NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "FundingId" bigint,
    "CreditTypeId" integer,
    CONSTRAINT "SessionCashTransactions_Amount_check" CHECK (("Amount" >= (0)::numeric)),
    CONSTRAINT "SessionCashTransactions_ExpenseShape" CHECK ((((("Type")::text = 'EXPENSE'::text) AND ("ExpenseTypeId" IS NOT NULL)) OR ((("Type")::text <> 'EXPENSE'::text) AND ("ExpenseTypeId" IS NULL)))),
    CONSTRAINT "SessionCashTransactions_PositiveActivity" CHECK (((("Type")::text = ANY (ARRAY[('OPENING'::character varying)::text, ('OPENING_TRANSFER'::character varying)::text])) OR ("Amount" > (0)::numeric))),
    CONSTRAINT "SessionCashTransactions_TransferShape" CHECK ((((("Type")::text = 'OPENING_TRANSFER'::text) AND ("TransferId" IS NOT NULL)) OR (("Type")::text = 'TRANSFER_IN'::text) OR ((("Type")::text <> ALL (ARRAY[('OPENING_TRANSFER'::character varying)::text, ('TRANSFER_IN'::character varying)::text])) AND ("TransferId" IS NULL)))),
    CONSTRAINT "SessionCashTransactions_Type_check" CHECK ((("Type")::text = ANY (ARRAY[('OPENING'::character varying)::text, ('OPENING_TRANSFER'::character varying)::text, ('CASH_RECEIVED'::character varying)::text, ('EXPENSE'::character varying)::text, ('TRANSFER_IN'::character varying)::text, ('TRANSFER_OUT'::character varying)::text, ('OWNER_WITHDRAWAL'::character varying)::text])))
);


--
-- Name: SessionCashTransactions_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."SessionCashTransactions" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."SessionCashTransactions_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: TicketOuts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TicketOuts" (
    "ID" bigint NOT NULL,
    "LocationId" bigint NOT NULL,
    "EmployeeSessionId" bigint NOT NULL,
    "EmployeeId" bigint NOT NULL,
    "MachineId" bigint NOT NULL,
    "Amount" numeric(14,2) NOT NULL,
    "ImageUrl" text NOT NULL,
    "SessionTransactionId" bigint,
    "CreatedBy" bigint NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "CustomerId" integer,
    CONSTRAINT "TicketOuts_Amount_check" CHECK (("Amount" > (0)::numeric))
);


--
-- Name: TicketOuts_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."TicketOuts_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: TicketOuts_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."TicketOuts_ID_seq" OWNED BY public."TicketOuts"."ID";


--
-- Name: Users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Users" (
    "ID" integer NOT NULL,
    "Username" character varying(100),
    "Password" character varying(100),
    token character varying(100),
    "LocationId" integer,
    "Name" character varying(100),
    "Avatar" character varying(1000),
    "IsActive" boolean,
    "DateCreated" timestamp without time zone,
    "RoleId" integer NOT NULL,
    "Email" character varying(200),
    "Phone" character varying(50),
    "JobTitle" character varying(150),
    "DateUpdated" timestamp without time zone
);


--
-- Name: Users_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."Users" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."Users_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: BonusAwards ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards" ALTER COLUMN "ID" SET DEFAULT nextval('public."BonusAwards_ID_seq"'::regclass);


--
-- Name: CustomerLog ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerLog" ALTER COLUMN "ID" SET DEFAULT nextval('public."CustomerLog_ID_seq"'::regclass);


--
-- Name: LuckyBird ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBird" ALTER COLUMN "ID" SET DEFAULT nextval('public."LuckyBird_ID_seq"'::regclass);


--
-- Name: LuckyBirdAwards ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdAwards" ALTER COLUMN "ID" SET DEFAULT nextval('public."LuckyBirdAwards_ID_seq"'::regclass);


--
-- Name: LuckyBirdPayout ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdPayout" ALTER COLUMN "ID" SET DEFAULT nextval('public."LuckyBirdPayout_ID_seq"'::regclass);


--
-- Name: LuckyBirdScheduleBlock ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdScheduleBlock" ALTER COLUMN "ID" SET DEFAULT nextval('public."LuckyBirdScheduleBlock_ID_seq"'::regclass);


--
-- Name: LuckyBirdScheduleDay ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdScheduleDay" ALTER COLUMN "ID" SET DEFAULT nextval('public."LuckyBirdScheduleDay_ID_seq"'::regclass);


--
-- Name: PromotionAuditLogs ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionAuditLogs" ALTER COLUMN "ID" SET DEFAULT nextval('public."PromotionAuditLogs_ID_seq"'::regclass);


--
-- Name: PromotionDeliveryLogs ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionDeliveryLogs" ALTER COLUMN "ID" SET DEFAULT nextval('public."PromotionDeliveryLogs_ID_seq"'::regclass);


--
-- Name: PromotionRecipients ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionRecipients" ALTER COLUMN "ID" SET DEFAULT nextval('public."PromotionRecipients_ID_seq"'::regclass);


--
-- Name: PromotionTemplates ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionTemplates" ALTER COLUMN "ID" SET DEFAULT nextval('public."PromotionTemplates_ID_seq"'::regclass);


--
-- Name: Promotions ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Promotions" ALTER COLUMN "ID" SET DEFAULT nextval('public."Promotions_ID_seq"'::regclass);


--
-- Name: RaffleAttempts ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RaffleAttempts" ALTER COLUMN "ID" SET DEFAULT nextval('public."RaffleAttempts_ID_seq"'::regclass);


--
-- Name: RaffleSettings ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RaffleSettings" ALTER COLUMN "ID" SET DEFAULT nextval('public."RaffleSettings_ID_seq"'::regclass);


--
-- Name: Raffles ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Raffles" ALTER COLUMN "ID" SET DEFAULT nextval('public."Raffles_ID_seq"'::regclass);


--
-- Name: ReadingSessionCashTransactions ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingSessionCashTransactions" ALTER COLUMN "ID" SET DEFAULT nextval('public."ReadingSessionCashTransactions_ID_seq"'::regclass);


--
-- Name: TicketOuts ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts" ALTER COLUMN "ID" SET DEFAULT nextval('public."TicketOuts_ID_seq"'::regclass);


--
-- Data for Name: AdminCashFunding; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."AdminCashFunding" ("ID", "LocationId", "FromUserId", "ToUserId", "ToSessionId", "FundingType", "Amount", "Status", "Notes", "CreatedAt", "AcceptedAt", "AcceptedBy", "CancelledAt", "CancelledBy", "CustodySourceAccountId") FROM stdin;
1	1	4	6	3	BUSINESS_SUPPORT	15000.00	Accepted	\N	2026-10-07 13:02:42.68798-05	2026-10-07 13:02:58.342637-05	6	\N	\N	1
\.


--
-- Data for Name: Bonus; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Bonus" ("ID", "Name", "IsActive", "LocationId", "DateCreated", "DateUpdated") FROM stdin;
1	LOL BET-10	t	1	2026-10-02 12:03:52.797264	\N
\.


--
-- Data for Name: BonusAwards; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."BonusAwards" ("ID", "LocationId", "EmployeeSessionId", "EmployeeId", "BonusId", "BonusPayoutId", "BonusName", "PayoutDescription", "MachineId", "CustomerId", "Amount", "ImageUrl", "CreatedBy", "CreatedAt", "ReviewStatus", "ReviewedBy", "ReviewedAt") FROM stdin;
1	1	1	6	1	1	LOL BET-10	3-CARS	1	1	10.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791042557/bonus-awards/vcob3q6jpu6vsjungd11.png	6	2026-10-03 10:49:15.726055-05	Pending	\N	\N
2	1	1	6	1	2	LOL BET-10	3-PLANES	3	2	15.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791042576/bonus-awards/ngmqw8yvnbe2bm2zqiub.png	6	2026-10-03 10:49:34.995176-05	Pending	\N	\N
3	1	2	12	1	1	LOL BET-10	3-CARS	3	4	10.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043987/bonus-awards/stnf24xufuy7tam5utcf.png	12	2026-10-03 11:13:06.297285-05	Pending	\N	\N
\.


--
-- Data for Name: BonusPayout; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."BonusPayout" ("ID", "BonusId", "Description", "Amount", "SortOrder") FROM stdin;
1	1	3-CARS	10.00	0
2	1	3-PLANES	15.00	1
\.


--
-- Data for Name: BonusScheduleBlock; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."BonusScheduleBlock" ("ID", "BonusId", "IsAllDay", "StartTime", "EndTime", "SortOrder", "EndDayOffset") FROM stdin;
1	1	t	\N	\N	0	0
\.


--
-- Data for Name: BonusScheduleDay; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."BonusScheduleDay" ("ID", "ScheduleBlockId", "DayOfWeek") FROM stdin;
1	1	1
2	1	2
3	1	3
4	1	4
5	1	5
6	1	6
7	1	7
\.


--
-- Data for Name: CheckIn; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."CheckIn" ("ID", "CustomerId", "CheckInDate", "Photo", "Status", "LocationId", "ApprovedBy", "ApprovedDate", "FaceDistance", "CheckOutDate", "IsCheckOut") FROM stdin;
1	1	2026-10-03 10:40:20.870621	\N	t	1	6	2026-10-03 10:47:36.359394	\N	\N	f
2	2	2026-10-03 10:40:33.901893	\N	t	1	6	2026-10-03 10:47:56.838188	\N	\N	f
3	3	2026-10-03 10:40:49.364438	\N	t	1	6	2026-10-03 10:48:09.288903	\N	\N	f
4	4	2026-10-03 11:09:15.378482	\N	t	1	12	2026-10-03 11:10:50.975852	\N	\N	f
5	5	2026-10-03 11:09:29.317768	\N	t	1	12	2026-10-03 11:10:59.854385	\N	\N	f
6	6	2026-10-03 11:09:51.835582	\N	t	1	12	2026-10-03 11:11:08.248053	\N	\N	f
7	7	2026-10-03 11:10:36.539357	\N	t	1	12	2026-10-03 11:11:51.536096	\N	\N	f
8	30	2026-10-07 13:06:58.932661	\N	t	1	6	2026-10-07 13:07:15.813695	\N	\N	f
\.


--
-- Data for Name: Companies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Companies" ("ID", "Name", "Code", "IsActive", "DateCreated", "DateUpdated") FROM stdin;
1	IK System Ltd	IKS	t	2026-09-20 20:11:02.990914	2026-09-22 08:20:09.858232
2	Mak Goup LLC	MKG	t	2026-09-22 08:21:28.911706	\N
\.


--
-- Data for Name: CreditTypes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."CreditTypes" ("ID", "Name", "IsActive", "CreatedBy", "CreatedAt", "LocationId", "Code") FROM stdin;
3	OPENING BANK	t	\N	2026-09-28 12:52:54.143074-05	1	\N
5	MANAGER LOAN TO BANK	t	\N	2026-09-28 12:52:54.143074-05	1	\N
6	ADD BANK	t	\N	2026-09-28 12:52:54.143074-05	1	\N
4	PULL	t	\N	2026-09-28 12:52:54.143074-05	1	PULL
\.


--
-- Data for Name: Customer; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Customer" ("ID", "Firstname", "Lastname", "DOB", avatar, "Phone", "Points", "DateCreated", "IsActive", locationid, "Embedding", "IsBlacklist", "CreatedBy", "IsVIP", "PrivilegedMatchRule", "PhoneVerified", "PhoneVerifiedAt", "VerificationMethod") FROM stdin;
103	Twilio	Test 2	2026-10-01	https://res.cloudinary.com/moqaqhrc/image/upload/v1791385141/customers/r2iuqgpqc05z5ysnhfic.png	3466682029	\N	2026-10-07 09:59:01.663338	f	1	[-0.12142539,0.18416183,0.025253803,-0.081721865,-0.12569284,-0.05360364,-0.04177387,-0.09546207,0.16853972,-0.007963252,0.22479005,0.017591273,-0.19986103,-0.045458537,-0.067806624,0.12938519,-0.115138344,-0.16603224,-0.15689915,-0.06487883,0.034045734,0.051636267,0.03575944,0.057902627,-0.15342927,-0.2843199,-0.028288376,-0.10770373,0.0404151,-0.06693146,-0.035836454,-0.030728389,-0.22555885,-0.13872862,0.06953883,0.077055015,-0.008489829,-0.028671574,0.21763627,0.009188192,-0.12275767,0.04459534,0.10597708,0.31144297,0.17215362,0.028109057,0.0780317,-0.07475825,0.031237092,-0.2065433,0.09439481,0.10649418,0.14789715,0.05304959,0.13234271,-0.12584983,0.055906065,0.11265473,-0.18493393,0.06931877,0.13536875,0.0013440531,-0.05216109,-0.0553711,0.30660367,0.059813663,-0.09623518,-0.10149234,0.097907394,-0.14125803,-0.055278003,0.033177506,-0.073990844,-0.0998545,-0.3140095,0.0468243,0.41409153,0.18186611,-0.25346908,0.035586048,-0.09369157,0.012612314,0.093276314,-0.06261732,-0.12502193,0.033156004,-0.13746238,0.022241166,0.22682957,0.030551866,-0.017806798,0.19798648,0.082262345,-0.06969735,0.08229152,0.00773661,-0.11368223,-0.07567051,-0.12846139,0.025910165,-0.009338943,-0.07285614,0.013703892,0.09308141,-0.18251961,0.015900806,-0.027238049,-0.07046586,-0.077190995,0.08218984,-0.14960374,-0.13909185,0.13462538,-0.2349576,0.1631849,0.14968637,-0.0073646903,0.099345356,0.085612275,0.054368753,-0.015902689,0.07614027,-0.027735779,-0.11012812,0.04733127,-0.057390317,0.16356161,0.072167374]	f	4	f	\N	f	\N	\N
106	Ali	 Test 5	2026-09-28	https://res.cloudinary.com/moqaqhrc/image/upload/v1791386849/customers/dqwzcv58vzojsi06lmot.png	3466682029	\N	2026-10-07 10:27:29.774957	f	1	[-0.163938,0.10660803,0.028604418,-0.068138085,-0.17317297,-0.046701606,-0.029512463,-0.0863238,0.14276226,-0.058814064,0.20208868,0.0015843203,-0.18335325,0.03434595,-0.09798534,0.075132415,-0.1273586,-0.15901805,-0.17621389,-0.11545475,0.0139122885,0.048321087,0.019228445,0.06939649,-0.1869774,-0.2732494,-0.07109516,-0.13293833,0.08775936,-0.084742665,-0.040679604,-0.04001072,-0.1514099,-0.07235722,0.046128206,0.083698936,0.004304558,-0.038378578,0.28145608,-0.03249614,-0.145284,0.03294448,0.14992435,0.32554635,0.13649742,0.06860238,0.054375585,-0.02451313,0.09980843,-0.2190277,0.12791654,0.12416831,0.13008302,0.03737417,0.15150836,-0.14308047,0.032270286,0.15650421,-0.11671702,0.13206734,0.10395377,-0.030732406,-0.057754505,-0.06334242,0.28573084,0.068841495,-0.10465708,-0.09308398,0.096447416,-0.19769302,-0.06515917,0.064163186,-0.087049976,-0.091896966,-0.2826011,0.046293464,0.4875715,0.17854695,-0.19694547,0.033637136,-0.043301646,-0.038289256,0.115538865,-0.011182056,-0.1819104,0.025925746,-0.16278717,0.032918803,0.26514542,0.04510977,0.0099661155,0.18565513,0.09226259,-0.036235295,0.05921378,0.024231283,-0.16083355,-0.10981603,-0.07895745,0.030930746,0.08014126,-0.08181113,-0.004886886,0.08867901,-0.19954652,0.037645113,-0.061734866,-0.06683968,-0.056583688,0.076587684,-0.13204823,-0.107355475,0.17749795,-0.22031334,0.09399218,0.16315755,-0.009647198,0.110506505,0.10357184,0.032242283,-0.008111017,0.10552463,-0.085792504,-0.11237826,0.04665777,-0.1005999,0.1446514,0.0666471]	f	4	f	\N	f	\N	\N
108	Testing	 Last one	2026-09-01	https://res.cloudinary.com/moqaqhrc/image/upload/v1791389316/customers/dnjfj16qlj8iwyyuaw83.png	3466682029	\N	2026-10-07 11:08:36.305663	f	1	[-0.13054703,0.10681689,0.055488586,-0.07397799,-0.17885593,-0.06403045,-0.013555903,-0.11159849,0.13653198,-0.061090067,0.225481,-0.0065724915,-0.16764131,0.025096817,-0.07407484,0.09581423,-0.109799474,-0.15364261,-0.15780051,-0.08828176,0.022350032,0.04583799,0.021334523,0.06265865,-0.16544205,-0.2662233,-0.059362955,-0.11110445,0.0933514,-0.044424504,-0.023066115,-0.019253634,-0.15112558,-0.07758444,0.051840767,0.07637112,0.0081581315,-0.056195688,0.27794668,-0.011647954,-0.16143706,0.03138186,0.141657,0.32108143,0.13446279,0.057768293,0.07790901,-0.028174486,0.10234725,-0.22417057,0.13198917,0.074279875,0.15191352,0.030622082,0.1463162,-0.16363177,0.07192093,0.14111991,-0.13897471,0.12446152,0.12783243,-0.03346958,-0.028646668,-0.0398233,0.33097824,0.07181236,-0.089256585,-0.08057619,0.089849316,-0.15458754,-0.08218331,0.05519831,-0.11661019,-0.05237246,-0.31536308,0.04367394,0.51217,0.14717193,-0.20655589,0.021645948,-0.04293972,0.0066335956,0.14352481,-0.0076598134,-0.16204228,-0.0138340555,-0.16296822,0.010906251,0.2693831,0.023762763,-0.02545586,0.18158938,0.08965939,-0.035337128,0.040927842,0.0005974247,-0.13122328,-0.07789156,-0.057796042,0.033678308,0.071655065,-0.0659698,0.01694507,0.116983816,-0.24331696,0.029816717,-0.059961356,-0.05002066,-0.021096386,0.08524356,-0.13025247,-0.10256333,0.1451637,-0.22828662,0.117441215,0.15813322,0.00053525856,0.09414683,0.08598419,0.025685435,0.0025925608,0.11635476,-0.07610836,-0.0948437,0.05671464,-0.09791104,0.15020254,0.09033499]	f	4	f	\N	f	\N	\N
109	Twilio	test modern	2026-10-01	https://res.cloudinary.com/moqaqhrc/image/upload/v1791390075/customers/ysesrcr7gahbkwrdxi2z.png	3466682029	\N	2026-10-07 11:21:15.848464	f	1	[-0.13961697,0.11152308,0.02959899,-0.07575524,-0.16201672,-0.045832768,-0.039785095,-0.073630825,0.14267814,-0.06750759,0.16948116,0.018188406,-0.17753875,0.061866138,-0.10310677,0.08811184,-0.12126467,-0.17000955,-0.1976959,-0.105169825,0.024178527,0.074574605,-0.024527611,0.063675895,-0.15951064,-0.262085,-0.076112285,-0.103757195,0.080027156,-0.07633568,-0.045805972,-0.04098504,-0.14813766,-0.06704092,0.057723846,0.03909265,0.007520212,-0.042244233,0.2691089,0.014262171,-0.14149088,0.042192265,0.14694151,0.34213626,0.1525088,0.086538605,0.053596944,-0.027138393,0.12277953,-0.25442842,0.1114344,0.12780659,0.1398192,0.07549741,0.14529192,-0.16189332,0.057107776,0.1396933,-0.114041835,0.15745087,0.1106842,-0.05906332,-0.04299947,-0.056785863,0.29640028,0.06583776,-0.10035988,-0.0911589,0.09530717,-0.1900571,-0.074288905,0.033001013,-0.089079574,-0.07421334,-0.2871899,0.033970147,0.4774354,0.19291914,-0.21303198,0.022785911,-0.05645732,0.0036781048,0.13601156,-0.03670537,-0.19512716,-0.00779045,-0.15687291,0.016062927,0.30486453,0.04720625,0.0036030053,0.1890863,0.09278633,-0.037397332,0.05476512,0.026650961,-0.14945345,-0.12196744,-0.06747036,0.047190595,0.060838513,-0.09137218,0.0040500406,0.10625914,-0.20845945,0.05808469,-0.063509814,-0.04593727,-0.062210165,0.09389091,-0.14928287,-0.09456446,0.16670713,-0.19215402,0.12586378,0.16933827,-0.0062202653,0.09871933,0.0888522,0.043196596,-0.03846666,0.09816924,-0.07219006,-0.13295457,0.054822672,-0.07686414,0.13577121,0.071748875]	f	4	f	\N	f	\N	\N
110	Twilip	SMS	2026-09-28	https://res.cloudinary.com/moqaqhrc/image/upload/v1791390184/customers/tdeqjmbzir7wq4yw4t7l.png	3466682029	\N	2026-10-07 11:23:04.676587	t	1	[-0.14635143,0.104455754,0.037732176,-0.069016546,-0.17028286,-0.043737795,-0.019830087,-0.05046819,0.16242917,-0.05642606,0.20243151,-0.022121383,-0.18613318,0.042842824,-0.090502255,0.111151755,-0.13127993,-0.1446225,-0.19747062,-0.11050034,0.012922292,0.0880232,0.008948728,0.046895877,-0.17005564,-0.29698035,-0.06212544,-0.086370856,0.10690867,-0.07425567,-0.027978607,0.00081816316,-0.16296026,-0.099504344,0.06259533,0.07446277,0.0204795,-0.039681938,0.26991218,0.012747998,-0.16576333,0.044721384,0.16216315,0.33703876,0.1328501,0.080768466,0.04735045,-0.02467465,0.078338884,-0.2310517,0.10653092,0.11932428,0.12866306,0.058329478,0.14698052,-0.14720446,0.035382412,0.17365892,-0.12010696,0.12696303,0.12828946,-0.031908628,-0.017384984,-0.069803484,0.28259605,0.042518597,-0.1061033,-0.07970627,0.0783718,-0.170344,-0.05907434,0.057236154,-0.07696528,-0.069122896,-0.32498452,0.041852772,0.47319072,0.1691636,-0.19029467,0.007697623,-0.03352351,-0.018134031,0.11747889,-0.01379568,-0.18894829,0.00422094,-0.14027777,0.016047982,0.26792428,0.0726965,0.0030540288,0.18953525,0.08881097,-0.045218553,0.03980387,0.03693336,-0.15868108,-0.12565275,-0.07479971,0.036757108,0.050690442,-0.099318996,0.002876297,0.1100843,-0.21716586,0.049169797,-0.061906114,-0.062237263,-0.051789097,0.107073314,-0.11226261,-0.086752124,0.16702946,-0.2120941,0.09654205,0.18215695,-0.014324219,0.10994788,0.10662295,0.04865809,-0.038515728,0.1093554,-0.064014144,-0.13138737,0.03512789,-0.096680105,0.15684825,0.07913248]	f	4	f	\N	f	\N	Bypass
104	Twilio	Test 3	2026-09-30	https://res.cloudinary.com/moqaqhrc/image/upload/v1791385593/customers/ybtskss7lebdo20dfep7.png	3466682029	\N	2026-10-07 10:06:33.74854	f	1	[-0.1415849,0.12102845,0.044544235,-0.056948762,-0.1435043,-0.07721735,-0.014769526,-0.09216452,0.14469402,-0.06782922,0.2068089,-0.027983682,-0.15008979,0.013673067,-0.06545359,0.10868949,-0.11830889,-0.1583927,-0.17843765,-0.07696605,0.014171224,0.08042098,0.0045609763,0.049369417,-0.16659762,-0.29040945,-0.0461303,-0.09778708,0.08014247,-0.05036826,-0.027637908,0.0020180908,-0.17857751,-0.10404493,0.08679237,0.086280316,0.032354243,-0.01784771,0.2593736,-0.0036574006,-0.16675994,0.037579086,0.15128757,0.34419033,0.11330315,0.08826357,0.049978476,-0.046152607,0.09527369,-0.21004893,0.12786327,0.09422337,0.13998254,0.03978485,0.1539198,-0.14071356,0.068732984,0.13013504,-0.15146957,0.10177104,0.13483137,-0.0021634959,-0.026205096,-0.051145542,0.29828796,0.029816985,-0.09094296,-0.06733278,0.07576341,-0.16140805,-0.066343516,0.040670164,-0.08095135,-0.080176175,-0.3277058,0.03201071,0.4752857,0.16853729,-0.21687293,0.031026715,-0.023459407,-0.022738114,0.1407501,-0.0039718593,-0.15976527,0.025394974,-0.12742606,0.024548305,0.267663,0.055650204,-0.008403853,0.17870802,0.081006125,-0.07175827,0.031511154,-0.0035031477,-0.1364213,-0.0981827,-0.08391782,0.018185759,0.06285347,-0.049287297,-0.0040096575,0.13116252,-0.25847614,0.054510392,-0.05419027,-0.07072955,-0.03786667,0.099874556,-0.11167731,-0.10775122,0.12828125,-0.21265402,0.102431074,0.16486745,-0.016631698,0.107368715,0.07204212,0.024553021,-0.00059206225,0.11753347,-0.081782736,-0.13801925,0.06623803,-0.084376045,0.16231427,0.072412744]	f	4	f	\N	f	\N	\N
107	Twilio	Again	2026-09-28	https://res.cloudinary.com/moqaqhrc/image/upload/v1791387461/customers/fpglrzeedxsvtemz7jlp.png	3466682029	\N	2026-10-07 10:37:41.847697	t	1	[-0.15222289,0.0927463,0.04271672,-0.06021686,-0.16998513,-0.067732625,-0.032328516,-0.084202155,0.117399186,-0.076239854,0.18741986,-0.034144126,-0.1806902,0.050372895,-0.09870574,0.09419669,-0.093827024,-0.16133894,-0.18310958,-0.10917486,0.0134278415,0.062510215,0.0071952087,0.053781725,-0.17349084,-0.27809173,-0.06752441,-0.09568254,0.085035704,-0.055676702,-0.04886195,-0.021476645,-0.16980085,-0.07205172,0.06492108,0.07977243,0.02046855,-0.037557125,0.2766435,0.007343947,-0.14649183,0.035704948,0.15564072,0.3337861,0.11197106,0.08152841,0.054600753,-0.026277501,0.10627831,-0.23817582,0.11966926,0.10900974,0.14893587,0.046373785,0.14412446,-0.14838229,0.06657736,0.15122297,-0.12675805,0.13655749,0.11609778,-0.029007506,-0.058157187,-0.06671774,0.30106896,0.06135506,-0.099504665,-0.072270215,0.09259261,-0.17010896,-0.053173084,0.041146923,-0.084905505,-0.07504981,-0.2968778,0.04960117,0.48073205,0.17331491,-0.2025958,0.03034408,-0.025972886,-0.011373845,0.12558886,-0.020024259,-0.18778145,0.013248811,-0.1426169,0.033736866,0.27248213,0.033964567,0.011329855,0.17475918,0.08922501,-0.02826327,0.038355127,0.014204722,-0.15876013,-0.11176347,-0.064019956,0.050169393,0.07679721,-0.08467295,0.0033303387,0.09842898,-0.23156816,0.04368578,-0.06939269,-0.079259485,-0.046882376,0.088405155,-0.122982234,-0.09596428,0.13975382,-0.2161149,0.10162386,0.1748945,-0.015342383,0.10775622,0.09448966,0.026240155,-0.000666433,0.12231296,-0.08003165,-0.13854787,0.058898985,-0.097964786,0.12676778,0.07313919]	f	4	f	\N	t	2026-10-07 10:38:26.76231	OTP
30	Abraham	Martinez	2000-06-20	https://i.pravatar.cc/300?img=30	2221000030	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	t	f	\N	\N
53	Omar	Avila	2000-06-20	https://i.pravatar.cc/300?img=13	2221000053	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
54	Jose	Lopez	2000-06-20	https://i.pravatar.cc/300?img=14	2221000054	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
55	Janis	Ball	2000-06-20	https://i.pravatar.cc/300?img=15	2221000055	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
56	Sheddrick	Everett	2000-06-20	https://i.pravatar.cc/300?img=16	2221000056	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
105	Test3	Test 3	2026-09-29	https://res.cloudinary.com/moqaqhrc/image/upload/v1791386286/customers/z6wn9biknqewoudxrd1b.png	3466682029	\N	2026-10-07 10:18:06.484587	f	1	[-0.15638007,0.10213949,0.030055631,-0.054735105,-0.17265692,-0.056384746,-0.029158471,-0.09951604,0.13786337,-0.045642108,0.17385828,-0.008152209,-0.18300207,0.030303147,-0.07995202,0.0731795,-0.11410093,-0.15794304,-0.19174346,-0.11754902,0.027975958,0.06219051,0.018062169,0.057521116,-0.19350955,-0.2836003,-0.067865625,-0.10448581,0.09173513,-0.069062136,-0.044890016,-0.025752354,-0.17724797,-0.09080005,0.06262168,0.08189103,0.009268126,-0.043077953,0.25288594,-0.011758365,-0.14204411,0.03509868,0.14595684,0.32244417,0.13401656,0.090217814,0.061437562,-0.049277928,0.10379648,-0.23240682,0.13391073,0.123969525,0.10592217,0.03923598,0.16095835,-0.14909269,0.03791214,0.1607741,-0.128304,0.14225465,0.12342641,-0.028337095,-0.048100382,-0.08298137,0.2990675,0.06730443,-0.101851486,-0.07701146,0.085467145,-0.1837025,-0.06185112,0.036464874,-0.074908346,-0.09057096,-0.31251496,0.05022575,0.49442816,0.18216306,-0.21181601,0.03018418,-0.05629385,-0.011009732,0.14342268,-0.019223962,-0.17998497,0.021140132,-0.15372151,0.024725407,0.28253156,0.0502304,0.007782378,0.19881524,0.09329185,-0.043695875,0.057710044,0.015517236,-0.17623052,-0.12076745,-0.086239494,0.025900055,0.06689052,-0.0770604,0.008668929,0.100426845,-0.20025164,0.041503575,-0.053526144,-0.07017794,-0.052778907,0.05935917,-0.14450406,-0.11270602,0.15295312,-0.23065354,0.10525507,0.1585648,0.00019231765,0.12509306,0.09733838,0.04428579,-0.01225733,0.1174965,-0.06379632,-0.11147855,0.06653268,-0.08647524,0.13698915,0.07139106]	f	4	f	\N	f	\N	\N
1	Jose	Ramirez	2000-06-20	https://i.pravatar.cc/300?img=1	2221000001	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
2	Roxanne	Alvarado	2000-06-20	https://i.pravatar.cc/300?img=2	2221000002	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
3	David	Alvarado	2000-06-20	https://i.pravatar.cc/300?img=3	2221000003	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
4	Rita	Ramos	2000-06-20	https://i.pravatar.cc/300?img=4	2221000004	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
5	Gregory	Randall	2000-06-20	https://i.pravatar.cc/300?img=5	2221000005	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
6	Luiz	Hernandez	2000-06-20	https://i.pravatar.cc/300?img=6	2221000006	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
7	Margarita	Hernandez	2000-06-20	https://i.pravatar.cc/300?img=7	2221000007	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
8	Maria	Garza	2000-06-20	https://i.pravatar.cc/300?img=8	2221000008	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
9	Beatrice	Jaure	2000-06-20	https://i.pravatar.cc/300?img=9	2221000009	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
10	Lucille	Gentry	2000-06-20	https://i.pravatar.cc/300?img=10	2221000010	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
11	Justo	Garcia	2000-06-20	https://i.pravatar.cc/300?img=11	2221000011	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
12	Jesse	Barron	2000-06-20	https://i.pravatar.cc/300?img=12	2221000012	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
13	Rogelio	Rodriguez	2000-06-20	https://i.pravatar.cc/300?img=13	2221000013	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
14	Dolores	Flores	2000-06-20	https://i.pravatar.cc/300?img=14	2221000014	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
15	Luis	Navarro	2000-06-20	https://i.pravatar.cc/300?img=15	2221000015	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
16	Jennifer	Cormier	2000-06-20	https://i.pravatar.cc/300?img=16	2221000016	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
17	Erica	Medina	2000-06-20	https://i.pravatar.cc/300?img=17	2221000017	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
18	Rosario	Martinez	2000-06-20	https://i.pravatar.cc/300?img=18	2221000018	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
19	Sandra	Godoy	2000-06-20	https://i.pravatar.cc/300?img=19	2221000019	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
20	Josie	Rodriguez	2000-06-20	https://i.pravatar.cc/300?img=20	2221000020	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
21	Olga	Gonzalez	2000-06-20	https://i.pravatar.cc/300?img=21	2221000021	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
22	Priscilla	Alvarado	2000-06-20	https://i.pravatar.cc/300?img=22	2221000022	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
23	Brenda	Solis	2000-06-20	https://i.pravatar.cc/300?img=23	2221000023	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
24	Maria	Pina	2000-06-20	https://i.pravatar.cc/300?img=24	2221000024	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
25	Mary	Marrugo	2000-06-20	https://i.pravatar.cc/300?img=25	2221000025	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
26	Donald	Booker	2000-06-20	https://i.pravatar.cc/300?img=26	2221000026	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
27	Beatrice	James	2000-06-20	https://i.pravatar.cc/300?img=27	2221000027	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
28	Esmeralda	Anguiano	2000-06-20	https://i.pravatar.cc/300?img=28	2221000028	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
29	Josue	Sandoval	2000-06-20	https://i.pravatar.cc/300?img=29	2221000029	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
31	Jasten	Najera	2000-06-20	https://i.pravatar.cc/300?img=31	2221000031	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
32	Miguel	Medrano	2000-06-20	https://i.pravatar.cc/300?img=32	2221000032	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
33	Christopher	Jackson	2000-06-20	https://i.pravatar.cc/300?img=33	2221000033	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
34	Eric	Lopez	2000-06-20	https://i.pravatar.cc/300?img=34	2221000034	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
35	Carolina	Rubio	2000-06-20	https://i.pravatar.cc/300?img=35	2221000035	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
36	Junior	Montejano	2000-06-20	https://i.pravatar.cc/300?img=36	2221000036	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
37	Ruiz	Lozada	2000-06-20	https://i.pravatar.cc/300?img=37	2221000037	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
38	Anna	Cruz	2000-06-20	https://i.pravatar.cc/300?img=38	2221000038	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
39	Esteban	Calvillo	2000-06-20	https://i.pravatar.cc/300?img=39	2221000039	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
40	Maria	Nieto	2000-06-20	https://i.pravatar.cc/300?img=40	2221000040	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
41	Consuela	Ramirez	2000-06-20	https://i.pravatar.cc/300?img=41	2221000041	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
42	Ana	Rocha	2000-06-20	https://i.pravatar.cc/300?img=42	2221000042	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
43	Jorge	Contreras	2000-06-20	https://i.pravatar.cc/300?img=43	2221000043	40	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	t	f	\N	\N
44	Luis	Garcia	2000-06-20	https://i.pravatar.cc/300?img=44	2221000044	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
45	Enfa	Gonzalez	2000-06-20	https://i.pravatar.cc/300?img=45	2221000045	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
46	Francis	Brown	2000-06-20	https://i.pravatar.cc/300?img=46	2221000046	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
47	Thomas	Miles	2000-06-20	https://i.pravatar.cc/300?img=47	2221000047	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
48	Toribio	Torres	2000-06-20	https://i.pravatar.cc/300?img=48	2221000048	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
49	Maria	Murillo	2000-06-20	https://i.pravatar.cc/300?img=49	2221000049	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
50	Joaquin	Hernandez	2000-06-20	https://i.pravatar.cc/300?img=50	2221000050	20	2026-09-22 08:35:04.539523	t	1	\N	f	2	f	f	f	\N	\N
51	Felesha	Braxton	2000-06-20	https://i.pravatar.cc/300?img=11	2221000051	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
52	Reyna	Dominguez	2000-06-20	https://i.pravatar.cc/300?img=12	2221000052	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
57	Yandro	Menendez	2000-06-20	https://i.pravatar.cc/300?img=17	2221000057	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
58	Terranye	Overshown	2000-06-20	https://i.pravatar.cc/300?img=18	2221000058	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
59	Ty	Hatch	2000-06-20	https://i.pravatar.cc/300?img=19	2221000059	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
60	Marshana	Prudhome	2000-06-20	https://i.pravatar.cc/300?img=20	2221000060	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
61	Lynette	Clark	2000-06-20	https://i.pravatar.cc/300?img=21	2221000061	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
62	William	Wesley	2000-06-20	https://i.pravatar.cc/300?img=22	2221000062	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
63	Ariana	Ebony	2000-06-20	https://i.pravatar.cc/300?img=23	2221000063	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
64	Katrina	Ware	2000-06-20	https://i.pravatar.cc/300?img=24	2221000064	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
65	Mario	Garcia	2000-06-20	https://i.pravatar.cc/300?img=25	2221000065	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
66	Cynthia	Joiner	2000-06-20	https://i.pravatar.cc/300?img=26	2221000066	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
67	Christian	Lainez	2000-06-20	https://i.pravatar.cc/300?img=27	2221000067	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
68	Gloria	Lainez	2000-06-20	https://i.pravatar.cc/300?img=28	2221000068	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
69	Sheila	Curl	2000-06-20	https://i.pravatar.cc/300?img=29	2221000069	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
70	Ignacio	Alfaro	2000-06-20	https://i.pravatar.cc/300?img=30	2221000070	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
71	Iliana	Vazquez	2000-06-20	https://i.pravatar.cc/300?img=31	2221000071	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
72	Cynthia	Thomas	2000-06-20	https://i.pravatar.cc/300?img=32	2221000072	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
73	Julio	Rodriguez	2000-06-20	https://i.pravatar.cc/300?img=33	2221000073	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
74	Veronica	Ramoz	2000-06-20	https://i.pravatar.cc/300?img=34	2221000074	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
75	Rankeisha	Harris	2000-06-20	https://i.pravatar.cc/300?img=35	2221000075	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
76	Nikisha	Thomson	2000-06-20	https://i.pravatar.cc/300?img=36	2221000076	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
77	Lamark	Brown	2000-06-20	https://i.pravatar.cc/300?img=37	2221000077	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
78	Johnny	Padilla	2000-06-20	https://i.pravatar.cc/300?img=38	2221000078	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
79	Ruth	Lewis	2000-06-20	https://i.pravatar.cc/300?img=39	2221000079	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
80	Cathy	Bradley	2000-06-20	https://i.pravatar.cc/300?img=40	2221000080	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
81	Lovie	Sue	2000-06-20	https://i.pravatar.cc/300?img=41	2221000081	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
82	Monica	Huerta	2000-06-20	https://i.pravatar.cc/300?img=42	2221000082	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
83	Nancy	Moreno	2000-06-20	https://i.pravatar.cc/300?img=43	2221000083	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
84	Yasser	Amador	2000-06-20	https://i.pravatar.cc/300?img=44	2221000084	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
85	Shirley	Broussard	2000-06-20	https://i.pravatar.cc/300?img=45	2221000085	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
86	Ashiley	Parris	2000-06-20	https://i.pravatar.cc/300?img=46	2221000086	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
87	Leticia	Montemayor	2000-06-20	https://i.pravatar.cc/300?img=47	2221000087	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
88	Terry	Lee	2000-06-20	https://i.pravatar.cc/300?img=48	2221000088	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
89	Bernice	Francis	2000-06-20	https://i.pravatar.cc/300?img=49	2221000089	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
90	Jorge	Lopez	2000-06-20	https://i.pravatar.cc/300?img=50	2221000090	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
91	Micheal	Steen	2000-06-20	https://i.pravatar.cc/300?img=51	2221000091	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
92	Jojo	Jojo	2000-06-20	https://i.pravatar.cc/300?img=52	2221000092	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
93	Gigi	Gigi	2000-06-20	https://i.pravatar.cc/300?img=53	2221000093	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
94	Gerardo	Nevarez	2000-06-20	https://i.pravatar.cc/300?img=54	2221000094	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
95	Abby	Lopez	2000-06-20	https://i.pravatar.cc/300?img=55	2221000095	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
96	Salima	Lakhani	2000-06-20	https://i.pravatar.cc/300?img=56	2221000096	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
97	Gerson	Acuna	2000-06-20	https://i.pravatar.cc/300?img=57	2221000097	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
98	Elmer	Lopez	2000-06-20	https://i.pravatar.cc/300?img=58	2221000098	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
99	Judy	Jones	2000-06-20	https://i.pravatar.cc/300?img=59	2221000099	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
100	Caroline	Hubbard	2000-06-20	https://i.pravatar.cc/300?img=60	2221000100	20	2026-09-22 08:36:49.856213	t	2	\N	f	2	f	f	f	\N	\N
101	sam	John	2021-09-21	https://res.cloudinary.com/moqaqhrc/image/upload/v1790728628/customers/nebwocwdatmvnflpc2dm.png	2221000101	\N	2026-09-29 19:37:10.249443	t	1	[-0.13687523,0.13536564,0.07151454,0.0061293915,-0.088095374,-0.050832443,-0.06654395,-0.116624914,0.11153496,-0.07336347,0.18531744,0.019964408,-0.18043803,0.0006935105,-0.086913384,0.09770406,-0.060756776,-0.19743451,-0.10407918,-0.09720015,-0.010817252,0.04266395,0.027596474,0.059401967,-0.14592347,-0.27562112,-0.09190616,-0.12408721,0.06325904,-0.062513754,-0.11321119,-0.10393135,-0.18111496,-0.041558824,0.054532878,0.083579525,0.012708214,-0.024979489,0.22087596,-0.0092370175,-0.10041283,0.021296013,0.106438436,0.34207848,0.14316492,0.0627702,0.03656676,-0.013998866,0.056061927,-0.19437209,0.13925722,0.09945514,0.16388522,0.07043711,0.11719011,-0.12766083,0.048334524,0.10554775,-0.14482504,0.12889116,0.10397856,-0.010064624,-0.034338623,-0.021648873,0.35808858,0.14513242,-0.11067829,-0.08690053,0.10333465,-0.21820885,-0.043782197,-0.034563094,-0.08247972,-0.07525062,-0.2621321,0.056049384,0.456338,0.20535313,-0.22023746,0.073581025,-0.03140295,0.00894696,0.13152765,0.01049871,-0.17524606,0.072993904,-0.12877513,0.03379265,0.2420269,0.055811793,-0.020604748,0.14680818,0.019919002,0.011968122,0.093728475,-0.01969285,-0.11186235,-0.091248885,-0.08399037,0.05409118,-0.033305503,-0.060076706,0.03585266,0.09529746,-0.14800768,0.040558696,-0.0358333,-0.037055682,-0.04861132,0.15342799,-0.13583194,-0.1293564,0.103819,-0.23229437,0.18166307,0.11662081,-0.014474712,0.104588956,0.06626428,0.07161012,0.013474243,0.10405935,-0.06303109,-0.09793093,0.029841606,-0.1117421,0.17382227,0.090701014]	f	6	f	\N	f	\N	\N
102	Twilio	Test	2026-08-03	https://res.cloudinary.com/moqaqhrc/image/upload/v1791384345/customers/x5nqrqr29ujhw39vnrxf.png	2221000102	\N	2026-10-07 09:45:46.229564	f	1	[-0.12499793,0.0936825,0.071714774,-0.017264519,-0.12414228,-0.09060774,-0.04347028,-0.123860866,0.14799026,-0.048138857,0.2079105,-0.03318363,-0.17105497,0.021204889,-0.06315117,0.08466476,-0.0910352,-0.16466954,-0.16155545,-0.09930503,-0.00876867,0.054622028,0.029811483,0.038674682,-0.18920676,-0.2870887,-0.08609053,-0.119683824,0.06866065,-0.04526967,-0.03684906,-0.019216623,-0.19894205,-0.11399597,0.089477345,0.074663945,0.034925368,-0.04006026,0.26036292,-0.013923103,-0.14759287,0.027007211,0.13860236,0.31037515,0.0765764,0.04061692,0.050456285,-0.048842724,0.07792184,-0.20203777,0.11803675,0.11020517,0.13610728,0.033983354,0.16603012,-0.14281219,0.07144129,0.13214973,-0.16908571,0.113217555,0.116343975,-0.011280891,-0.055574507,-0.048861902,0.2544127,0.0712264,-0.0645905,-0.08391489,0.07743776,-0.14763145,-0.01751151,0.05548595,-0.08922521,-0.1055601,-0.33521828,0.03218637,0.49964792,0.14272335,-0.21945484,0.056924455,-0.027477097,-0.029562138,0.104092255,-0.025365263,-0.15989475,0.07244529,-0.1282702,0.06427859,0.2301103,0.040383007,0.005999402,0.15244809,0.05053675,-0.044597916,0.069004215,0.012020766,-0.14340907,-0.12350054,-0.10078221,0.033081822,0.054652438,-0.045651473,0.0066434303,0.08892455,-0.2316542,0.01873239,-0.025254581,-0.13138294,-0.06659312,0.087496206,-0.1007544,-0.10528413,0.14235628,-0.24332337,0.10231096,0.14688832,-0.036960278,0.12459324,0.03293877,0.016400393,-0.029640684,0.11242107,-0.051703814,-0.12747438,0.025796957,-0.07243352,0.12702177,0.057317235]	f	4	f	\N	f	\N	\N
\.


--
-- Data for Name: CustomerLog; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."CustomerLog" ("ID", "CustomerID", "UserID", "LogType", "OldValue", "NewValue", "Description", "DateCreated") FROM stdin;
1	30	4	PRIVILEGED_MATCH_RULE	false	true	User 4 enabled Privileged Match Rule	2026-10-07 12:10:46.585759
\.


--
-- Data for Name: CustomerMatch; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."CustomerMatch" ("ID", "CustomerId", "MachineId", "Points", "DateAssign", "ImageUrl", "AssignedBy", "LocationId", "CheckinId", "ReviewStatus", "ReviewedBy", "ReviewedAt", "EmployeeSessionId", "IsExtraMatch") FROM stdin;
1	1	1	20	2026-10-03 10:47:36.359394	https://res.cloudinary.com/moqaqhrc/image/upload/v1791042457/customers/fvo3qqgf9zx1nvva9jhj.png	6	1	1	Pending	\N	\N	1	f
2	2	2	20	2026-10-03 10:47:56.838188	https://res.cloudinary.com/moqaqhrc/image/upload/v1791042478/customers/nphaakvualtfpqdklybg.png	6	1	2	Pending	\N	\N	1	f
3	3	3	20	2026-10-03 10:48:09.288903	https://res.cloudinary.com/moqaqhrc/image/upload/v1791042490/customers/bekplhj4zunf5ea4u1ly.png	6	1	3	Pending	\N	\N	1	f
4	4	2	20	2026-10-03 11:10:50.975852	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043852/customers/ffgbafulve83s4mhfciq.png	12	1	4	Pending	\N	\N	2	f
5	5	5	20	2026-10-03 11:10:59.854385	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043861/customers/sz8s3adbknfz63vgjcea.png	12	1	5	Pending	\N	\N	2	f
6	6	4	20	2026-10-03 11:11:08.248053	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043869/customers/dlbnm1hg3jsidcvyy7cb.png	12	1	6	Pending	\N	\N	2	f
7	7	4	20	2026-10-03 11:11:51.536096	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043912/customers/gu6yxybigxhxlpkmnlss.png	12	1	7	Pending	\N	\N	2	f
8	5	\N	30	2026-10-03 11:12:37.501603	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043958/customers/nmlyyie9gh2deqvjgmvb.png	12	1	\N	Pending	\N	\N	2	t
9	30	1	20	2026-10-07 13:07:15.813695	https://res.cloudinary.com/moqaqhrc/image/upload/v1791396436/customers/u4baxu5mskgvwns0ad0r.png	6	1	8	Pending	\N	\N	3	f
\.


--
-- Data for Name: EmployeeSession; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."EmployeeSession" ("ID", "UserId", "LocationId", "ClockIn", "ClockOut", "TotalWorkingHours", "IsPaid", "CreatedAt", "ReadingSessionId") FROM stdin;
1	6	1	2026-10-03 09:29:36.260095-05	2026-10-03 11:08:02.928883-05	1.64	f	2026-10-03 09:29:36.260095-05	1
2	12	1	2026-10-03 11:07:24.522886-05	2026-10-03 11:18:54.665229-05	0.19	f	2026-10-03 11:07:24.522886-05	1
3	6	1	2026-10-04 20:43:05.949581-05	\N	0.00	f	2026-10-04 20:43:05.949581-05	\N
\.


--
-- Data for Name: ExpenseTypes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."ExpenseTypes" ("ID", "LocationId", "Name", "IsActive", "CreatedBy", "CreatedAt", "IsGeneral") FROM stdin;
1	1	Food	t	2	2026-09-23 23:24:50.945444-05	t
2	1	Sams	t	2	2026-09-23 23:25:34.147409-05	t
3	1	Office	t	2	2026-09-23 23:25:57.998784-05	t
4	1	Janitorial Stuff	t	2	2026-09-23 23:26:22.548844-05	t
5	1	Cleaning	t	2	2026-09-23 23:26:27.922308-05	t
6	2	Food	t	2	2026-09-24 09:39:57.072074-05	t
7	2	Cleaning	t	2	2026-09-24 09:40:02.76164-05	t
8	1	Employee Payroll	t	4	2026-09-28 12:49:30.801414-05	t
9	1	Security Payroll	t	4	2026-09-28 12:49:52.160906-05	t
11	1	Fix Match	t	4	2026-09-28 12:54:31.152653-05	t
12	1	Raffle Payout	t	4	2026-09-29 12:20:47.602077-05	f
13	1	Ticket Out	t	2	2026-09-23 23:24:50.945444-05	f
10	1	Extra Match / Lucky	t	4	2026-09-28 12:50:31.588219-05	f
\.


--
-- Data for Name: Games; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Games" ("ID", "GameName", "MachineTypeId", "IsActive", "CompanyId", "DateCreated", "DateUpdated") FROM stdin;
1	Dancing Drums	8	t	1	2026-09-23 19:38:43.591605	\N
2	Tetris Super Jackpot	8	t	1	2026-09-23 19:39:00.72859	\N
3	Treasure Fruits	8	t	1	2026-09-23 19:39:24.386618	\N
4	Cash Spin	10	t	1	2026-09-23 19:40:07.090298	\N
5	Celestial King	10	t	1	2026-09-23 19:40:52.988146	\N
6	Dragon	12	t	1	2026-10-03 12:00:53.560715	\N
7	Multi Games	7	t	1	2026-10-03 12:02:32.880242	\N
\.


--
-- Data for Name: LocationCashAccounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LocationCashAccounts" ("ID", "LocationId", "Kind", "UserId", "CreatedAt") FROM stdin;
1	1	ADMIN	4	2026-10-03 11:18:54.665229-05
\.


--
-- Data for Name: LocationCashCapital; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LocationCashCapital" ("ID", "LocationId", "ToAccountId", "Amount", "Status", "Notes", "CreatedBy", "CreatedAt", "AcceptedBy", "AcceptedAt", "CancelledBy", "CancelledAt") FROM stdin;
\.


--
-- Data for Name: LocationCashEntries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LocationCashEntries" ("ID", "LocationId", "AccountId", "Amount", "Kind", "TransferId", "MovementKey", "CapitalId", "ReadingProfitPostingId", "FundingId", "ExpenseTypeId", "SessionTransactionId", "Notes", "CreatedBy", "CreatedAt") FROM stdin;
1	1	1	15145.00	EMPLOYEE_CASH_TAKEN	\N	\N	\N	\N	\N	\N	\N	Shift close cash from employee session #2	12	2026-10-03 11:18:54.665229-05
5	1	1	2930.00	MACHINE_COLLECTION	\N	\N	\N	5	\N	\N	\N	Physical machine collection · Reading session #1 · Remaining 2846.00 + Daily OUT 84.00	4	2026-10-04 08:35:49.793625-05
6	1	1	-50.00	DIRECT_EXPENSE	\N	\N	\N	\N	\N	3	\N	Reading Session #1 · Office · office stuff	4	2026-10-05 17:10:29.326842-05
7	1	1	-70.00	DIRECT_EXPENSE	\N	\N	\N	\N	\N	9	\N	Reading Session #1 · Security Payroll	4	2026-10-05 17:10:52.268922-05
8	1	1	-15000.00	EMPLOYEE_SUPPORT	\N	\N	\N	\N	1	\N	\N	Cash delivered to employee session #3	6	2026-10-07 13:02:58.342637-05
\.


--
-- Data for Name: LocationCashTransfers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LocationCashTransfers" ("ID", "LocationId", "FromAccountId", "ToAccountId", "Amount", "Kind", "Status", "Notes", "CreatedBy", "CreatedAt", "AcceptedBy", "AcceptedAt", "CancelledBy", "CancelledAt") FROM stdin;
\.


--
-- Data for Name: LocationRuleSettings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LocationRuleSettings" ("ID", "LocationId", "MatchRuleEnabled", "MatchRuleName", "MatchCooldownHours", "MatchMaxPerDay", "MatchResetTimes", "MatchResetDayTime", "NfcTicketOutEnabled", "AuditVerificationEnabled", "PhoneVerificationRequired", "NuVueBoostEnabled", "TicketPhotoRequired", "TicketPhotoMinAmount", "VipMatchEnabled", "VipMatchMinPoints", "CreatedAt", "UpdatedAt", "UpdatedBy") FROM stdin;
1	1	t	MATCH	2	2	["06:00", "18:00"]	06:00:00	f	f	f	f	f	10.00	f	10	2026-10-03 10:17:22.991248-05	2026-10-04 11:23:44.194131-05	4
\.


--
-- Data for Name: Locations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Locations" ("ID", name, "IsActive", "CompanyId", "AllowFaceCheckin") FROM stdin;
2	VENUS (017)	t	1	f
3	Lucky Star	t	1	f
4	Money Ball	t	2	t
1	99 RICHEST (021)	t	1	f
\.


--
-- Data for Name: LuckyBird; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LuckyBird" ("ID", "Name", "IsActive", "LocationId", "DateCreated", "DateUpdated") FROM stdin;
\.


--
-- Data for Name: LuckyBirdAwards; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LuckyBirdAwards" ("ID", "LocationId", "EmployeeSessionId", "EmployeeId", "LuckyBirdId", "LuckyBirdPayoutId", "LuckyBirdName", "PayoutDescription", "MachineId", "CustomerId", "Amount", "ImageUrl", "CreatedBy", "CreatedAt") FROM stdin;
1	1	3	6	\N	\N	Lucky Bird	$10 Denomination	1	30	10.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791397127/luckybird-awards/mepv1oy2n3eyfb1eyotm.png	6	2026-10-07 13:18:46.468051-05
\.


--
-- Data for Name: LuckyBirdPayout; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LuckyBirdPayout" ("ID", "LuckyBirdId", "Description", "Amount", "SortOrder") FROM stdin;
\.


--
-- Data for Name: LuckyBirdScheduleBlock; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LuckyBirdScheduleBlock" ("ID", "LuckyBirdId", "IsAllDay", "StartTime", "EndTime", "EndDayOffset", "SortOrder") FROM stdin;
\.


--
-- Data for Name: LuckyBirdScheduleDay; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."LuckyBirdScheduleDay" ("ID", "ScheduleBlockId", "DayOfWeek") FROM stdin;
\.


--
-- Data for Name: MachineLogs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."MachineLogs" ("ID", "MachineId", "ActionType", "FieldName", "OldValue", "NewValue", "Reason", "ChangedBy", "DateCreated") FROM stdin;
1	1	Machine Created	MachineNumber	\N	1	\N	4	2026-10-03 10:31:26.929204
2	1	Machine Type Assigned	MachineTypeId	\N	8	\N	4	2026-10-03 10:31:26.929204
3	2	Machine Created	MachineNumber	\N	2	\N	4	2026-10-03 10:31:26.929204
4	2	Machine Type Assigned	MachineTypeId	\N	8	\N	4	2026-10-03 10:31:26.929204
5	3	Machine Created	MachineNumber	\N	3	\N	4	2026-10-03 10:31:26.929204
6	3	Machine Type Assigned	MachineTypeId	\N	8	\N	4	2026-10-03 10:31:26.929204
7	4	Machine Created	MachineNumber	\N	4	\N	4	2026-10-03 10:31:26.929204
8	4	Machine Type Assigned	MachineTypeId	\N	8	\N	4	2026-10-03 10:31:26.929204
9	5	Machine Created	MachineNumber	\N	5	\N	4	2026-10-03 10:31:26.929204
10	5	Machine Type Assigned	MachineTypeId	\N	8	\N	4	2026-10-03 10:31:26.929204
11	1	Machine Type Changed	MachineTypeId	8	12	\N	4	2026-10-03 10:31:42.110974
12	2	Machine Type Changed	MachineTypeId	8	7	\N	4	2026-10-03 10:31:47.691903
13	3	Machine Type Changed	MachineTypeId	8	10	\N	4	2026-10-03 10:31:56.988137
14	1	Game Changed	GameId	\N	6	\N	4	2026-10-03 12:02:14.818818
15	3	Game Changed	GameId	\N	4	\N	4	2026-10-03 12:03:25.144866
16	4	Game Changed	GameId	\N	1	\N	4	2026-10-03 12:03:30.393723
17	5	Game Changed	GameId	\N	3	\N	4	2026-10-03 12:03:34.514775
18	2	Game Changed	GameId	\N	7	\N	4	2026-10-03 12:03:40.882777
\.


--
-- Data for Name: MachineReadings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."MachineReadings" ("ID", "SessionId", "MachineId", "ReadingType", "CurrentIn", "CurrentOut", "ReadingAt", "PreviousIn", "PreviousOut") FROM stdin;
1	\N	1	INITIAL	100	100	2026-10-03 12:38:57.760699-05	100	100
2	\N	2	INITIAL	100	100	2026-10-03 12:39:05.841208-05	100	100
3	\N	3	INITIAL	100	100	2026-10-03 12:39:10.749068-05	100	100
4	\N	4	INITIAL	100	100	2026-10-03 12:39:20.36054-05	100	100
5	\N	5	INITIAL	100	100	2026-10-03 12:39:26.596192-05	100	100
7	1	1	Manual	500	110	2026-10-03 13:14:20.425431-05	100	100
8	1	2	Manual	650	125	2026-10-03 13:17:05.037024-05	100	100
9	1	3	Manual	730	128	2026-10-03 13:17:17.175214-05	100	100
10	1	4	Manual	850	100	2026-10-03 13:17:32.818986-05	100	100
11	1	5	Manual	1200	121	2026-10-03 13:17:53.883676-05	100	100
\.


--
-- Data for Name: MachineStatus; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."MachineStatus" ("ID", "Description") FROM stdin;
1	Active
2	InActive
3	Not Working
4	Broke
5	Working
\.


--
-- Data for Name: MachineStatusLog; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."MachineStatusLog" ("ID", "MachineId", "MachineStatusId", "Reason", "ChangeBy") FROM stdin;
\.


--
-- Data for Name: MachineTypes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."MachineTypes" ("ID", "TypeName", "CompanyId", "IsActive", "DateCreated", "DateUpdated") FROM stdin;
1	J-43	\N	t	2026-09-20 23:02:56.890385	\N
2	test	\N	t	2026-09-20 23:02:56.890385	\N
3	sdfsdfa	\N	t	2026-09-20 23:02:56.890385	\N
4	Firelink	\N	t	2026-09-20 23:02:56.890385	\N
5	Wave XL	\N	t	2026-09-20 23:02:56.890385	\N
6	IGT-Curve	\N	t	2026-09-20 23:02:56.890385	\N
7	IGT Dual	1	t	2026-09-20 23:55:00.311964	\N
8	J-43	1	t	2026-09-20 23:55:11.73761	\N
9	Wave XL	1	t	2026-09-20 23:55:21.570727	\N
10	Twinstar	1	t	2026-09-20 23:55:30.752262	\N
11	IGT Crystal Curve	1	t	2026-09-23 19:33:30.278453	\N
12	Aristocrat	1	t	2026-09-23 19:34:27.195738	\N
13	Firelink - Chinese	1	t	2026-09-23 19:34:47.778455	\N
14	Firelink - Original	1	t	2026-09-23 19:35:05.81704	\N
15	Wood - LOL	1	t	2026-09-23 19:35:32.090025	\N
16	Wood - POG	1	t	2026-09-23 19:35:47.810156	\N
17	Wood - Tiny AIO	1	t	2026-09-23 19:36:00.401986	\N
18	Everi	1	t	2026-09-23 19:36:46.144476	\N
\.


--
-- Data for Name: Machines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Machines" ("ID", "MachineNumber", "MachineTypeId", "GameId", "StatusId", locationid, "StatusReason", "DateCreated", "DateUpdated", "UpdatedBy") FROM stdin;
1	1	12	6	5	1	\N	2026-10-03 10:31:26.929204	2026-10-03 12:02:14.818818	4
3	3	10	4	5	1	\N	2026-10-03 10:31:26.929204	2026-10-03 12:03:25.144866	4
4	4	8	1	5	1	\N	2026-10-03 10:31:26.929204	2026-10-03 12:03:30.393723	4
5	5	8	3	5	1	\N	2026-10-03 10:31:26.929204	2026-10-03 12:03:34.514775	4
2	2	7	7	5	1	\N	2026-10-03 10:31:26.929204	2026-10-03 12:03:40.882777	4
\.


--
-- Data for Name: Permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Permissions" ("ID", "Code", "Module", "Action", "Description") FROM stdin;
1	customers.read	Customers	read	View customers
2	customers.create	Customers	create	Create customers
3	customers.update	Customers	update	Update customers
4	customers.delete	Customers	delete	Delete customers
5	checkin.read	Check In	read	Access customer check in
6	ticketout.read	Ticket Out	read	Access ticket out
7	clock.read	Time Clock	read	Access employee time clock
8	pointwatching.read	Point Watching	read	View point watching
9	employeesession.read	Employee Session	read	View employee sessions
10	promotions.read	Promotions	read	View promotions
11	promotions.create	Promotions	create	Create promotions
12	promotions.update	Promotions	update	Update promotions
13	promotions.delete	Promotions	delete	Delete promotions
14	reading.read	Reading	read	View reading sessions
15	reading.create	Reading	create	Create reading sessions
16	reading.update	Reading	update	Update reading sessions
17	reading.delete	Reading	delete	Delete reading sessions
18	reports.read	Reports	read	View reports
19	users.read	Users	read	View users
20	users.create	Users	create	Create users
21	users.update	Users	update	Update users
22	users.delete	Users	delete	Delete users
23	roles.read	Roles & Permissions	read	View roles and permissions
24	roles.create	Roles & Permissions	create	Create roles
25	roles.update	Roles & Permissions	update	Update roles and permissions
26	roles.delete	Roles & Permissions	delete	Delete roles
27	machines.read	Machines	read	View machines
28	machines.create	Machines	create	Create machines
29	machines.update	Machines	update	Update machines
30	machines.delete	Machines	delete	Delete machines
31	machinetypes.read	Machine Types	read	View machine types
32	machinetypes.create	Machine Types	create	Create machine types
33	machinetypes.update	Machine Types	update	Update machine types
34	machinetypes.delete	Machine Types	delete	Delete machine types
35	games.read	Games	read	View games
36	games.create	Games	create	Create games
37	games.update	Games	update	Update games
38	games.delete	Games	delete	Delete games
39	bonus.read	Bonus Management	read	View bonuses
40	bonus.create	Bonus Management	create	Create bonuses
41	bonus.update	Bonus Management	update	Update bonuses
42	bonus.delete	Bonus Management	delete	Delete bonuses
43	dashboard.read	Dashboard	read	View dashboard
44	clock.update	Time Clock	update	Access employee time clock
47	employeesession.update	Employee Session	update	Update employee sessions
48	companies.read	Companies	read	View companies
49	companies.create	Companies	create	Create companies
50	companies.update	Companies	update	Update companies
51	companies.delete	Companies	delete	Delete companies
52	locations.read	Locations	read	View company locations
53	locations.create	Locations	create	Create company locations
54	locations.update	Locations	update	Update company locations
55	locations.delete	Locations	delete	Delete company locations
68	promotion.read	Promotion	read	View promotions
69	promotion.create	Promotion	create	Create promotions
70	promotion.update	Promotion	update	Update promotions
71	promotion.delete	Promotion	delete	Delete promotions
72	promotion.template.read	Promotion Template	read	View promotion templates
73	promotion.template.create	Promotion Template	create	Create promotion templates
74	promotion.template.update	Promotion Template	update	Update promotion templates
75	promotion.template.delete	Promotion Template	delete	Delete promotion templates
76	promotion.send	Promotion	send	Send promotions to customers
77	promotion.schedule	Promotion	schedule	Schedule promotions for later delivery
78	promotion.logs.read	Promotion Logs	read	View promotion delivery and audit logs
79	machinesetup.read	Machine Setup	read	View Machines
80	managerules.read	Manage Rules	read	View location rule settings
81	managerules.update	Manage Rules	update	Update location rule settings
82	checkin.update	Check In	update	Customer Check in
\.


--
-- Data for Name: PromotionAuditLogs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PromotionAuditLogs" ("ID", "CompanyId", "PromotionId", "TemplateId", "UserId", "Action", "EntityType", "EntityId", "Details", "CreatedAt") FROM stdin;
\.


--
-- Data for Name: PromotionDeliveryLogs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PromotionDeliveryLogs" ("ID", "PromotionId", "PromotionRecipientId", "CustomerId", "TwilioMessageSid", "Channel", "Status", "ErrorCode", "ErrorMessage", "RawPayload", "CreatedAt") FROM stdin;
\.


--
-- Data for Name: PromotionRecipients; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PromotionRecipients" ("ID", "PromotionId", "CustomerId", "CustomerName", "Phone", "Channel", "Status", "TwilioMessageSid", "TwilioStatus", "TwilioErrorCode", "TwilioErrorMessage", "QueuedAt", "SentAt", "DeliveredAt", "FailedAt", "UpdatedAt") FROM stdin;
\.


--
-- Data for Name: PromotionTemplates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."PromotionTemplates" ("ID", "CompanyId", "Name", "Description", "TemplateType", "DesignJson", "PreviewImageUrl", "FinalImageUrl", "Width", "Height", "IsSystemTemplate", "IsActive", "CreatedBy", "CreatedAt", "UpdatedBy", "UpdatedAt", "IsDeleted", "SourceTemplateId") FROM stdin;
1	0	Weekend Special	Bold weekend promotional poster with headline, offer and call-to-action.	System	{"objects": [{"top": 120, "fill": "#FACC15", "left": 140, "text": "WEEKEND", "type": "Textbox", "width": 800, "fontSize": 92, "textAlign": "center", "fontWeight": "700"}, {"top": 225, "fill": "#FFFFFF", "left": 140, "text": "SPECIAL", "type": "Textbox", "width": 800, "fontSize": 92, "textAlign": "center", "fontWeight": "700"}, {"top": 480, "fill": "#FACC15", "left": 190, "text": "EXCLUSIVE OFFER", "type": "Textbox", "width": 700, "fontSize": 38, "textAlign": "center", "fontWeight": "600"}, {"top": 580, "fill": "#FFFFFF", "left": 170, "text": "Add your promotion details here", "type": "Textbox", "width": 740, "fontSize": 54, "textAlign": "center", "fontWeight": "700"}, {"top": 1050, "fill": "#D1D5DB", "left": 210, "text": "AVAILABLE THIS WEEKEND ONLY", "type": "Textbox", "width": 660, "fontSize": 30, "textAlign": "center", "fontWeight": "600"}], "version": "6.0.0", "background": "#111827"}	\N	\N	1080	1350	t	t	1	2026-09-21 13:26:46.154826-05	\N	\N	f	\N
2	0	Customer Appreciation	Clean customer appreciation promotion suitable for rewards and thank-you offers.	System	{"objects": [{"top": 150, "fill": "#C2410C", "left": 140, "text": "THANK YOU!", "type": "Textbox", "width": 800, "fontSize": 88, "textAlign": "center", "fontWeight": "700"}, {"top": 295, "fill": "#9A3412", "left": 170, "text": "CUSTOMER APPRECIATION", "type": "Textbox", "width": 740, "fontSize": 40, "textAlign": "center", "fontWeight": "600"}, {"top": 520, "fill": "#1F2937", "left": 180, "text": "A SPECIAL REWARD FOR YOU", "type": "Textbox", "width": 720, "fontSize": 50, "textAlign": "center", "fontWeight": "700"}, {"top": 690, "fill": "#4B5563", "left": 220, "text": "Customize this area with your offer, reward or promotional message.", "type": "Textbox", "width": 640, "fontSize": 34, "textAlign": "center"}, {"top": 1080, "fill": "#C2410C", "left": 250, "text": "WE APPRECIATE YOUR BUSINESS", "type": "Textbox", "width": 580, "fontSize": 26, "textAlign": "center", "fontWeight": "600"}], "version": "6.0.0", "background": "#FFF7ED"}	\N	\N	1080	1350	t	t	1	2026-09-21 13:26:46.154826-05	\N	\N	f	\N
3	0	Referral Bonus	Bright referral promotion encouraging customers to invite friends.	System	{"objects": [{"top": 130, "fill": "#047857", "left": 130, "text": "REFER A FRIEND", "type": "Textbox", "width": 820, "fontSize": 76, "textAlign": "center", "fontWeight": "700"}, {"top": 260, "fill": "#065F46", "left": 150, "text": "AND GET REWARDED", "type": "Textbox", "width": 780, "fontSize": 54, "textAlign": "center", "fontWeight": "700"}, {"top": 540, "fill": "#059669", "left": 190, "text": "SPECIAL REFERRAL BONUS", "type": "Textbox", "width": 700, "fontSize": 42, "textAlign": "center", "fontWeight": "600"}, {"top": 665, "fill": "#374151", "left": 220, "text": "Replace this text with your referral reward details.", "type": "Textbox", "width": 640, "fontSize": 34, "textAlign": "center"}, {"top": 1080, "fill": "#047857", "left": 225, "text": "SHARE • REFER • ENJOY", "type": "Textbox", "width": 630, "fontSize": 30, "textAlign": "center", "fontWeight": "700"}], "version": "6.0.0", "background": "#ECFDF5"}	\N	\N	1080	1350	t	t	1	2026-09-21 13:26:46.154826-05	\N	\N	f	\N
4	0	Birthday Reward	Birthday-themed customer reward poster with editable celebration message.	System	{"objects": [{"top": 120, "fill": "#7C3AED", "left": 140, "text": "HAPPY", "type": "Textbox", "width": 800, "fontSize": 84, "textAlign": "center", "fontWeight": "700"}, {"top": 220, "fill": "#DB2777", "left": 140, "text": "BIRTHDAY!", "type": "Textbox", "width": 800, "fontSize": 94, "textAlign": "center", "fontWeight": "700"}, {"top": 520, "fill": "#6D28D9", "left": 190, "text": "A SPECIAL BIRTHDAY REWARD", "type": "Textbox", "width": 700, "fontSize": 44, "textAlign": "center", "fontWeight": "600"}, {"top": 670, "fill": "#4B5563", "left": 220, "text": "Customize this message with your birthday offer.", "type": "Textbox", "width": 640, "fontSize": 35, "textAlign": "center"}, {"top": 1080, "fill": "#DB2777", "left": 250, "text": "CELEBRATE WITH US", "type": "Textbox", "width": 580, "fontSize": 30, "textAlign": "center", "fontWeight": "700"}], "version": "6.0.0", "background": "#F5F3FF"}	\N	\N	1080	1350	t	t	1	2026-09-21 13:26:46.154826-05	\N	\N	f	\N
8	1	Weekend Special Copy	Bold weekend promotional poster with headline, offer and call-to-action.	System	{"objects": [{"top": 122, "fill": "#FACC15", "left": 394, "text": "WEEKEND", "type": "Textbox", "angle": 0, "flipX": false, "flipY": false, "skewX": 0, "skewY": 0, "width": 800, "height": 103.96, "scaleX": 1, "scaleY": 1, "shadow": null, "stroke": null, "styles": [], "opacity": 1, "originX": "center", "originY": "center", "version": "7.4.0", "visible": true, "fillRule": "nonzero", "fontSize": 92, "minWidth": 20, "overline": false, "pathSide": "left", "direction": "ltr", "fontStyle": "normal", "pathAlign": "baseline", "textAlign": "center", "underline": false, "fontFamily": "Times New Roman", "fontWeight": "700", "lineHeight": 1.16, "paintFirst": "fill", "charSpacing": 0, "linethrough": false, "strokeWidth": 1, "strokeLineCap": "butt", "strokeUniform": false, "strokeLineJoin": "miter", "backgroundColor": "", "pathStartOffset": 0, "splitByGrapheme": false, "strokeDashArray": null, "strokeDashOffset": 0, "strokeMiterLimit": 4, "textBackgroundColor": "", "textDecorationThickness": 66.667, "globalCompositeOperation": "source-over"}, {"top": 256, "fill": "#FFFFFF", "left": 442, "text": "SPECIAL", "type": "Textbox", "angle": 0, "flipX": false, "flipY": false, "skewX": 0, "skewY": 0, "width": 800, "height": 103.96, "scaleX": 1, "scaleY": 1, "shadow": null, "stroke": null, "styles": [], "opacity": 1, "originX": "center", "originY": "center", "version": "7.4.0", "visible": true, "fillRule": "nonzero", "fontSize": 92, "minWidth": 20, "overline": false, "pathSide": "left", "direction": "ltr", "fontStyle": "normal", "pathAlign": "baseline", "textAlign": "center", "underline": false, "fontFamily": "Times New Roman", "fontWeight": "700", "lineHeight": 1.16, "paintFirst": "fill", "charSpacing": 0, "linethrough": false, "strokeWidth": 1, "strokeLineCap": "butt", "strokeUniform": false, "strokeLineJoin": "miter", "backgroundColor": "", "pathStartOffset": 0, "splitByGrapheme": false, "strokeDashArray": null, "strokeDashOffset": 0, "strokeMiterLimit": 4, "textBackgroundColor": "", "textDecorationThickness": 66.667, "globalCompositeOperation": "source-over"}, {"top": 430, "fill": "#FACC15", "left": 473, "text": "EXCLUSIVE OFFER", "type": "Textbox", "angle": 0, "flipX": false, "flipY": false, "skewX": 0, "skewY": 0, "width": 700, "height": 42.94, "scaleX": 1, "scaleY": 1, "shadow": null, "stroke": null, "styles": [], "opacity": 1, "originX": "center", "originY": "center", "version": "7.4.0", "visible": true, "fillRule": "nonzero", "fontSize": 38, "minWidth": 20, "overline": false, "pathSide": "left", "direction": "ltr", "fontStyle": "normal", "pathAlign": "baseline", "textAlign": "center", "underline": false, "fontFamily": "Times New Roman", "fontWeight": "600", "lineHeight": 1.16, "paintFirst": "fill", "charSpacing": 0, "linethrough": false, "strokeWidth": 1, "strokeLineCap": "butt", "strokeUniform": false, "strokeLineJoin": "miter", "backgroundColor": "", "pathStartOffset": 0, "splitByGrapheme": false, "strokeDashArray": null, "strokeDashOffset": 0, "strokeMiterLimit": 4, "textBackgroundColor": "", "textDecorationThickness": 66.667, "globalCompositeOperation": "source-over"}, {"top": 547, "fill": "#FFFFFF", "left": 437, "text": "Add your promotion details here", "type": "Textbox", "angle": 0, "flipX": false, "flipY": false, "skewX": 0, "skewY": 0, "width": 740, "height": 131.8032, "scaleX": 1, "scaleY": 1, "shadow": null, "stroke": null, "styles": [], "opacity": 1, "originX": "center", "originY": "center", "version": "7.4.0", "visible": true, "fillRule": "nonzero", "fontSize": 54, "minWidth": 20, "overline": false, "pathSide": "left", "direction": "ltr", "fontStyle": "normal", "pathAlign": "baseline", "textAlign": "center", "underline": false, "fontFamily": "Times New Roman", "fontWeight": "700", "lineHeight": 1.16, "paintFirst": "fill", "charSpacing": 0, "linethrough": false, "strokeWidth": 1, "strokeLineCap": "butt", "strokeUniform": false, "strokeLineJoin": "miter", "backgroundColor": "", "pathStartOffset": 0, "splitByGrapheme": false, "strokeDashArray": null, "strokeDashOffset": 0, "strokeMiterLimit": 4, "textBackgroundColor": "", "textDecorationThickness": 66.667, "globalCompositeOperation": "source-over"}, {"top": 911, "fill": "#D1D5DB", "left": 445, "text": "AVAILABLE THIS WEEKEND ONLY", "type": "Textbox", "angle": 0, "flipX": false, "flipY": false, "skewX": 0, "skewY": 0, "width": 660, "height": 33.9, "scaleX": 1, "scaleY": 1, "shadow": null, "stroke": null, "styles": [], "opacity": 1, "originX": "center", "originY": "center", "version": "7.4.0", "visible": true, "fillRule": "nonzero", "fontSize": 30, "minWidth": 20, "overline": false, "pathSide": "left", "direction": "ltr", "fontStyle": "normal", "pathAlign": "baseline", "textAlign": "center", "underline": false, "fontFamily": "Times New Roman", "fontWeight": "600", "lineHeight": 1.16, "paintFirst": "fill", "charSpacing": 0, "linethrough": false, "strokeWidth": 1, "strokeLineCap": "butt", "strokeUniform": false, "strokeLineJoin": "miter", "backgroundColor": "", "pathStartOffset": 0, "splitByGrapheme": false, "strokeDashArray": null, "strokeDashOffset": 0, "strokeMiterLimit": 4, "textBackgroundColor": "", "textDecorationThickness": 66.667, "globalCompositeOperation": "source-over"}], "version": "7.4.0", "background": "#111827"}	\N	\N	1080	1350	f	t	2	2026-09-25 09:45:57.888473-05	4	2026-09-26 18:45:17.5257-05	f	1
9	1	Weekend Special Copy	Bold weekend promotional poster with headline, offer and call-to-action.	System	{"objects": [{"top": 120, "fill": "#FACC15", "left": 140, "text": "WEEKEND", "type": "Textbox", "width": 800, "fontSize": 92, "textAlign": "center", "fontWeight": "700"}, {"top": 225, "fill": "#FFFFFF", "left": 140, "text": "SPECIAL", "type": "Textbox", "width": 800, "fontSize": 92, "textAlign": "center", "fontWeight": "700"}, {"top": 480, "fill": "#FACC15", "left": 190, "text": "EXCLUSIVE OFFER", "type": "Textbox", "width": 700, "fontSize": 38, "textAlign": "center", "fontWeight": "600"}, {"top": 580, "fill": "#FFFFFF", "left": 170, "text": "Add your promotion details here", "type": "Textbox", "width": 740, "fontSize": 54, "textAlign": "center", "fontWeight": "700"}, {"top": 1050, "fill": "#D1D5DB", "left": 210, "text": "AVAILABLE THIS WEEKEND ONLY", "type": "Textbox", "width": 660, "fontSize": 30, "textAlign": "center", "fontWeight": "600"}], "version": "6.0.0", "background": "#111827"}	\N	\N	1080	1350	f	t	2	2026-09-28 21:55:27.198485-05	\N	\N	f	1
\.


--
-- Data for Name: Promotions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Promotions" ("ID", "CompanyId", "LocationId", "TemplateId", "Name", "MessageText", "Channel", "FinalImageUrl", "Status", "ScheduledAt", "StartedAt", "CompletedAt", "CreatedBy", "CreatedAt", "UpdatedBy", "UpdatedAt", "IsDeleted") FROM stdin;
\.


--
-- Data for Name: RaffleAttempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."RaffleAttempts" ("ID", "RaffleId", "AttemptNo", "MachineId", "CustomerId", "SpunAt") FROM stdin;
1	1	1	3	\N	2026-10-03 10:57:18.857522-05
2	2	1	4	\N	2026-10-03 11:03:34.960859-05
3	3	1	1	\N	2026-10-04 20:46:14.410226-05
\.


--
-- Data for Name: RaffleSettings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."RaffleSettings" ("ID", "LocationId", "ExcludedMachineIds", "AllowRepeatMachine", "SpinDurationSeconds", "UpdatedBy", "UpdatedAt") FROM stdin;
1	1	[]	f	5	4	2026-10-03 10:52:37.075559-05
\.


--
-- Data for Name: Raffles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Raffles" ("ID", "LocationId", "EmployeeSessionId", "EmployeeId", "Status", "WinningMachineId", "WinnerCustomerId", "WinningAmount", "WinnerImageUrl", "SessionTransactionId", "StartedAt", "CompletedAt", "CreatedBy", "ReviewStatus", "ReviewedBy", "ReviewedAt") FROM stdin;
1	1	1	6	NO_WINNER	\N	\N	\N	\N	\N	2026-10-03 10:57:18.857522-05	2026-10-03 11:03:34.960859-05	6	Pending	\N	\N
2	1	1	6	WINNER	4	3	25.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043451/raffle-winners/osoctzk1zaec2kevnh3t.png	\N	2026-10-03 11:03:34.960859-05	2026-10-03 11:04:10.441435-05	6	Pending	\N	\N
3	1	3	6	OPEN	\N	\N	\N	\N	\N	2026-10-04 20:46:14.410226-05	\N	6	Pending	\N	\N
\.


--
-- Data for Name: ReadingProfitPostings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."ReadingProfitPostings" ("ID", "LocationId", "ReadingSessionId", "Amount", "PostedBy", "PostedAt", "Notes") FROM stdin;
5	1	1	2930.00	4	2026-10-04 08:35:49.793625-05	Machine collection from reading session #1 · Profit 3346.00 · PULL 500.00 · Remaining 2846.00 · Daily OUT 84.00 · Collection 2930.00
\.


--
-- Data for Name: ReadingSessionCashTransactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."ReadingSessionCashTransactions" ("ID", "LocationId", "ReadingSessionId", "Type", "Amount", "ExpenseTypeId", "CreditTypeId", "CreatedBy", "Notes", "CreatedAt", "LegacyLocationCashEntryId") FROM stdin;
1	1	1	EXPENSE	50.00	3	\N	4	office stuff	2026-10-05 17:10:29.326842-05	6
2	1	1	EXPENSE	70.00	9	\N	4	\N	2026-10-05 17:10:52.268922-05	7
\.


--
-- Data for Name: ReadingSessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."ReadingSessions" ("ID", "DateCreated", "StartedAt", "EndedAt", "Status", "LocationId", "isDeleted") FROM stdin;
1	2026-10-03 12:39:40.757391-05	2026-10-03 12:39:40.757391-05	2026-10-03 13:19:02.405454-05	3	1	f
2	2026-10-04 22:50:39.205396-05	2026-10-04 22:50:39.205396-05	\N	1	1	f
\.


--
-- Data for Name: RolePermissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."RolePermissions" ("RoleId", "PermissionId") FROM stdin;
10	5
10	82
4	5
4	1
4	2
4	3
4	4
4	43
4	6
4	7
4	44
4	27
4	82
3	5
3	1
3	2
3	3
3	4
3	43
3	14
3	15
3	16
3	17
3	6
3	7
3	44
3	19
3	20
3	21
3	22
3	82
2	39
2	40
2	41
2	42
2	5
2	1
2	2
2	3
2	4
2	43
2	9
2	35
2	47
2	36
2	37
2	38
2	52
2	53
2	54
2	55
2	31
2	27
2	32
2	33
2	29
2	34
2	30
2	28
2	8
2	68
2	69
2	70
2	71
2	78
2	72
2	10
2	11
2	73
2	74
2	12
2	13
2	75
2	14
2	15
2	16
2	17
2	18
2	23
2	24
2	25
2	26
2	6
2	7
2	19
2	20
2	21
2	22
2	44
2	79
2	80
2	81
2	82
\.


--
-- Data for Name: Roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Roles" ("ID", "Name", "Description", "IsSystem", "IsActive", "DateCreated", "DateUpdated") FROM stdin;
10	CheckIn	Customer CheckIn	f	t	2026-09-25 08:55:11.60375	2026-09-25 09:02:42.939703
1	Owner	Full system access	f	t	2026-09-19 23:36:29.266674	\N
9	System Admin	System Admin	t	t	2026-09-20 18:53:18.079997	\N
4	Employee	Standard employee access	f	t	2026-09-19 23:36:29.266674	2026-09-26 21:58:23.923553
3	Manager	Management access	f	t	2026-09-19 23:36:29.266674	2026-09-26 21:58:35.175666
2	Admin	Administrative access	f	t	2026-09-19 23:36:29.266674	2026-09-26 21:58:50.119176
\.


--
-- Data for Name: SessionCashClosings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."SessionCashClosings" ("SessionId", "LocationId", "ClosingBalance", "HandoverId", "ClosedBy", "ClosedAt", "ActualCash", "Variance") FROM stdin;
1	1	14835.00	1	6	2026-10-03 11:08:02.928883-05	14835.00	0.00
2	1	15145.00	\N	12	2026-10-03 11:18:54.665229-05	15145.00	0.00
\.


--
-- Data for Name: SessionCashHandovers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."SessionCashHandovers" ("ID", "FromSessionId", "FromUserId", "ToUserId", "ToSessionId", "LocationId", "Amount", "Status", "Notes", "CreatedAt", "AcceptedAt", "AcceptedBy") FROM stdin;
1	1	6	12	2	1	14835.00	Accepted	\N	2026-10-03 11:08:02.928883-05	2026-10-03 11:08:42.560798-05	12
\.


--
-- Data for Name: SessionCashTransactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."SessionCashTransactions" ("ID", "SessionId", "LocationId", "Type", "Amount", "ExpenseTypeId", "Notes", "TransferId", "CreatedBy", "CreatedAt", "FundingId", "CreditTypeId") FROM stdin;
1	1	1	OPENING	15000.00	\N	First Day Opening Cash	\N	6	2026-10-03 09:54:38.184348-05	\N	\N
2	2	1	OPENING_TRANSFER	14835.00	\N	Handover from session #1	1	12	2026-10-03 11:08:42.560798-05	\N	\N
3	2	1	EXPENSE	40.00	5	\N	\N	12	2026-10-03 11:12:08.644067-05	\N	\N
4	2	1	CASH_RECEIVED	500.00	\N	\N	\N	12	2026-10-03 11:18:28.147192-05	\N	4
5	3	1	TRANSFER_IN	15000.00	\N	Business support from Owner/Admin	\N	6	2026-10-07 13:02:58.342637-05	1	\N
\.


--
-- Data for Name: TicketOuts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."TicketOuts" ("ID", "LocationId", "EmployeeSessionId", "EmployeeId", "MachineId", "Amount", "ImageUrl", "SessionTransactionId", "CreatedBy", "CreatedAt", "CustomerId") FROM stdin;
1	1	1	6	1	10.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043480/ticket-out/w0y7wyermixweu7swb9y.png	\N	6	2026-10-03 11:04:39.234293-05	1
2	1	1	6	2	15.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043497/ticket-out/oaxlfw8d560hqjnqxnz1.png	\N	6	2026-10-03 11:04:56.137121-05	2
3	1	1	6	3	30.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791043527/ticket-out/eytk0kmazwpvrwkh3qxq.png	\N	6	2026-10-03 11:05:26.237725-05	3
4	1	2	12	2	10.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791044012/ticket-out/mflkrth02ztbeptx6zhs.png	\N	12	2026-10-03 11:13:31.670854-05	4
5	1	2	12	5	20.00	https://res.cloudinary.com/moqaqhrc/image/upload/v1791044062/ticket-out/rbnc5mc3jgsmju1mcwkx.png	\N	12	2026-10-03 11:14:20.845167-05	5
\.


--
-- Data for Name: Users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Users" ("ID", "Username", "Password", token, "LocationId", "Name", "Avatar", "IsActive", "DateCreated", "RoleId", "Email", "Phone", "JobTitle", "DateUpdated") FROM stdin;
1	superadmin	$2b$10$r28Js7s4Zs6DvezV0CKkR.sTKCvvO1hrPfknwtd4/uDhFFSds3k02	d203039b884f014433db42cb836f762b	0	System Administrator	https://wpimg.wallstcn.com/f778738c-e4f8-4870-b634-56703b4acafe.gif	t	2026-09-20 20:07:09.902327	9	admin@example.com	\N	System Administrator	2026-09-20 20:08:14.490374
8	mandy	$2b$10$cYiR9/7uEenQZGSlab2A7O3GMJqhIFgSXyEZd0F1wgq2sIemifEny	cd2327b9aca2ee1cce09fb245398e075397eeeb76ba5dc2804d00fcc6435fb36	1	Mandy	/upload/profile.png	t	2026-09-22 09:44:03.931997	4	\N	\N	\N	\N
9	paola	$2b$10$LoDKWz3SUYWKssUTR2tZX.i0ZddB1b3Bkde3gZaAWbTCfdN6fruF2	bc091f5e390dc3fa6b64d4d5883d61aa173d2f500d998c8069f4c04d2273f0f6	1	Paola	/upload/profile.png	t	2026-09-22 09:44:29.468388	4	\N	\N	\N	\N
10	steph	$2b$10$cmHXSczTlkGWviA7OZwNTeNScup3MVKkJp4ZxtKB0iUJzpqrraTWW	07f50e00707559b78119f932037e7a7839ea388c0fdcac24de3200ea5b88de0f	1	Steph	/upload/profile.png	t	2026-09-22 09:45:04.180255	4	\N	\N	\N	\N
11	fernanda	$2b$10$RFo8O.TVT8SkQ38L5i808OMO0.KEi3rioQ7oTaTmqFDm7AUzEhDOK	838bfbbed2feec6fc31c8196e47bc1ceb0a68a4441fc6e1ced124f18bdc7791b	1	Fernanda	/upload/profile.png	t	2026-09-22 09:45:28.277279	4	\N	\N	\N	\N
2	mike	$2b$10$Otd.Sb3S5vu7nMZD96XrUua2mFt3NCIcbdLHa286Fz0QzjRiSb75m	646a240ad28d49327da05377eadfc90d4847e9943f1a606910406ab981816dcd	1	Mike	https://wpimg.wallstcn.com/f778738c-e4f8-4870-b634-56703b4acafe.gif	t	2026-09-22 08:21:28.911706	1	\N	\N	Owner	\N
3	sam	$2b$10$RLMgV6l17d0EGfQmNMWRvuMBq39o618MmTu/BPD9.XUu6jdDvVeKe	646a240ad28d49327da05377eadfc90d4847e9943f1a606910406ab981816dcd	4	Sam	https://wpimg.wallstcn.com/f778738c-e4f8-4870-b634-56703b4acafe.gif	t	2026-09-22 08:21:28.911706	1	\N	\N	Owner	2026-09-22 08:24:35.659343
4	riz	$2b$10$MfRY2PVquW9rsJid2dgjwe9Ia6grdM8I7ovtoV27TF/Qsm0DfAJwC	875faac9bf1a162053f4582f4c1e610ebbac9ce9328f33ebe3beb20afa717a1b	1	Riz	https://wpimg.wallstcn.com/f778738c-e4f8-4870-b634-56703b4acafe.gif	t	2026-09-22 09:32:07.420064	2	\N	\N	Administrator	\N
5	steve	$2b$10$X0SuivHgcd9lUgV0brxg0eisqpsoKfvl1sN8XhTcuFfww8klcTmiG	c170fd7617f0ce2f43943402062bc3088b2bef88073a8611bfbef0c9999e4285	2	Steve	https://wpimg.wallstcn.com/f778738c-e4f8-4870-b634-56703b4acafe.gif	t	2026-09-22 09:38:38.193938	2	\N	\N	Administrator	\N
7	kassie	$2b$10$K76OVOuohDZX0gtXHwDsr.hv/gdJQ3iMRGMTrJAN7nU2PncRAHIRe	6e1cd5fb5172908843670bea779c6bb695dcfef15ac267d96c82857c600e700d	1	Kassie	/upload/profile.png	t	2026-09-22 09:43:38.144336	4	\N	\N	\N	\N
6	ale	$2b$10$iTKewSWWNNVxChBaXL8mU.yAn3spusegNQ1aJ6toe91mDwGQ4tQgS	eb1de50e9b70f9bf6e10733e957aac8405376552a7d408bd20f2756e230209b1	1	Ale	/upload/profile.png	t	2026-09-22 09:42:52.972113	4	\N	\N	\N	2026-09-22 22:06:00.452439
12	chino	$2b$10$JNsaU8DtJH0cT/PnP9XEyuCgN6vHOFw84poktV.OPVCCz.8W1C6Sa	a4b7bbfa8be4609ea01f7b3d70045f786b017283ffc7a37c107300007216af73	1	Chino	/upload/profile.png	t	2026-09-22 09:45:54.260125	4	\N	\N	\N	2026-09-22 23:01:22.826645
13	jose	$2b$10$TAqTg47MtxuxDlew4bRq6.mgehp6WTvo/QcQsUCef.LCA7xDPfEaG	621407b01ca3653d7dae29e2e5720b44c2486337c4e9103e02fec6820e8fc6b9	2	Jose	/upload/profile.png	t	2026-09-24 09:26:38.492254	4	\N	\N	Employee	\N
14	alex	$2b$10$uKebuW8mK3FN/O6T.i43Ueo9EgoZ2ExAUrEVYV5i3iOpiwRA3cKNS	1908ddd16f2cd95bd08725042ae293f25cd8ded2f6415d95d7a352dab4fff525	2	Alex	/upload/profile.png	t	2026-09-24 09:26:57.710736	4	\N	\N	Employee	\N
15	angel	$2b$10$V0sW5QDv/520g6qmAL4I/.E/1/jsp8bY0U4YMPbGEpkXyZgBre.Ny	144261491f5771d400574e46e632ed4c1b0eb2a184228dbd43162dec3ec67ef8	2	Angel	/upload/profile.png	t	2026-09-24 09:27:14.735692	4	\N	\N	Internee	\N
16	checkin	$2b$10$rTkMQj060zIlwSkECMAozOas7BQPejVB/jIUsrMGAj0RD/0BA5WqO	fc1342413d0dfffaa7d52cf882a37775131530a33d255b38021a9deb6384a857	1	Customer CheckIn	/upload/profile.png	t	2026-09-25 09:03:45.143535	10	\N	\N	Standalone System	\N
\.


--
-- Name: AdminCashFunding_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."AdminCashFunding_ID_seq"', 1, true);


--
-- Name: BonusAwards_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."BonusAwards_ID_seq"', 3, true);


--
-- Name: BonusPayout_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."BonusPayout_ID_seq"', 2, true);


--
-- Name: BonusScheduleBlock_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."BonusScheduleBlock_ID_seq"', 1, true);


--
-- Name: BonusScheduleDay_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."BonusScheduleDay_ID_seq"', 7, true);


--
-- Name: Bonus_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Bonus_ID_seq"', 1, true);


--
-- Name: CheckIn_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."CheckIn_ID_seq"', 8, true);


--
-- Name: Companies_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Companies_ID_seq"', 2, true);


--
-- Name: CreditTypes_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."CreditTypes_ID_seq"', 6, true);


--
-- Name: CustomerLog_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."CustomerLog_ID_seq"', 1, true);


--
-- Name: CustomerMatch_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."CustomerMatch_ID_seq"', 9, true);


--
-- Name: Customer_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Customer_ID_seq"', 110, true);


--
-- Name: EmployeeSession_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."EmployeeSession_ID_seq"', 3, true);


--
-- Name: ExpenseTypes_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."ExpenseTypes_ID_seq"', 13, true);


--
-- Name: Games_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Games_ID_seq"', 7, true);


--
-- Name: LocationCashAccounts_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LocationCashAccounts_ID_seq"', 6, true);


--
-- Name: LocationCashCapital_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LocationCashCapital_ID_seq"', 1, false);


--
-- Name: LocationCashEntries_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LocationCashEntries_ID_seq"', 8, true);


--
-- Name: LocationCashTransfers_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LocationCashTransfers_ID_seq"', 1, false);


--
-- Name: LocationRuleSettings_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LocationRuleSettings_ID_seq"', 5, true);


--
-- Name: Locations_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Locations_ID_seq"', 4, true);


--
-- Name: LuckyBirdAwards_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LuckyBirdAwards_ID_seq"', 1, true);


--
-- Name: LuckyBirdPayout_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LuckyBirdPayout_ID_seq"', 1, false);


--
-- Name: LuckyBirdScheduleBlock_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LuckyBirdScheduleBlock_ID_seq"', 1, false);


--
-- Name: LuckyBirdScheduleDay_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LuckyBirdScheduleDay_ID_seq"', 1, false);


--
-- Name: LuckyBird_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."LuckyBird_ID_seq"', 1, false);


--
-- Name: MachineLogs_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."MachineLogs_ID_seq"', 18, true);


--
-- Name: MachineReadings_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."MachineReadings_ID_seq"', 11, true);


--
-- Name: MachineStatusLog_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."MachineStatusLog_ID_seq"', 1, false);


--
-- Name: MachineStatus_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."MachineStatus_ID_seq"', 1, false);


--
-- Name: MachineTypes_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."MachineTypes_ID_seq"', 18, true);


--
-- Name: Machines_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Machines_ID_seq"', 5, true);


--
-- Name: Permissions_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Permissions_ID_seq"', 82, true);


--
-- Name: PromotionAuditLogs_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."PromotionAuditLogs_ID_seq"', 1, false);


--
-- Name: PromotionDeliveryLogs_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."PromotionDeliveryLogs_ID_seq"', 1, false);


--
-- Name: PromotionRecipients_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."PromotionRecipients_ID_seq"', 1, false);


--
-- Name: PromotionTemplates_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."PromotionTemplates_ID_seq"', 9, true);


--
-- Name: Promotions_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Promotions_ID_seq"', 1, false);


--
-- Name: RaffleAttempts_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."RaffleAttempts_ID_seq"', 3, true);


--
-- Name: RaffleSettings_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."RaffleSettings_ID_seq"', 1, true);


--
-- Name: Raffles_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Raffles_ID_seq"', 3, true);


--
-- Name: ReadingProfitPostings_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."ReadingProfitPostings_ID_seq"', 5, true);


--
-- Name: ReadingSessionCashTransactions_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."ReadingSessionCashTransactions_ID_seq"', 2, true);


--
-- Name: ReadingSessions_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."ReadingSessions_ID_seq"', 2, true);


--
-- Name: Roles_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Roles_ID_seq"', 10, true);


--
-- Name: SessionCashHandovers_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."SessionCashHandovers_ID_seq"', 1, true);


--
-- Name: SessionCashTransactions_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."SessionCashTransactions_ID_seq"', 5, true);


--
-- Name: TicketOuts_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."TicketOuts_ID_seq"', 5, true);


--
-- Name: Users_ID_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."Users_ID_seq"', 16, true);


--
-- Name: AdminCashFunding AdminCashFunding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminCashFunding"
    ADD CONSTRAINT "AdminCashFunding_pkey" PRIMARY KEY ("ID");


--
-- Name: BonusAwards BonusAwards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_pkey" PRIMARY KEY ("ID");


--
-- Name: BonusPayout BonusPayout_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusPayout"
    ADD CONSTRAINT "BonusPayout_pkey" PRIMARY KEY ("ID");


--
-- Name: BonusScheduleBlock BonusScheduleBlock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusScheduleBlock"
    ADD CONSTRAINT "BonusScheduleBlock_pkey" PRIMARY KEY ("ID");


--
-- Name: BonusScheduleDay BonusScheduleDay_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusScheduleDay"
    ADD CONSTRAINT "BonusScheduleDay_pkey" PRIMARY KEY ("ID");


--
-- Name: BonusScheduleDay BonusScheduleDay_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusScheduleDay"
    ADD CONSTRAINT "BonusScheduleDay_unique" UNIQUE ("ScheduleBlockId", "DayOfWeek");


--
-- Name: Bonus Bonus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Bonus"
    ADD CONSTRAINT "Bonus_pkey" PRIMARY KEY ("ID");


--
-- Name: CheckIn CheckIn_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CheckIn"
    ADD CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("ID");


--
-- Name: Companies Companies_Name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Companies"
    ADD CONSTRAINT "Companies_Name_key" UNIQUE ("Name");


--
-- Name: Companies Companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Companies"
    ADD CONSTRAINT "Companies_pkey" PRIMARY KEY ("ID");


--
-- Name: CreditTypes CreditTypes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CreditTypes"
    ADD CONSTRAINT "CreditTypes_pkey" PRIMARY KEY ("ID");


--
-- Name: CustomerLog CustomerLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerLog"
    ADD CONSTRAINT "CustomerLog_pkey" PRIMARY KEY ("ID");


--
-- Name: CustomerMatch CustomerMatch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerMatch"
    ADD CONSTRAINT "CustomerMatch_pkey" PRIMARY KEY ("ID");


--
-- Name: Customer Customer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Customer"
    ADD CONSTRAINT "Customer_pkey" PRIMARY KEY ("ID");


--
-- Name: EmployeeSession EmployeeSession_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EmployeeSession"
    ADD CONSTRAINT "EmployeeSession_pkey" PRIMARY KEY ("ID");


--
-- Name: ExpenseTypes ExpenseTypes_ID_LocationId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExpenseTypes"
    ADD CONSTRAINT "ExpenseTypes_ID_LocationId_key" UNIQUE ("ID", "LocationId");


--
-- Name: ExpenseTypes ExpenseTypes_LocationId_Name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExpenseTypes"
    ADD CONSTRAINT "ExpenseTypes_LocationId_Name_key" UNIQUE ("LocationId", "Name");


--
-- Name: ExpenseTypes ExpenseTypes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExpenseTypes"
    ADD CONSTRAINT "ExpenseTypes_pkey" PRIMARY KEY ("ID");


--
-- Name: Games Games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Games"
    ADD CONSTRAINT "Games_pkey" PRIMARY KEY ("ID");


--
-- Name: LocationCashAccounts LocationCashAccounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashAccounts"
    ADD CONSTRAINT "LocationCashAccounts_pkey" PRIMARY KEY ("ID");


--
-- Name: LocationCashCapital LocationCashCapital_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashCapital"
    ADD CONSTRAINT "LocationCashCapital_pkey" PRIMARY KEY ("ID");


--
-- Name: LocationCashEntries LocationCashEntries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_pkey" PRIMARY KEY ("ID");


--
-- Name: LocationCashTransfers LocationCashTransfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashTransfers"
    ADD CONSTRAINT "LocationCashTransfers_pkey" PRIMARY KEY ("ID");


--
-- Name: LocationRuleSettings LocationRuleSettings_LocationId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationRuleSettings"
    ADD CONSTRAINT "LocationRuleSettings_LocationId_key" UNIQUE ("LocationId");


--
-- Name: LocationRuleSettings LocationRuleSettings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationRuleSettings"
    ADD CONSTRAINT "LocationRuleSettings_pkey" PRIMARY KEY ("ID");


--
-- Name: Locations Locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Locations"
    ADD CONSTRAINT "Locations_pkey" PRIMARY KEY ("ID");


--
-- Name: LuckyBirdAwards LuckyBirdAwards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdAwards"
    ADD CONSTRAINT "LuckyBirdAwards_pkey" PRIMARY KEY ("ID");


--
-- Name: LuckyBirdPayout LuckyBirdPayout_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdPayout"
    ADD CONSTRAINT "LuckyBirdPayout_pkey" PRIMARY KEY ("ID");


--
-- Name: LuckyBirdScheduleBlock LuckyBirdScheduleBlock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdScheduleBlock"
    ADD CONSTRAINT "LuckyBirdScheduleBlock_pkey" PRIMARY KEY ("ID");


--
-- Name: LuckyBirdScheduleDay LuckyBirdScheduleDay_ScheduleBlockId_DayOfWeek_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdScheduleDay"
    ADD CONSTRAINT "LuckyBirdScheduleDay_ScheduleBlockId_DayOfWeek_key" UNIQUE ("ScheduleBlockId", "DayOfWeek");


--
-- Name: LuckyBirdScheduleDay LuckyBirdScheduleDay_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdScheduleDay"
    ADD CONSTRAINT "LuckyBirdScheduleDay_pkey" PRIMARY KEY ("ID");


--
-- Name: LuckyBird LuckyBird_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBird"
    ADD CONSTRAINT "LuckyBird_pkey" PRIMARY KEY ("ID");


--
-- Name: MachineLogs MachineLogs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineLogs"
    ADD CONSTRAINT "MachineLogs_pkey" PRIMARY KEY ("ID");


--
-- Name: MachineReadings MachineReadings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineReadings"
    ADD CONSTRAINT "MachineReadings_pkey" PRIMARY KEY ("ID");


--
-- Name: MachineStatusLog MachineStatusLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineStatusLog"
    ADD CONSTRAINT "MachineStatusLog_pkey" PRIMARY KEY ("ID");


--
-- Name: MachineStatus MachineStatus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineStatus"
    ADD CONSTRAINT "MachineStatus_pkey" PRIMARY KEY ("ID");


--
-- Name: MachineTypes MachineTypes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineTypes"
    ADD CONSTRAINT "MachineTypes_pkey" PRIMARY KEY ("ID");


--
-- Name: Machines Machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Machines"
    ADD CONSTRAINT "Machines_pkey" PRIMARY KEY ("ID");


--
-- Name: Permissions Permissions_Code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Permissions"
    ADD CONSTRAINT "Permissions_Code_unique" UNIQUE ("Code");


--
-- Name: Permissions Permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Permissions"
    ADD CONSTRAINT "Permissions_pkey" PRIMARY KEY ("ID");


--
-- Name: PromotionAuditLogs PromotionAuditLogs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionAuditLogs"
    ADD CONSTRAINT "PromotionAuditLogs_pkey" PRIMARY KEY ("ID");


--
-- Name: PromotionDeliveryLogs PromotionDeliveryLogs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionDeliveryLogs"
    ADD CONSTRAINT "PromotionDeliveryLogs_pkey" PRIMARY KEY ("ID");


--
-- Name: PromotionRecipients PromotionRecipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionRecipients"
    ADD CONSTRAINT "PromotionRecipients_pkey" PRIMARY KEY ("ID");


--
-- Name: PromotionTemplates PromotionTemplates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionTemplates"
    ADD CONSTRAINT "PromotionTemplates_pkey" PRIMARY KEY ("ID");


--
-- Name: Promotions Promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Promotions"
    ADD CONSTRAINT "Promotions_pkey" PRIMARY KEY ("ID");


--
-- Name: RaffleAttempts RaffleAttempts_RaffleId_AttemptNo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RaffleAttempts"
    ADD CONSTRAINT "RaffleAttempts_RaffleId_AttemptNo_key" UNIQUE ("RaffleId", "AttemptNo");


--
-- Name: RaffleAttempts RaffleAttempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RaffleAttempts"
    ADD CONSTRAINT "RaffleAttempts_pkey" PRIMARY KEY ("ID");


--
-- Name: RaffleSettings RaffleSettings_LocationId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RaffleSettings"
    ADD CONSTRAINT "RaffleSettings_LocationId_key" UNIQUE ("LocationId");


--
-- Name: RaffleSettings RaffleSettings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RaffleSettings"
    ADD CONSTRAINT "RaffleSettings_pkey" PRIMARY KEY ("ID");


--
-- Name: Raffles Raffles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Raffles"
    ADD CONSTRAINT "Raffles_pkey" PRIMARY KEY ("ID");


--
-- Name: ReadingProfitPostings ReadingProfitPostings_Once; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingProfitPostings"
    ADD CONSTRAINT "ReadingProfitPostings_Once" UNIQUE ("LocationId", "ReadingSessionId");


--
-- Name: ReadingProfitPostings ReadingProfitPostings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingProfitPostings"
    ADD CONSTRAINT "ReadingProfitPostings_pkey" PRIMARY KEY ("ID");


--
-- Name: ReadingSessionCashTransactions ReadingSessionCashTransactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingSessionCashTransactions"
    ADD CONSTRAINT "ReadingSessionCashTransactions_pkey" PRIMARY KEY ("ID");


--
-- Name: ReadingSessions ReadingSessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingSessions"
    ADD CONSTRAINT "ReadingSessions_pkey" PRIMARY KEY ("ID");


--
-- Name: RolePermissions RolePermissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RolePermissions"
    ADD CONSTRAINT "RolePermissions_pkey" PRIMARY KEY ("RoleId", "PermissionId");


--
-- Name: Roles Roles_Name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Roles"
    ADD CONSTRAINT "Roles_Name_unique" UNIQUE ("Name");


--
-- Name: Roles Roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Roles"
    ADD CONSTRAINT "Roles_pkey" PRIMARY KEY ("ID");


--
-- Name: SessionCashClosings SessionCashClosings_HandoverId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashClosings"
    ADD CONSTRAINT "SessionCashClosings_HandoverId_key" UNIQUE ("HandoverId");


--
-- Name: SessionCashClosings SessionCashClosings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashClosings"
    ADD CONSTRAINT "SessionCashClosings_pkey" PRIMARY KEY ("SessionId");


--
-- Name: SessionCashHandovers SessionCashHandovers_FromSessionId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashHandovers"
    ADD CONSTRAINT "SessionCashHandovers_FromSessionId_key" UNIQUE ("FromSessionId");


--
-- Name: SessionCashHandovers SessionCashHandovers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashHandovers"
    ADD CONSTRAINT "SessionCashHandovers_pkey" PRIMARY KEY ("ID");


--
-- Name: SessionCashTransactions SessionCashTransactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashTransactions"
    ADD CONSTRAINT "SessionCashTransactions_pkey" PRIMARY KEY ("ID");


--
-- Name: TicketOuts TicketOuts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts"
    ADD CONSTRAINT "TicketOuts_pkey" PRIMARY KEY ("ID");


--
-- Name: ReadingSessionCashTransactions UQ_ReadingSessionCashTransactions_LegacyLocationCashEntry; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingSessionCashTransactions"
    ADD CONSTRAINT "UQ_ReadingSessionCashTransactions_LegacyLocationCashEntry" UNIQUE ("LegacyLocationCashEntryId");


--
-- Name: Users Users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Users"
    ADD CONSTRAINT "Users_pkey" PRIMARY KEY ("ID");


--
-- Name: AdminCashFunding_FinanceReportIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminCashFunding_FinanceReportIndex" ON public."AdminCashFunding" USING btree ("LocationId", "CreatedAt" DESC, "ToUserId", "Status");


--
-- Name: AdminCashFunding_LocationIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminCashFunding_LocationIndex" ON public."AdminCashFunding" USING btree ("LocationId", "CreatedAt" DESC);


--
-- Name: AdminCashFunding_RecipientIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminCashFunding_RecipientIndex" ON public."AdminCashFunding" USING btree ("ToUserId", "LocationId", "Status", "CreatedAt");


--
-- Name: BonusPayout_Bonus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BonusPayout_Bonus_idx" ON public."BonusPayout" USING btree ("BonusId");


--
-- Name: BonusScheduleBlock_Bonus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BonusScheduleBlock_Bonus_idx" ON public."BonusScheduleBlock" USING btree ("BonusId");


--
-- Name: Bonus_Location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Bonus_Location_idx" ON public."Bonus" USING btree ("LocationId");


--
-- Name: CustomerMatch_FinanceReportIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerMatch_FinanceReportIndex" ON public."CustomerMatch" USING btree ("LocationId", "DateAssign" DESC, "AssignedBy");


--
-- Name: CustomerMatch_ReviewStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerMatch_ReviewStatus_idx" ON public."CustomerMatch" USING btree ("LocationId", "ReviewStatus");


--
-- Name: EmployeeSession_FinanceReportIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "EmployeeSession_FinanceReportIndex" ON public."EmployeeSession" USING btree ("LocationId", "ClockIn" DESC, "UserId");


--
-- Name: EmployeeSession_OneActiveSession; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "EmployeeSession_OneActiveSession" ON public."EmployeeSession" USING btree ("UserId") WHERE ("ClockOut" IS NULL);


--
-- Name: EmployeeSession_ReadingSessionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "EmployeeSession_ReadingSessionId_idx" ON public."EmployeeSession" USING btree ("ReadingSessionId") WHERE ("ReadingSessionId" IS NOT NULL);


--
-- Name: EmployeeSession_UnassignedCompleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "EmployeeSession_UnassignedCompleted_idx" ON public."EmployeeSession" USING btree ("LocationId", "ClockOut" DESC, "ID" DESC) WHERE (("ClockOut" IS NOT NULL) AND ("ReadingSessionId" IS NULL));


--
-- Name: EmployeeSession_User_Date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "EmployeeSession_User_Date_idx" ON public."EmployeeSession" USING btree ("UserId", "ClockIn" DESC);


--
-- Name: IX_BonusAwards_Employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_BonusAwards_Employee" ON public."BonusAwards" USING btree ("EmployeeId", "CreatedAt" DESC);


--
-- Name: IX_BonusAwards_Location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_BonusAwards_Location" ON public."BonusAwards" USING btree ("LocationId", "CreatedAt" DESC);


--
-- Name: IX_BonusAwards_Session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_BonusAwards_Session" ON public."BonusAwards" USING btree ("EmployeeSessionId", "CreatedAt" DESC);


--
-- Name: IX_CustomerMatch_EmployeeSessionId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_CustomerMatch_EmployeeSessionId" ON public."CustomerMatch" USING btree ("EmployeeSessionId");


--
-- Name: IX_CustomerMatch_Session_Extra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_CustomerMatch_Session_Extra" ON public."CustomerMatch" USING btree ("EmployeeSessionId", "IsExtraMatch");


--
-- Name: IX_LocationRuleSettings_LocationId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_LocationRuleSettings_LocationId" ON public."LocationRuleSettings" USING btree ("LocationId");


--
-- Name: IX_LuckyBirdAwards_EmployeeSessionId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_LuckyBirdAwards_EmployeeSessionId" ON public."LuckyBirdAwards" USING btree ("EmployeeSessionId");


--
-- Name: IX_LuckyBirdAwards_LocationId_CreatedAt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_LuckyBirdAwards_LocationId_CreatedAt" ON public."LuckyBirdAwards" USING btree ("LocationId", "CreatedAt" DESC);


--
-- Name: IX_LuckyBirdPayout_LuckyBirdId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_LuckyBirdPayout_LuckyBirdId" ON public."LuckyBirdPayout" USING btree ("LuckyBirdId");


--
-- Name: IX_LuckyBirdScheduleBlock_LuckyBirdId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_LuckyBirdScheduleBlock_LuckyBirdId" ON public."LuckyBirdScheduleBlock" USING btree ("LuckyBirdId");


--
-- Name: IX_LuckyBird_LocationId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_LuckyBird_LocationId" ON public."LuckyBird" USING btree ("LocationId");


--
-- Name: IX_PromotionAuditLogs_CompanyId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionAuditLogs_CompanyId" ON public."PromotionAuditLogs" USING btree ("CompanyId");


--
-- Name: IX_PromotionAuditLogs_PromotionId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionAuditLogs_PromotionId" ON public."PromotionAuditLogs" USING btree ("PromotionId");


--
-- Name: IX_PromotionAuditLogs_TemplateId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionAuditLogs_TemplateId" ON public."PromotionAuditLogs" USING btree ("TemplateId");


--
-- Name: IX_PromotionDeliveryLogs_PromotionId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionDeliveryLogs_PromotionId" ON public."PromotionDeliveryLogs" USING btree ("PromotionId");


--
-- Name: IX_PromotionDeliveryLogs_TwilioMessageSid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionDeliveryLogs_TwilioMessageSid" ON public."PromotionDeliveryLogs" USING btree ("TwilioMessageSid");


--
-- Name: IX_PromotionRecipients_CustomerId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionRecipients_CustomerId" ON public."PromotionRecipients" USING btree ("CustomerId");


--
-- Name: IX_PromotionRecipients_PromotionId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionRecipients_PromotionId" ON public."PromotionRecipients" USING btree ("PromotionId");


--
-- Name: IX_PromotionRecipients_TwilioMessageSid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionRecipients_TwilioMessageSid" ON public."PromotionRecipients" USING btree ("TwilioMessageSid");


--
-- Name: IX_PromotionTemplates_CompanyId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionTemplates_CompanyId" ON public."PromotionTemplates" USING btree ("CompanyId");


--
-- Name: IX_PromotionTemplates_SourceTemplateId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_PromotionTemplates_SourceTemplateId" ON public."PromotionTemplates" USING btree ("SourceTemplateId");


--
-- Name: IX_Promotions_CompanyId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_Promotions_CompanyId" ON public."Promotions" USING btree ("CompanyId");


--
-- Name: IX_Promotions_LocationId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_Promotions_LocationId" ON public."Promotions" USING btree ("LocationId");


--
-- Name: IX_Promotions_TemplateId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_Promotions_TemplateId" ON public."Promotions" USING btree ("TemplateId");


--
-- Name: IX_RaffleAttempts_Raffle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_RaffleAttempts_Raffle" ON public."RaffleAttempts" USING btree ("RaffleId", "AttemptNo");


--
-- Name: IX_Raffles_Location_StartedAt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_Raffles_Location_StartedAt" ON public."Raffles" USING btree ("LocationId", "StartedAt" DESC);


--
-- Name: IX_Raffles_WinnerCustomer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_Raffles_WinnerCustomer" ON public."Raffles" USING btree ("WinnerCustomerId", "CompletedAt" DESC) WHERE (("Status")::text = 'WINNER'::text);


--
-- Name: IX_ReadingSessionCashTransactions_Location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_ReadingSessionCashTransactions_Location" ON public."ReadingSessionCashTransactions" USING btree ("LocationId", "ReadingSessionId");


--
-- Name: IX_ReadingSessionCashTransactions_ReadingSession; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_ReadingSessionCashTransactions_ReadingSession" ON public."ReadingSessionCashTransactions" USING btree ("ReadingSessionId", "Type", "CreatedAt");


--
-- Name: IX_SessionCashTransactions_CreditTypeId; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_SessionCashTransactions_CreditTypeId" ON public."SessionCashTransactions" USING btree ("CreditTypeId");


--
-- Name: IX_TicketOuts_Location_CreatedAt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_TicketOuts_Location_CreatedAt" ON public."TicketOuts" USING btree ("LocationId", "CreatedAt" DESC);


--
-- Name: IX_TicketOuts_Machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_TicketOuts_Machine" ON public."TicketOuts" USING btree ("MachineId", "CreatedAt" DESC);


--
-- Name: IX_TicketOuts_Session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IX_TicketOuts_Session" ON public."TicketOuts" USING btree ("EmployeeSessionId", "CreatedAt" DESC);


--
-- Name: LocationCashAccounts_bank_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LocationCashAccounts_bank_unique" ON public."LocationCashAccounts" USING btree ("LocationId") WHERE ("Kind" = 'BANK'::text);


--
-- Name: LocationCashAccounts_person_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LocationCashAccounts_person_unique" ON public."LocationCashAccounts" USING btree ("LocationId", "Kind", "UserId") WHERE ("UserId" IS NOT NULL);


--
-- Name: LocationCashEntries_account_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LocationCashEntries_account_date" ON public."LocationCashEntries" USING btree ("AccountId", "CreatedAt" DESC, "ID" DESC);


--
-- Name: LocationCashEntries_capital_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LocationCashEntries_capital_once" ON public."LocationCashEntries" USING btree ("CapitalId") WHERE ("CapitalId" IS NOT NULL);


--
-- Name: LocationCashEntries_funding_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LocationCashEntries_funding_once" ON public."LocationCashEntries" USING btree ("FundingId") WHERE ("FundingId" IS NOT NULL);


--
-- Name: LocationCashEntries_movement_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LocationCashEntries_movement_pair" ON public."LocationCashEntries" USING btree ("MovementKey") WHERE ("MovementKey" IS NOT NULL);


--
-- Name: LocationCashEntries_posting_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LocationCashEntries_posting_once" ON public."LocationCashEntries" USING btree ("ReadingProfitPostingId") WHERE ("ReadingProfitPostingId" IS NOT NULL);


--
-- Name: LocationCashEntries_transfer_account_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LocationCashEntries_transfer_account_once" ON public."LocationCashEntries" USING btree ("TransferId", "AccountId") WHERE ("TransferId" IS NOT NULL);


--
-- Name: LocationCashEntries_withdrawal_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LocationCashEntries_withdrawal_once" ON public."LocationCashEntries" USING btree ("SessionTransactionId") WHERE ("SessionTransactionId" IS NOT NULL);


--
-- Name: LocationCashTransfers_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LocationCashTransfers_pending" ON public."LocationCashTransfers" USING btree ("FromAccountId") WHERE ("Status" = 'Pending'::text);


--
-- Name: MachineReadings_Initial_Machine_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "MachineReadings_Initial_Machine_unique" ON public."MachineReadings" USING btree ("MachineId") WHERE (("SessionId" IS NULL) AND (("ReadingType")::text = 'INITIAL'::text));


--
-- Name: MachineReadings_Session_Machine_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "MachineReadings_Session_Machine_unique" ON public."MachineReadings" USING btree ("SessionId", "MachineId");


--
-- Name: ReadingProfitPostings_LocationDate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReadingProfitPostings_LocationDate" ON public."ReadingProfitPostings" USING btree ("LocationId", "PostedAt" DESC);


--
-- Name: ReadingProfitPostings_PostedByDate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReadingProfitPostings_PostedByDate" ON public."ReadingProfitPostings" USING btree ("PostedBy", "PostedAt" DESC);


--
-- Name: SessionCashClosings_FinanceReportIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionCashClosings_FinanceReportIndex" ON public."SessionCashClosings" USING btree ("LocationId", "ClosedAt" DESC, "SessionId");


--
-- Name: SessionCashHandovers_FinanceReportIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionCashHandovers_FinanceReportIndex" ON public."SessionCashHandovers" USING btree ("LocationId", "CreatedAt" DESC, "FromUserId", "ToUserId");


--
-- Name: SessionCashHandovers_RecipientIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionCashHandovers_RecipientIndex" ON public."SessionCashHandovers" USING btree ("ToUserId", "LocationId", "Status", "CreatedAt");


--
-- Name: SessionCashTransactions_FinanceReportIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionCashTransactions_FinanceReportIndex" ON public."SessionCashTransactions" USING btree ("LocationId", "CreatedAt" DESC, "SessionId");


--
-- Name: SessionCashTransactions_FundingOnce; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SessionCashTransactions_FundingOnce" ON public."SessionCashTransactions" USING btree ("FundingId") WHERE ("FundingId" IS NOT NULL);


--
-- Name: SessionCashTransactions_OpeningOnce; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SessionCashTransactions_OpeningOnce" ON public."SessionCashTransactions" USING btree ("SessionId") WHERE (("Type")::text = ANY (ARRAY[('OPENING'::character varying)::text, ('OPENING_TRANSFER'::character varying)::text]));


--
-- Name: SessionCashTransactions_OwnerWithdrawalIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionCashTransactions_OwnerWithdrawalIndex" ON public."SessionCashTransactions" USING btree ("LocationId", "Type", "CreatedAt" DESC) WHERE (("Type")::text = 'OWNER_WITHDRAWAL'::text);


--
-- Name: SessionCashTransactions_SessionIndex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionCashTransactions_SessionIndex" ON public."SessionCashTransactions" USING btree ("SessionId", "CreatedAt", "ID");


--
-- Name: SessionCashTransactions_TransferOnce; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SessionCashTransactions_TransferOnce" ON public."SessionCashTransactions" USING btree ("TransferId") WHERE ("TransferId" IS NOT NULL);


--
-- Name: UX_TicketOuts_SessionTransactionId; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UX_TicketOuts_SessionTransactionId" ON public."TicketOuts" USING btree ("SessionTransactionId") WHERE ("SessionTransactionId" IS NOT NULL);


--
-- Name: Users_Username_lower_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Users_Username_lower_unique" ON public."Users" USING btree (lower(("Username")::text));


--
-- Name: idx_checkin_open_customer_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkin_open_customer_location ON public."CheckIn" USING btree ("CustomerId", "LocationId", "CheckInDate" DESC, "ID" DESC) WHERE ("CheckOutDate" IS NULL);


--
-- Name: idx_games_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_company ON public."Games" USING btree ("CompanyId");


--
-- Name: idx_games_machinetype; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_machinetype ON public."Games" USING btree ("MachineTypeId");


--
-- Name: idx_locations_companyid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_locations_companyid ON public."Locations" USING btree ("CompanyId");


--
-- Name: idx_machinelogs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_machinelogs_date ON public."MachineLogs" USING btree ("DateCreated" DESC);


--
-- Name: idx_machinelogs_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_machinelogs_machine ON public."MachineLogs" USING btree ("MachineId");


--
-- Name: idx_machines_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_machines_location ON public."Machines" USING btree (locationid);


--
-- Name: idx_machinetypes_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_machinetypes_company ON public."MachineTypes" USING btree ("CompanyId");


--
-- Name: ux_CreditTypes_Location_Code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ux_CreditTypes_Location_Code" ON public."CreditTypes" USING btree ("LocationId", "Code") WHERE ("Code" IS NOT NULL);


--
-- Name: ux_machines_location_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_machines_location_number ON public."Machines" USING btree (locationid, "MachineNumber");


--
-- Name: ux_machinestatus_description; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_machinestatus_description ON public."MachineStatus" USING btree (lower(("Description")::text));


--
-- Name: AdminCashFunding AdminCashFunding_AcceptedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminCashFunding"
    ADD CONSTRAINT "AdminCashFunding_AcceptedBy_fkey" FOREIGN KEY ("AcceptedBy") REFERENCES public."Users"("ID");


--
-- Name: AdminCashFunding AdminCashFunding_CancelledBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminCashFunding"
    ADD CONSTRAINT "AdminCashFunding_CancelledBy_fkey" FOREIGN KEY ("CancelledBy") REFERENCES public."Users"("ID");


--
-- Name: AdminCashFunding AdminCashFunding_CustodySourceAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminCashFunding"
    ADD CONSTRAINT "AdminCashFunding_CustodySourceAccountId_fkey" FOREIGN KEY ("CustodySourceAccountId") REFERENCES public."LocationCashAccounts"("ID");


--
-- Name: AdminCashFunding AdminCashFunding_FromUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminCashFunding"
    ADD CONSTRAINT "AdminCashFunding_FromUserId_fkey" FOREIGN KEY ("FromUserId") REFERENCES public."Users"("ID");


--
-- Name: AdminCashFunding AdminCashFunding_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminCashFunding"
    ADD CONSTRAINT "AdminCashFunding_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: AdminCashFunding AdminCashFunding_ToSessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminCashFunding"
    ADD CONSTRAINT "AdminCashFunding_ToSessionId_fkey" FOREIGN KEY ("ToSessionId") REFERENCES public."EmployeeSession"("ID");


--
-- Name: AdminCashFunding AdminCashFunding_ToUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminCashFunding"
    ADD CONSTRAINT "AdminCashFunding_ToUserId_fkey" FOREIGN KEY ("ToUserId") REFERENCES public."Users"("ID");


--
-- Name: BonusAwards BonusAwards_BonusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_BonusId_fkey" FOREIGN KEY ("BonusId") REFERENCES public."Bonus"("ID") ON DELETE SET NULL;


--
-- Name: BonusAwards BonusAwards_BonusPayoutId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_BonusPayoutId_fkey" FOREIGN KEY ("BonusPayoutId") REFERENCES public."BonusPayout"("ID") ON DELETE SET NULL;


--
-- Name: BonusAwards BonusAwards_CreatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_CreatedBy_fkey" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID");


--
-- Name: BonusAwards BonusAwards_CustomerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_CustomerId_fkey" FOREIGN KEY ("CustomerId") REFERENCES public."Customer"("ID");


--
-- Name: BonusAwards BonusAwards_EmployeeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_EmployeeId_fkey" FOREIGN KEY ("EmployeeId") REFERENCES public."Users"("ID");


--
-- Name: BonusAwards BonusAwards_EmployeeSessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_EmployeeSessionId_fkey" FOREIGN KEY ("EmployeeSessionId") REFERENCES public."EmployeeSession"("ID");


--
-- Name: BonusAwards BonusAwards_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: BonusAwards BonusAwards_MachineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_MachineId_fkey" FOREIGN KEY ("MachineId") REFERENCES public."Machines"("ID");


--
-- Name: BonusAwards BonusAwards_ReviewedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusAwards"
    ADD CONSTRAINT "BonusAwards_ReviewedBy_fkey" FOREIGN KEY ("ReviewedBy") REFERENCES public."Users"("ID") ON DELETE SET NULL;


--
-- Name: BonusPayout BonusPayout_Bonus_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusPayout"
    ADD CONSTRAINT "BonusPayout_Bonus_fkey" FOREIGN KEY ("BonusId") REFERENCES public."Bonus"("ID") ON DELETE CASCADE;


--
-- Name: BonusScheduleBlock BonusScheduleBlock_Bonus_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusScheduleBlock"
    ADD CONSTRAINT "BonusScheduleBlock_Bonus_fkey" FOREIGN KEY ("BonusId") REFERENCES public."Bonus"("ID") ON DELETE CASCADE;


--
-- Name: BonusScheduleDay BonusScheduleDay_Block_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BonusScheduleDay"
    ADD CONSTRAINT "BonusScheduleDay_Block_fkey" FOREIGN KEY ("ScheduleBlockId") REFERENCES public."BonusScheduleBlock"("ID") ON DELETE CASCADE;


--
-- Name: Bonus Bonus_Location_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Bonus"
    ADD CONSTRAINT "Bonus_Location_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: CreditTypes CreditTypes_CreatedBy_FK; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CreditTypes"
    ADD CONSTRAINT "CreditTypes_CreatedBy_FK" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID");


--
-- Name: CustomerMatch CustomerMatch_ReviewedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerMatch"
    ADD CONSTRAINT "CustomerMatch_ReviewedBy_fkey" FOREIGN KEY ("ReviewedBy") REFERENCES public."Users"("ID") ON DELETE SET NULL;


--
-- Name: EmployeeSession EmployeeSession_Location_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EmployeeSession"
    ADD CONSTRAINT "EmployeeSession_Location_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: EmployeeSession EmployeeSession_ReadingSession_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EmployeeSession"
    ADD CONSTRAINT "EmployeeSession_ReadingSession_fkey" FOREIGN KEY ("ReadingSessionId") REFERENCES public."ReadingSessions"("ID") ON DELETE RESTRICT;


--
-- Name: EmployeeSession EmployeeSession_User_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EmployeeSession"
    ADD CONSTRAINT "EmployeeSession_User_fkey" FOREIGN KEY ("UserId") REFERENCES public."Users"("ID");


--
-- Name: ExpenseTypes ExpenseTypes_CreatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExpenseTypes"
    ADD CONSTRAINT "ExpenseTypes_CreatedBy_fkey" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID");


--
-- Name: ExpenseTypes ExpenseTypes_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExpenseTypes"
    ADD CONSTRAINT "ExpenseTypes_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: CustomerMatch FK_CustomerMatch_EmployeeSession; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerMatch"
    ADD CONSTRAINT "FK_CustomerMatch_EmployeeSession" FOREIGN KEY ("EmployeeSessionId") REFERENCES public."EmployeeSession"("ID") ON DELETE SET NULL;


--
-- Name: ReadingSessionCashTransactions FK_ReadingSessionCashTransactions_CreatedBy; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingSessionCashTransactions"
    ADD CONSTRAINT "FK_ReadingSessionCashTransactions_CreatedBy" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID") ON DELETE SET NULL;


--
-- Name: ReadingSessionCashTransactions FK_ReadingSessionCashTransactions_CreditType; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingSessionCashTransactions"
    ADD CONSTRAINT "FK_ReadingSessionCashTransactions_CreditType" FOREIGN KEY ("CreditTypeId") REFERENCES public."CreditTypes"("ID") ON DELETE RESTRICT;


--
-- Name: ReadingSessionCashTransactions FK_ReadingSessionCashTransactions_ExpenseType; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingSessionCashTransactions"
    ADD CONSTRAINT "FK_ReadingSessionCashTransactions_ExpenseType" FOREIGN KEY ("ExpenseTypeId") REFERENCES public."ExpenseTypes"("ID") ON DELETE RESTRICT;


--
-- Name: ReadingSessionCashTransactions FK_ReadingSessionCashTransactions_ReadingSession; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingSessionCashTransactions"
    ADD CONSTRAINT "FK_ReadingSessionCashTransactions_ReadingSession" FOREIGN KEY ("ReadingSessionId") REFERENCES public."ReadingSessions"("ID") ON DELETE CASCADE;


--
-- Name: TicketOuts FK_TicketOuts_Customer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts"
    ADD CONSTRAINT "FK_TicketOuts_Customer" FOREIGN KEY ("CustomerId") REFERENCES public."Customer"("ID");


--
-- Name: Games Games_CompanyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Games"
    ADD CONSTRAINT "Games_CompanyId_fkey" FOREIGN KEY ("CompanyId") REFERENCES public."Companies"("ID") ON DELETE RESTRICT;


--
-- Name: Games Games_MachineTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Games"
    ADD CONSTRAINT "Games_MachineTypeId_fkey" FOREIGN KEY ("MachineTypeId") REFERENCES public."MachineTypes"("ID") ON DELETE RESTRICT;


--
-- Name: LocationCashAccounts LocationCashAccounts_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashAccounts"
    ADD CONSTRAINT "LocationCashAccounts_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: LocationCashAccounts LocationCashAccounts_UserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashAccounts"
    ADD CONSTRAINT "LocationCashAccounts_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES public."Users"("ID");


--
-- Name: LocationCashCapital LocationCashCapital_AcceptedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashCapital"
    ADD CONSTRAINT "LocationCashCapital_AcceptedBy_fkey" FOREIGN KEY ("AcceptedBy") REFERENCES public."Users"("ID");


--
-- Name: LocationCashCapital LocationCashCapital_CancelledBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashCapital"
    ADD CONSTRAINT "LocationCashCapital_CancelledBy_fkey" FOREIGN KEY ("CancelledBy") REFERENCES public."Users"("ID");


--
-- Name: LocationCashCapital LocationCashCapital_CreatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashCapital"
    ADD CONSTRAINT "LocationCashCapital_CreatedBy_fkey" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID");


--
-- Name: LocationCashCapital LocationCashCapital_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashCapital"
    ADD CONSTRAINT "LocationCashCapital_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: LocationCashCapital LocationCashCapital_ToAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashCapital"
    ADD CONSTRAINT "LocationCashCapital_ToAccountId_fkey" FOREIGN KEY ("ToAccountId") REFERENCES public."LocationCashAccounts"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_AccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_AccountId_fkey" FOREIGN KEY ("AccountId") REFERENCES public."LocationCashAccounts"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_CapitalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_CapitalId_fkey" FOREIGN KEY ("CapitalId") REFERENCES public."LocationCashCapital"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_CreatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_CreatedBy_fkey" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_ExpenseTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_ExpenseTypeId_fkey" FOREIGN KEY ("ExpenseTypeId") REFERENCES public."ExpenseTypes"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_FundingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_FundingId_fkey" FOREIGN KEY ("FundingId") REFERENCES public."AdminCashFunding"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_ReadingProfitPostingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_ReadingProfitPostingId_fkey" FOREIGN KEY ("ReadingProfitPostingId") REFERENCES public."ReadingProfitPostings"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_SessionTransactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_SessionTransactionId_fkey" FOREIGN KEY ("SessionTransactionId") REFERENCES public."SessionCashTransactions"("ID");


--
-- Name: LocationCashEntries LocationCashEntries_TransferId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashEntries"
    ADD CONSTRAINT "LocationCashEntries_TransferId_fkey" FOREIGN KEY ("TransferId") REFERENCES public."LocationCashTransfers"("ID");


--
-- Name: LocationCashTransfers LocationCashTransfers_AcceptedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashTransfers"
    ADD CONSTRAINT "LocationCashTransfers_AcceptedBy_fkey" FOREIGN KEY ("AcceptedBy") REFERENCES public."Users"("ID");


--
-- Name: LocationCashTransfers LocationCashTransfers_CancelledBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashTransfers"
    ADD CONSTRAINT "LocationCashTransfers_CancelledBy_fkey" FOREIGN KEY ("CancelledBy") REFERENCES public."Users"("ID");


--
-- Name: LocationCashTransfers LocationCashTransfers_CreatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashTransfers"
    ADD CONSTRAINT "LocationCashTransfers_CreatedBy_fkey" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID");


--
-- Name: LocationCashTransfers LocationCashTransfers_FromAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashTransfers"
    ADD CONSTRAINT "LocationCashTransfers_FromAccountId_fkey" FOREIGN KEY ("FromAccountId") REFERENCES public."LocationCashAccounts"("ID");


--
-- Name: LocationCashTransfers LocationCashTransfers_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashTransfers"
    ADD CONSTRAINT "LocationCashTransfers_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: LocationCashTransfers LocationCashTransfers_ToAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LocationCashTransfers"
    ADD CONSTRAINT "LocationCashTransfers_ToAccountId_fkey" FOREIGN KEY ("ToAccountId") REFERENCES public."LocationCashAccounts"("ID");


--
-- Name: Locations Locations_CompanyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Locations"
    ADD CONSTRAINT "Locations_CompanyId_fkey" FOREIGN KEY ("CompanyId") REFERENCES public."Companies"("ID") ON DELETE RESTRICT;


--
-- Name: LuckyBirdAwards LuckyBirdAwards_LuckyBirdId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdAwards"
    ADD CONSTRAINT "LuckyBirdAwards_LuckyBirdId_fkey" FOREIGN KEY ("LuckyBirdId") REFERENCES public."LuckyBird"("ID");


--
-- Name: LuckyBirdAwards LuckyBirdAwards_LuckyBirdPayoutId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdAwards"
    ADD CONSTRAINT "LuckyBirdAwards_LuckyBirdPayoutId_fkey" FOREIGN KEY ("LuckyBirdPayoutId") REFERENCES public."LuckyBirdPayout"("ID");


--
-- Name: LuckyBirdPayout LuckyBirdPayout_LuckyBirdId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdPayout"
    ADD CONSTRAINT "LuckyBirdPayout_LuckyBirdId_fkey" FOREIGN KEY ("LuckyBirdId") REFERENCES public."LuckyBird"("ID") ON DELETE CASCADE;


--
-- Name: LuckyBirdScheduleBlock LuckyBirdScheduleBlock_LuckyBirdId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdScheduleBlock"
    ADD CONSTRAINT "LuckyBirdScheduleBlock_LuckyBirdId_fkey" FOREIGN KEY ("LuckyBirdId") REFERENCES public."LuckyBird"("ID") ON DELETE CASCADE;


--
-- Name: LuckyBirdScheduleDay LuckyBirdScheduleDay_ScheduleBlockId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LuckyBirdScheduleDay"
    ADD CONSTRAINT "LuckyBirdScheduleDay_ScheduleBlockId_fkey" FOREIGN KEY ("ScheduleBlockId") REFERENCES public."LuckyBirdScheduleBlock"("ID") ON DELETE CASCADE;


--
-- Name: MachineLogs MachineLogs_ChangedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineLogs"
    ADD CONSTRAINT "MachineLogs_ChangedBy_fkey" FOREIGN KEY ("ChangedBy") REFERENCES public."Users"("ID") ON DELETE SET NULL;


--
-- Name: MachineLogs MachineLogs_MachineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineLogs"
    ADD CONSTRAINT "MachineLogs_MachineId_fkey" FOREIGN KEY ("MachineId") REFERENCES public."Machines"("ID") ON DELETE CASCADE;


--
-- Name: MachineReadings MachineReadings_MachineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineReadings"
    ADD CONSTRAINT "MachineReadings_MachineId_fkey" FOREIGN KEY ("MachineId") REFERENCES public."Machines"("ID");


--
-- Name: MachineReadings MachineReadings_SessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineReadings"
    ADD CONSTRAINT "MachineReadings_SessionId_fkey" FOREIGN KEY ("SessionId") REFERENCES public."ReadingSessions"("ID");


--
-- Name: MachineTypes MachineTypes_CompanyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineTypes"
    ADD CONSTRAINT "MachineTypes_CompanyId_fkey" FOREIGN KEY ("CompanyId") REFERENCES public."Companies"("ID") ON DELETE RESTRICT;


--
-- Name: Machines Machines_GameId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Machines"
    ADD CONSTRAINT "Machines_GameId_fkey" FOREIGN KEY ("GameId") REFERENCES public."Games"("ID") ON DELETE SET NULL;


--
-- Name: Machines Machines_MachineTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Machines"
    ADD CONSTRAINT "Machines_MachineTypeId_fkey" FOREIGN KEY ("MachineTypeId") REFERENCES public."MachineTypes"("ID") ON DELETE RESTRICT;


--
-- Name: Machines Machines_StatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Machines"
    ADD CONSTRAINT "Machines_StatusId_fkey" FOREIGN KEY ("StatusId") REFERENCES public."MachineStatus"("ID") ON DELETE RESTRICT;


--
-- Name: Machines Machines_UpdatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Machines"
    ADD CONSTRAINT "Machines_UpdatedBy_fkey" FOREIGN KEY ("UpdatedBy") REFERENCES public."Users"("ID") ON DELETE SET NULL;


--
-- Name: Machines Machines_locationid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Machines"
    ADD CONSTRAINT "Machines_locationid_fkey" FOREIGN KEY (locationid) REFERENCES public."Locations"("ID") ON DELETE RESTRICT;


--
-- Name: PromotionAuditLogs PromotionAuditLogs_PromotionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionAuditLogs"
    ADD CONSTRAINT "PromotionAuditLogs_PromotionId_fkey" FOREIGN KEY ("PromotionId") REFERENCES public."Promotions"("ID") ON DELETE CASCADE;


--
-- Name: PromotionAuditLogs PromotionAuditLogs_TemplateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionAuditLogs"
    ADD CONSTRAINT "PromotionAuditLogs_TemplateId_fkey" FOREIGN KEY ("TemplateId") REFERENCES public."PromotionTemplates"("ID") ON DELETE SET NULL;


--
-- Name: PromotionDeliveryLogs PromotionDeliveryLogs_PromotionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionDeliveryLogs"
    ADD CONSTRAINT "PromotionDeliveryLogs_PromotionId_fkey" FOREIGN KEY ("PromotionId") REFERENCES public."Promotions"("ID") ON DELETE CASCADE;


--
-- Name: PromotionDeliveryLogs PromotionDeliveryLogs_PromotionRecipientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionDeliveryLogs"
    ADD CONSTRAINT "PromotionDeliveryLogs_PromotionRecipientId_fkey" FOREIGN KEY ("PromotionRecipientId") REFERENCES public."PromotionRecipients"("ID") ON DELETE SET NULL;


--
-- Name: PromotionRecipients PromotionRecipients_PromotionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionRecipients"
    ADD CONSTRAINT "PromotionRecipients_PromotionId_fkey" FOREIGN KEY ("PromotionId") REFERENCES public."Promotions"("ID") ON DELETE CASCADE;


--
-- Name: PromotionTemplates PromotionTemplates_SourceTemplateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionTemplates"
    ADD CONSTRAINT "PromotionTemplates_SourceTemplateId_fkey" FOREIGN KEY ("SourceTemplateId") REFERENCES public."PromotionTemplates"("ID");


--
-- Name: Promotions Promotions_TemplateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Promotions"
    ADD CONSTRAINT "Promotions_TemplateId_fkey" FOREIGN KEY ("TemplateId") REFERENCES public."PromotionTemplates"("ID");


--
-- Name: RaffleAttempts RaffleAttempts_RaffleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RaffleAttempts"
    ADD CONSTRAINT "RaffleAttempts_RaffleId_fkey" FOREIGN KEY ("RaffleId") REFERENCES public."Raffles"("ID") ON DELETE CASCADE;


--
-- Name: Raffles Raffles_ReviewedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Raffles"
    ADD CONSTRAINT "Raffles_ReviewedBy_fkey" FOREIGN KEY ("ReviewedBy") REFERENCES public."Users"("ID") ON DELETE SET NULL;


--
-- Name: ReadingProfitPostings ReadingProfitPostings_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingProfitPostings"
    ADD CONSTRAINT "ReadingProfitPostings_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: ReadingProfitPostings ReadingProfitPostings_PostedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReadingProfitPostings"
    ADD CONSTRAINT "ReadingProfitPostings_PostedBy_fkey" FOREIGN KEY ("PostedBy") REFERENCES public."Users"("ID");


--
-- Name: RolePermissions RolePermissions_Permission_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RolePermissions"
    ADD CONSTRAINT "RolePermissions_Permission_fkey" FOREIGN KEY ("PermissionId") REFERENCES public."Permissions"("ID") ON DELETE CASCADE;


--
-- Name: RolePermissions RolePermissions_Role_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RolePermissions"
    ADD CONSTRAINT "RolePermissions_Role_fkey" FOREIGN KEY ("RoleId") REFERENCES public."Roles"("ID") ON DELETE CASCADE;


--
-- Name: SessionCashClosings SessionCashClosings_ClosedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashClosings"
    ADD CONSTRAINT "SessionCashClosings_ClosedBy_fkey" FOREIGN KEY ("ClosedBy") REFERENCES public."Users"("ID");


--
-- Name: SessionCashClosings SessionCashClosings_HandoverId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashClosings"
    ADD CONSTRAINT "SessionCashClosings_HandoverId_fkey" FOREIGN KEY ("HandoverId") REFERENCES public."SessionCashHandovers"("ID");


--
-- Name: SessionCashClosings SessionCashClosings_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashClosings"
    ADD CONSTRAINT "SessionCashClosings_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: SessionCashClosings SessionCashClosings_SessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashClosings"
    ADD CONSTRAINT "SessionCashClosings_SessionId_fkey" FOREIGN KEY ("SessionId") REFERENCES public."EmployeeSession"("ID");


--
-- Name: SessionCashHandovers SessionCashHandovers_AcceptedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashHandovers"
    ADD CONSTRAINT "SessionCashHandovers_AcceptedBy_fkey" FOREIGN KEY ("AcceptedBy") REFERENCES public."Users"("ID");


--
-- Name: SessionCashHandovers SessionCashHandovers_FromSessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashHandovers"
    ADD CONSTRAINT "SessionCashHandovers_FromSessionId_fkey" FOREIGN KEY ("FromSessionId") REFERENCES public."EmployeeSession"("ID");


--
-- Name: SessionCashHandovers SessionCashHandovers_FromUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashHandovers"
    ADD CONSTRAINT "SessionCashHandovers_FromUserId_fkey" FOREIGN KEY ("FromUserId") REFERENCES public."Users"("ID");


--
-- Name: SessionCashHandovers SessionCashHandovers_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashHandovers"
    ADD CONSTRAINT "SessionCashHandovers_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: SessionCashHandovers SessionCashHandovers_ToSessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashHandovers"
    ADD CONSTRAINT "SessionCashHandovers_ToSessionId_fkey" FOREIGN KEY ("ToSessionId") REFERENCES public."EmployeeSession"("ID");


--
-- Name: SessionCashHandovers SessionCashHandovers_ToUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashHandovers"
    ADD CONSTRAINT "SessionCashHandovers_ToUserId_fkey" FOREIGN KEY ("ToUserId") REFERENCES public."Users"("ID");


--
-- Name: SessionCashTransactions SessionCashTransactions_AdminFundingFK; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashTransactions"
    ADD CONSTRAINT "SessionCashTransactions_AdminFundingFK" FOREIGN KEY ("FundingId") REFERENCES public."AdminCashFunding"("ID");


--
-- Name: SessionCashTransactions SessionCashTransactions_CreatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashTransactions"
    ADD CONSTRAINT "SessionCashTransactions_CreatedBy_fkey" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID");


--
-- Name: SessionCashTransactions SessionCashTransactions_CreditTypeId_FK; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashTransactions"
    ADD CONSTRAINT "SessionCashTransactions_CreditTypeId_FK" FOREIGN KEY ("CreditTypeId") REFERENCES public."CreditTypes"("ID");


--
-- Name: SessionCashTransactions SessionCashTransactions_ExpenseTypeFK; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashTransactions"
    ADD CONSTRAINT "SessionCashTransactions_ExpenseTypeFK" FOREIGN KEY ("ExpenseTypeId", "LocationId") REFERENCES public."ExpenseTypes"("ID", "LocationId");


--
-- Name: SessionCashTransactions SessionCashTransactions_HandoverFK; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashTransactions"
    ADD CONSTRAINT "SessionCashTransactions_HandoverFK" FOREIGN KEY ("TransferId") REFERENCES public."SessionCashHandovers"("ID");


--
-- Name: SessionCashTransactions SessionCashTransactions_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashTransactions"
    ADD CONSTRAINT "SessionCashTransactions_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: SessionCashTransactions SessionCashTransactions_SessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionCashTransactions"
    ADD CONSTRAINT "SessionCashTransactions_SessionId_fkey" FOREIGN KEY ("SessionId") REFERENCES public."EmployeeSession"("ID");


--
-- Name: TicketOuts TicketOuts_CreatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts"
    ADD CONSTRAINT "TicketOuts_CreatedBy_fkey" FOREIGN KEY ("CreatedBy") REFERENCES public."Users"("ID");


--
-- Name: TicketOuts TicketOuts_EmployeeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts"
    ADD CONSTRAINT "TicketOuts_EmployeeId_fkey" FOREIGN KEY ("EmployeeId") REFERENCES public."Users"("ID");


--
-- Name: TicketOuts TicketOuts_EmployeeSessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts"
    ADD CONSTRAINT "TicketOuts_EmployeeSessionId_fkey" FOREIGN KEY ("EmployeeSessionId") REFERENCES public."EmployeeSession"("ID");


--
-- Name: TicketOuts TicketOuts_LocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts"
    ADD CONSTRAINT "TicketOuts_LocationId_fkey" FOREIGN KEY ("LocationId") REFERENCES public."Locations"("ID");


--
-- Name: TicketOuts TicketOuts_MachineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts"
    ADD CONSTRAINT "TicketOuts_MachineId_fkey" FOREIGN KEY ("MachineId") REFERENCES public."Machines"("ID");


--
-- Name: TicketOuts TicketOuts_SessionTransactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketOuts"
    ADD CONSTRAINT "TicketOuts_SessionTransactionId_fkey" FOREIGN KEY ("SessionTransactionId") REFERENCES public."SessionCashTransactions"("ID");


--
-- Name: Users Users_RoleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Users"
    ADD CONSTRAINT "Users_RoleId_fkey" FOREIGN KEY ("RoleId") REFERENCES public."Roles"("ID");


--
-- Name: Users Users_Role_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Users"
    ADD CONSTRAINT "Users_Role_fkey" FOREIGN KEY ("RoleId") REFERENCES public."Roles"("ID");


--
-- PostgreSQL database dump complete
--

\unrestrict hIVZbrn0NFigTURqnt30hlfFtQitFoGXwJUUVmlZGRjUob1Qee2apWTBeEChIBs

