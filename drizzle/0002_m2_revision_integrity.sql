ALTER TABLE "conversation_messages" ADD COLUMN "lease_id" text;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "report_modules" AS "module"
SET "payload" = jsonb_set(
	"module"."payload",
	'{items}',
	COALESCE(
		(
			SELECT jsonb_agg(
				CASE
					WHEN NULLIF("risk"."item"->>'id', '') IS NULL THEN
						"risk"."item" || jsonb_build_object(
							'id',
							'migrated-risk-' || md5(
								"module"."report_id"::text || ':' ||
								"risk"."item"::text || ':' ||
								"risk"."ordinality"::text
							)
						)
					ELSE "risk"."item"
				END
				ORDER BY "risk"."ordinality"
			)
			FROM jsonb_array_elements("module"."payload"->'items')
				WITH ORDINALITY AS "risk"("item", "ordinality")
		),
		'[]'::jsonb
	)
)
WHERE "module"."module_type" = 'risks'
	AND jsonb_typeof("module"."payload"->'items') = 'array';--> statement-breakpoint
COMMENT ON COLUMN "conversation_messages"."lease_id" IS '当前修订执行租约标识';--> statement-breakpoint
COMMENT ON COLUMN "conversation_messages"."lease_expires_at" IS '当前修订执行租约到期时间';
