CREATE TABLE "analysis_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"status" text NOT NULL,
	"config_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"trigger_run_id" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_jobs_user_id_idempotency_key_unique" UNIQUE("user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "analysis_materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"character_count" integer NOT NULL,
	"detected_language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expert_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"expert_type" text NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer NOT NULL,
	"config_version" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_runs_job_id_expert_type_phase_attempt_unique" UNIQUE("job_id","expert_type","phase","attempt")
);
--> statement-breakpoint
CREATE TABLE "product_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"event_name" text NOT NULL,
	"event_key" text NOT NULL,
	"properties" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_events_user_id_event_name_event_key_unique" UNIQUE("user_id","event_name","event_key")
);
--> statement-breakpoint
CREATE TABLE "report_modules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"module_type" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"error_code" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_modules_report_id_module_type_unique" UNIQUE("report_id","module_type")
);
--> statement-breakpoint
CREATE TABLE "report_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text,
	"domain" text,
	"publisher" text,
	"published_at" timestamp with time zone,
	"quality_tier" text,
	"excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_sources_report_id_source_key_unique" UNIQUE("report_id","source_key")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"baseline_version" integer NOT NULL,
	"current_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempt_count" integer NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"normalized_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_normalized_username_unique" UNIQUE("normalized_username")
);
--> statement-breakpoint
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_job_id_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_material_id_analysis_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."analysis_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_materials" ADD CONSTRAINT "analysis_materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_runs" ADD CONSTRAINT "expert_runs_job_id_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_job_id_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_modules" ADD CONSTRAINT "report_modules_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_job_id_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_events_job_id_id_idx" ON "analysis_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE INDEX "product_events_event_name_created_at_idx" ON "product_events" USING btree ("event_name","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions" USING btree ("user_id","revoked_at");
--> statement-breakpoint
COMMENT ON TABLE "analysis_events" IS '分析任务事件流';
COMMENT ON COLUMN "analysis_events"."id" IS '事件递增标识';
COMMENT ON COLUMN "analysis_events"."job_id" IS '所属分析任务标识';
COMMENT ON COLUMN "analysis_events"."user_id" IS '任务所属用户标识';
COMMENT ON COLUMN "analysis_events"."event_type" IS '事件类型';
COMMENT ON COLUMN "analysis_events"."payload" IS '事件载荷';
COMMENT ON COLUMN "analysis_events"."created_at" IS '事件创建时间';

COMMENT ON TABLE "analysis_jobs" IS '分析任务';
COMMENT ON COLUMN "analysis_jobs"."id" IS '分析任务唯一标识';
COMMENT ON COLUMN "analysis_jobs"."user_id" IS '提交任务的用户标识';
COMMENT ON COLUMN "analysis_jobs"."material_id" IS '待分析材料标识';
COMMENT ON COLUMN "analysis_jobs"."status" IS '任务当前状态';
COMMENT ON COLUMN "analysis_jobs"."config_version" IS '任务使用的配置版本';
COMMENT ON COLUMN "analysis_jobs"."idempotency_key" IS '用户维度的幂等键';
COMMENT ON COLUMN "analysis_jobs"."trigger_run_id" IS '后台任务平台运行标识';
COMMENT ON COLUMN "analysis_jobs"."failure_code" IS '任务失败错误码';
COMMENT ON COLUMN "analysis_jobs"."created_at" IS '任务创建时间';
COMMENT ON COLUMN "analysis_jobs"."started_at" IS '任务开始执行时间';
COMMENT ON COLUMN "analysis_jobs"."completed_at" IS '任务完成时间';
COMMENT ON COLUMN "analysis_jobs"."updated_at" IS '任务最近更新时间';

COMMENT ON TABLE "analysis_materials" IS '待分析的原始材料';
COMMENT ON COLUMN "analysis_materials"."id" IS '材料唯一标识';
COMMENT ON COLUMN "analysis_materials"."user_id" IS '材料所属用户标识';
COMMENT ON COLUMN "analysis_materials"."content" IS '待分析原始文本';
COMMENT ON COLUMN "analysis_materials"."character_count" IS '原始文本字符数';
COMMENT ON COLUMN "analysis_materials"."detected_language" IS '识别出的文本语言';
COMMENT ON COLUMN "analysis_materials"."created_at" IS '材料创建时间';

COMMENT ON TABLE "expert_runs" IS '分析专家执行记录';
COMMENT ON COLUMN "expert_runs"."id" IS '专家执行唯一标识';
COMMENT ON COLUMN "expert_runs"."job_id" IS '所属分析任务标识';
COMMENT ON COLUMN "expert_runs"."expert_type" IS '专家类型';
COMMENT ON COLUMN "expert_runs"."phase" IS '任务执行阶段';
COMMENT ON COLUMN "expert_runs"."status" IS '专家执行状态';
COMMENT ON COLUMN "expert_runs"."attempt" IS '同阶段重试次数';
COMMENT ON COLUMN "expert_runs"."config_version" IS '执行使用的配置版本';
COMMENT ON COLUMN "expert_runs"."input_tokens" IS '模型输入 Token 数';
COMMENT ON COLUMN "expert_runs"."output_tokens" IS '模型输出 Token 数';
COMMENT ON COLUMN "expert_runs"."estimated_cost_usd" IS '预估模型调用成本（美元）';
COMMENT ON COLUMN "expert_runs"."latency_ms" IS '执行耗时（毫秒）';
COMMENT ON COLUMN "expert_runs"."error_code" IS '执行失败错误码';
COMMENT ON COLUMN "expert_runs"."created_at" IS '执行记录创建时间';
COMMENT ON COLUMN "expert_runs"."started_at" IS '执行开始时间';
COMMENT ON COLUMN "expert_runs"."completed_at" IS '执行完成时间';
COMMENT ON COLUMN "expert_runs"."updated_at" IS '执行记录最近更新时间';

