CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"target" jsonb NOT NULL,
	"content" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_report_id_idempotency_key_unique" UNIQUE("report_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "report_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"triggering_message_id" uuid NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"changes" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_revisions" ADD CONSTRAINT "report_revisions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_revisions" ADD CONSTRAINT "report_revisions_triggering_message_id_conversation_messages_id_fk" FOREIGN KEY ("triggering_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_report_id_created_at_idx" ON "conversation_messages" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "report_revisions_report_id_created_at_idx" ON "report_revisions" USING btree ("report_id","created_at");
--> statement-breakpoint
COMMENT ON TABLE "conversation_messages" IS '报告质疑会话消息';
COMMENT ON COLUMN "conversation_messages"."id" IS '会话消息唯一标识';
COMMENT ON COLUMN "conversation_messages"."report_id" IS '所属报告标识';
COMMENT ON COLUMN "conversation_messages"."user_id" IS '消息所属用户标识';
COMMENT ON COLUMN "conversation_messages"."role" IS '消息角色';
COMMENT ON COLUMN "conversation_messages"."target" IS '定向报告条目';
COMMENT ON COLUMN "conversation_messages"."content" IS '消息内容';
COMMENT ON COLUMN "conversation_messages"."status" IS '修订处理状态';
COMMENT ON COLUMN "conversation_messages"."idempotency_key" IS '客户端幂等键';
COMMENT ON COLUMN "conversation_messages"."created_at" IS '消息创建时间';
COMMENT ON COLUMN "conversation_messages"."updated_at" IS '消息最近更新时间';
--> statement-breakpoint
COMMENT ON TABLE "report_revisions" IS '报告修订记录';
COMMENT ON COLUMN "report_revisions"."id" IS '修订唯一标识';
COMMENT ON COLUMN "report_revisions"."report_id" IS '所属报告标识';
COMMENT ON COLUMN "report_revisions"."triggering_message_id" IS '触发修订的会话消息标识';
COMMENT ON COLUMN "report_revisions"."from_version" IS '修订前报告版本';
COMMENT ON COLUMN "report_revisions"."to_version" IS '修订后报告版本';
COMMENT ON COLUMN "report_revisions"."changes" IS '结构化修订内容';
COMMENT ON COLUMN "report_revisions"."status" IS '修订处理状态';
COMMENT ON COLUMN "report_revisions"."created_at" IS '修订创建时间';
COMMENT ON COLUMN "report_revisions"."updated_at" IS '修订最近更新时间';
