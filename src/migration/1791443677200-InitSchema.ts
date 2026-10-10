import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1791443677200 implements MigrationInterface {
    name = 'InitSchema1791443677200'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "service"."roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(40) NOT NULL, "name" character varying(60) NOT NULL, "description" text, "isSystem" boolean NOT NULL DEFAULT false, "createTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updateTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_roles_code" ON "service"."roles" ("code") `);
        await queryRunner.query(`CREATE TABLE "service"."user_roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "roleId" uuid NOT NULL, "scopeType" character varying(20) NOT NULL DEFAULT 'global', "scopeId" character varying(64) NOT NULL DEFAULT '', "createTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_user_roles_user_role_scope" UNIQUE ("userId", "roleId", "scopeType", "scopeId"), CONSTRAINT "PK_8acd5cf26ebd158416f477de799" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_user_roles_user" ON "service"."user_roles" ("userId") `);
        await queryRunner.query(`CREATE TABLE "service"."users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(160), "phone" character varying(20), "password" text NOT NULL, "displayName" character varying(50) NOT NULL, "avatar" text, "bio" text, "status" character varying(20) NOT NULL DEFAULT 'active', "emailVerifiedAt" TIMESTAMP WITH TIME ZONE, "phoneVerifiedAt" TIMESTAMP WITH TIME ZONE, "lastLoginAt" TIMESTAMP WITH TIME ZONE, "createTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updateTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleteTime" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_users_email" ON "service"."users" ("email") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_users_phone" ON "service"."users" ("phone") `);
        await queryRunner.query(`CREATE TABLE "service"."user_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "refreshTokenHash" character varying(128) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "userAgent" character varying(400), "ip" character varying(45), "createTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e93e031a5fed190d4789b6bfd83" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_user" ON "service"."user_sessions" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_user_sessions_token" ON "service"."user_sessions" ("refreshTokenHash") `);
        await queryRunner.query(`CREATE TABLE "service"."system_configs" ("key" character varying(80) NOT NULL, "value" jsonb, "description" character varying(255), "updateTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5aff9a6d272a5cedf54d7aaf617" PRIMARY KEY ("key"))`);
        await queryRunner.query(`CREATE TABLE "service"."otp" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "identifier" character varying(160) NOT NULL, "channel" character varying(10) NOT NULL DEFAULT 'email', "purpose" character varying(20) NOT NULL DEFAULT 'register', "code" character varying(10) NOT NULL, "expireAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', "createTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_32556d9d7b22031d7d0e1fd6723" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_otp_identifier_purpose" ON "service"."otp" ("identifier", "purpose") `);
        await queryRunner.query(`CREATE TABLE "service"."legal_documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(40) NOT NULL, "version" character varying(20) NOT NULL, "effectiveDate" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "content" jsonb, "contentHtml" text NOT NULL DEFAULT '', "lang" character varying(10) NOT NULL DEFAULT 'zh', "isActive" boolean NOT NULL DEFAULT true, "createTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updateTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_846b11262368906ded5d26ac271" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_legal_documents_active" ON "service"."legal_documents" ("isActive") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_legal_documents_type_version" ON "service"."legal_documents" ("type", "version") `);
        await queryRunner.query(`CREATE TABLE "service"."audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "adminName" character varying(100) NOT NULL, "userId" uuid, "action" character varying(255) NOT NULL, "module" character varying(50), "targetType" character varying(50), "targetId" character varying(64), "status" character varying(20) NOT NULL DEFAULT 'success', "reason" text, "ip" character varying(45), "details" jsonb, "createTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_audit_logs_user" ON "service"."audit_logs" ("userId") `);
        await queryRunner.query(`CREATE INDEX "idx_audit_logs_create_time" ON "service"."audit_logs" ("createTime") `);
        await queryRunner.query(`CREATE TABLE "service"."attachments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "originalName" character varying(255) NOT NULL, "filename" character varying(255) NOT NULL, "mimeType" character varying(160), "size" bigint NOT NULL DEFAULT '0', "storageKey" text NOT NULL, "url" text NOT NULL, "type" character varying(20) NOT NULL, "category" character varying(20) NOT NULL DEFAULT 'custom', "purpose" character varying(40) NOT NULL DEFAULT 'generic', "uploaderId" uuid, "createTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_attachments_purpose" ON "service"."attachments" ("purpose") `);
        await queryRunner.query(`ALTER TABLE "service"."user_roles" ADD CONSTRAINT "FK_472b25323af01488f1f66a06b67" FOREIGN KEY ("userId") REFERENCES "service"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "service"."user_roles" ADD CONSTRAINT "FK_86033897c009fcca8b6505d6be2" FOREIGN KEY ("roleId") REFERENCES "service"."roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "service"."user_sessions" ADD CONSTRAINT "FK_55fa4db8406ed66bc7044328427" FOREIGN KEY ("userId") REFERENCES "service"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "service"."attachments" ADD CONSTRAINT "FK_b8f8cb9f55776d30ebd6dc779ee" FOREIGN KEY ("uploaderId") REFERENCES "service"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "service"."attachments" DROP CONSTRAINT "FK_b8f8cb9f55776d30ebd6dc779ee"`);
        await queryRunner.query(`ALTER TABLE "service"."user_sessions" DROP CONSTRAINT "FK_55fa4db8406ed66bc7044328427"`);
        await queryRunner.query(`ALTER TABLE "service"."user_roles" DROP CONSTRAINT "FK_86033897c009fcca8b6505d6be2"`);
        await queryRunner.query(`ALTER TABLE "service"."user_roles" DROP CONSTRAINT "FK_472b25323af01488f1f66a06b67"`);
        await queryRunner.query(`DROP INDEX "service"."idx_attachments_purpose"`);
        await queryRunner.query(`DROP TABLE "service"."attachments"`);
        await queryRunner.query(`DROP INDEX "service"."idx_audit_logs_create_time"`);
        await queryRunner.query(`DROP INDEX "service"."idx_audit_logs_user"`);
        await queryRunner.query(`DROP TABLE "service"."audit_logs"`);
        await queryRunner.query(`DROP INDEX "service"."idx_legal_documents_type_version"`);
        await queryRunner.query(`DROP INDEX "service"."idx_legal_documents_active"`);
        await queryRunner.query(`DROP TABLE "service"."legal_documents"`);
        await queryRunner.query(`DROP INDEX "service"."idx_otp_identifier_purpose"`);
        await queryRunner.query(`DROP TABLE "service"."otp"`);
        await queryRunner.query(`DROP TABLE "service"."system_configs"`);
        await queryRunner.query(`DROP INDEX "service"."idx_user_sessions_token"`);
        await queryRunner.query(`DROP INDEX "service"."idx_user_sessions_user"`);
        await queryRunner.query(`DROP TABLE "service"."user_sessions"`);
        await queryRunner.query(`DROP INDEX "service"."idx_users_phone"`);
        await queryRunner.query(`DROP INDEX "service"."idx_users_email"`);
        await queryRunner.query(`DROP TABLE "service"."users"`);
        await queryRunner.query(`DROP INDEX "service"."idx_user_roles_user"`);
        await queryRunner.query(`DROP TABLE "service"."user_roles"`);
        await queryRunner.query(`DROP INDEX "service"."idx_roles_code"`);
        await queryRunner.query(`DROP TABLE "service"."roles"`);
    }

}