COMMENT ON TABLE "product_events" IS '产品行为事件';
COMMENT ON COLUMN "product_events"."id" IS '事件递增标识';
COMMENT ON COLUMN "product_events"."user_id" IS '触发事件的用户标识';
COMMENT ON COLUMN "product_events"."job_id" IS '关联分析任务标识';
COMMENT ON COLUMN "product_events"."event_name" IS '事件名称';
COMMENT ON COLUMN "product_events"."event_key" IS '事件去重键';
COMMENT ON COLUMN "product_events"."properties" IS '事件属性';
COMMENT ON COLUMN "product_events"."created_at" IS '事件创建时间';

COMMENT ON TABLE "report_modules" IS '分析报告模块';
COMMENT ON COLUMN "report_modules"."id" IS '报告模块唯一标识';
COMMENT ON COLUMN "report_modules"."report_id" IS '所属报告标识';
COMMENT ON COLUMN "report_modules"."module_type" IS '报告模块类型';
COMMENT ON COLUMN "report_modules"."status" IS '模块生成状态';
COMMENT ON COLUMN "report_modules"."payload" IS '模块结构化内容';
COMMENT ON COLUMN "report_modules"."error_code" IS '模块生成失败错误码';
COMMENT ON COLUMN "report_modules"."version" IS '模块内容版本号';
COMMENT ON COLUMN "report_modules"."created_at" IS '模块创建时间';
COMMENT ON COLUMN "report_modules"."updated_at" IS '模块最近更新时间';

COMMENT ON TABLE "report_sources" IS '分析报告引用来源';
COMMENT ON COLUMN "report_sources"."id" IS '来源记录唯一标识';
COMMENT ON COLUMN "report_sources"."report_id" IS '所属报告标识';
COMMENT ON COLUMN "report_sources"."source_key" IS '报告内来源唯一键';
COMMENT ON COLUMN "report_sources"."title" IS '来源标题';
COMMENT ON COLUMN "report_sources"."url" IS '原始来源地址';
COMMENT ON COLUMN "report_sources"."canonical_url" IS '规范化来源地址';
COMMENT ON COLUMN "report_sources"."domain" IS '来源域名';
COMMENT ON COLUMN "report_sources"."publisher" IS '来源发布方';
COMMENT ON COLUMN "report_sources"."published_at" IS '来源发布时间';
COMMENT ON COLUMN "report_sources"."quality_tier" IS '来源质量等级';
COMMENT ON COLUMN "report_sources"."excerpt" IS '来源摘要';
COMMENT ON COLUMN "report_sources"."created_at" IS '来源记录创建时间';
COMMENT ON COLUMN "report_sources"."updated_at" IS '来源记录最近更新时间';

COMMENT ON TABLE "reports" IS '分析报告';
COMMENT ON COLUMN "reports"."id" IS '报告唯一标识';
COMMENT ON COLUMN "reports"."job_id" IS '关联分析任务标识';
COMMENT ON COLUMN "reports"."user_id" IS '报告所属用户标识';
COMMENT ON COLUMN "reports"."baseline_version" IS '报告基线版本号';
COMMENT ON COLUMN "reports"."current_version" IS '报告当前版本号';
COMMENT ON COLUMN "reports"."created_at" IS '报告创建时间';
COMMENT ON COLUMN "reports"."updated_at" IS '报告最近更新时间';

COMMENT ON TABLE "auth_rate_limits" IS '认证操作限流状态';
COMMENT ON COLUMN "auth_rate_limits"."key" IS '限流维度唯一键';
COMMENT ON COLUMN "auth_rate_limits"."action" IS '受限认证操作';
COMMENT ON COLUMN "auth_rate_limits"."window_started_at" IS '当前限流窗口开始时间';
COMMENT ON COLUMN "auth_rate_limits"."attempt_count" IS '当前窗口尝试次数';
COMMENT ON COLUMN "auth_rate_limits"."blocked_until" IS '限流解除时间';
COMMENT ON COLUMN "auth_rate_limits"."updated_at" IS '限流状态最近更新时间';

COMMENT ON TABLE "password_credentials" IS '用户密码凭据';
COMMENT ON COLUMN "password_credentials"."user_id" IS '用户标识';
COMMENT ON COLUMN "password_credentials"."password_hash" IS '不可逆密码哈希';
COMMENT ON COLUMN "password_credentials"."updated_at" IS '密码最近更新时间';

COMMENT ON TABLE "sessions" IS '用户登录会话';
COMMENT ON COLUMN "sessions"."id" IS '会话唯一标识';
COMMENT ON COLUMN "sessions"."user_id" IS '会话所属用户标识';
COMMENT ON COLUMN "sessions"."token_hash" IS '不可逆会话令牌哈希';
COMMENT ON COLUMN "sessions"."idle_expires_at" IS '空闲超时时间';
COMMENT ON COLUMN "sessions"."absolute_expires_at" IS '绝对过期时间';
COMMENT ON COLUMN "sessions"."last_seen_at" IS '最近访问时间';
COMMENT ON COLUMN "sessions"."revoked_at" IS '会话撤销时间';
COMMENT ON COLUMN "sessions"."created_at" IS '会话创建时间';

COMMENT ON TABLE "users" IS '用户账户';
COMMENT ON COLUMN "users"."id" IS '用户唯一标识';
COMMENT ON COLUMN "users"."username" IS '用户展示名称';
COMMENT ON COLUMN "users"."normalized_username" IS '用于唯一性校验的规范化用户名';
COMMENT ON COLUMN "users"."created_at" IS '用户创建时间';
