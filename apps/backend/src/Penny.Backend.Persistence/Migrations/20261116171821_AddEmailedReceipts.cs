using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailedReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "receipt_mail_addresses",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    local_part_hash = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    encryption_version = table.Column<short>(
                        type: "smallint",
                        nullable: false,
                        defaultValue: (short)1
                    ),
                    key_salt = table.Column<byte[]>(type: "bytea", nullable: false),
                    address_nonce = table.Column<byte[]>(type: "bytea", nullable: false),
                    address_encrypted = table.Column<byte[]>(type: "bytea", nullable: false),
                    allowed_senders_nonce = table.Column<byte[]>(type: "bytea", nullable: false),
                    allowed_senders_encrypted = table.Column<byte[]>(
                        type: "bytea",
                        nullable: false
                    ),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    revoked_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    last_received_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_receipt_mail_addresses", x => x.id);
                    table.CheckConstraint(
                        "ck_receipt_mail_addresses_encryption_version",
                        "encryption_version = 1"
                    );
                    table.CheckConstraint(
                        "ck_receipt_mail_addresses_expiry",
                        "expires_at > created_at"
                    );
                    table.CheckConstraint(
                        "ck_receipt_mail_addresses_hash",
                        "local_part_hash ~ '^[0-9a-f]{64}$'"
                    );
                    table.CheckConstraint(
                        "ck_receipt_mail_addresses_key_salt",
                        "length(key_salt) = 32"
                    );
                    table.CheckConstraint(
                        "ck_receipt_mail_addresses_nonces",
                        "length(address_nonce) = 12 AND length(allowed_senders_nonce) = 12"
                    );
                    table.ForeignKey(
                        name: "FK_receipt_mail_addresses_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "inbound_messages",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    address_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    received_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    sha256 = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    auth_spf = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    auth_dkim = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    auth_dmarc = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    status = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    reason_code = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    due_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    lease_token = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    processed_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    storage_path = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    encryption_version = table.Column<short>(
                        type: "smallint",
                        nullable: false,
                        defaultValue: (short)1
                    ),
                    key_salt = table.Column<byte[]>(type: "bytea", nullable: false),
                    file_nonce = table.Column<byte[]>(type: "bytea", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_inbound_messages", x => x.id);
                    table.CheckConstraint("ck_inbound_messages_attempts", "attempts >= 0");
                    table.CheckConstraint(
                        "ck_inbound_messages_auth",
                        "(auth_spf IS NULL OR auth_spf IN ('pass','fail','none','unknown')) AND (auth_dkim IS NULL OR auth_dkim IN ('pass','fail','none','unknown')) AND (auth_dmarc IS NULL OR auth_dmarc IN ('pass','fail','none','unknown'))"
                    );
                    table.CheckConstraint(
                        "ck_inbound_messages_due",
                        "(status IN ('pending','processing')) = (due_at IS NOT NULL)"
                    );
                    table.CheckConstraint(
                        "ck_inbound_messages_encryption_version",
                        "encryption_version = 1"
                    );
                    table.CheckConstraint(
                        "ck_inbound_messages_file_nonce",
                        "length(file_nonce) = 12"
                    );
                    table.CheckConstraint("ck_inbound_messages_key_salt", "length(key_salt) = 32");
                    table.CheckConstraint(
                        "ck_inbound_messages_lease",
                        "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_inbound_messages_reason",
                        "reason_code IS NULL OR reason_code ~ '^[a-z_]{1,40}$'"
                    );
                    table.CheckConstraint(
                        "ck_inbound_messages_sha256",
                        "sha256 ~ '^[0-9a-f]{64}$'"
                    );
                    table.CheckConstraint("ck_inbound_messages_size", "size_bytes >= 0");
                    table.CheckConstraint(
                        "ck_inbound_messages_status",
                        "status IN ('pending','processing','done','rejected','failed')"
                    );
                    table.CheckConstraint(
                        "ck_inbound_messages_storage_path",
                        "storage_path IS NULL OR storage_path ~ '^inbound/[0-9a-f]{2}/[0-9a-f]{32}$'"
                    );
                    table.ForeignKey(
                        name: "FK_inbound_messages_receipt_mail_addresses_address_id",
                        column: x => x.address_id,
                        principalSchema: "penny",
                        principalTable: "receipt_mail_addresses",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_inbound_messages_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "receipt_inbox_items",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    inbound_message_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    encryption_version = table.Column<short>(
                        type: "smallint",
                        nullable: false,
                        defaultValue: (short)1
                    ),
                    key_salt = table.Column<byte[]>(type: "bytea", nullable: false),
                    subject_nonce = table.Column<byte[]>(type: "bytea", nullable: false),
                    subject_encrypted = table.Column<byte[]>(type: "bytea", nullable: false),
                    from_nonce = table.Column<byte[]>(type: "bytea", nullable: false),
                    from_encrypted = table.Column<byte[]>(type: "bytea", nullable: false),
                    sender_verified = table.Column<bool>(type: "boolean", nullable: false),
                    received_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    status = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    attached_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_receipt_inbox_items", x => x.id);
                    table.UniqueConstraint("AK_receipt_inbox_items_user_id_id", x => new
                    {
                        x.user_id,
                        x.id,
                    });
                    table.CheckConstraint(
                        "ck_receipt_inbox_items_attached",
                        "(status = 'attached') = (attached_at IS NOT NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_inbox_items_encryption_version",
                        "encryption_version = 1"
                    );
                    table.CheckConstraint(
                        "ck_receipt_inbox_items_key_salt",
                        "length(key_salt) = 32"
                    );
                    table.CheckConstraint(
                        "ck_receipt_inbox_items_nonces",
                        "length(subject_nonce) = 12 AND length(from_nonce) = 12"
                    );
                    table.CheckConstraint(
                        "ck_receipt_inbox_items_status",
                        "status IN ('to_attach','partly_attached','attached','discarded')"
                    );
                    table.ForeignKey(
                        name: "FK_receipt_inbox_items_inbound_messages_inbound_message_id",
                        column: x => x.inbound_message_id,
                        principalSchema: "penny",
                        principalTable: "inbound_messages",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_receipt_inbox_items_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "receipt_inbox_receipts",
                schema: "penny",
                columns: table => new
                {
                    inbox_item_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    receipt_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    kind = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    position = table.Column<int>(type: "integer", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_receipt_inbox_receipts", x => new
                    {
                        x.inbox_item_id,
                        x.receipt_id,
                    });
                    table.CheckConstraint(
                        "ck_receipt_inbox_receipts_kind",
                        "kind IN ('email','attachment')"
                    );
                    table.CheckConstraint("ck_receipt_inbox_receipts_position", "position >= 0");
                    table.ForeignKey(
                        name: "FK_receipt_inbox_receipts_receipt_inbox_items_user_id_inbox_it~",
                        columns: x => new { x.user_id, x.inbox_item_id },
                        principalSchema: "penny",
                        principalTable: "receipt_inbox_items",
                        principalColumns: new[] { "user_id", "id" },
                        onDelete: ReferentialAction.Cascade
                    );
                    table.ForeignKey(
                        name: "FK_receipt_inbox_receipts_receipts_user_id_receipt_id",
                        columns: x => new { x.user_id, x.receipt_id },
                        principalSchema: "penny",
                        principalTable: "receipts",
                        principalColumns: new[] { "user_id", "id" }
                    );
                }
            );

            migrationBuilder.CreateIndex(
                name: "IX_inbound_messages_address_id_received_at",
                schema: "penny",
                table: "inbound_messages",
                columns: new[] { "address_id", "received_at" }
            );

            migrationBuilder.CreateIndex(
                name: "ix_inbound_messages_due",
                schema: "penny",
                table: "inbound_messages",
                column: "due_at",
                filter: "due_at IS NOT NULL"
            );

            migrationBuilder.CreateIndex(
                name: "IX_inbound_messages_storage_path",
                schema: "penny",
                table: "inbound_messages",
                column: "storage_path",
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "IX_inbound_messages_user_id_sha256",
                schema: "penny",
                table: "inbound_messages",
                columns: new[] { "user_id", "sha256" },
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "ix_receipt_inbox_items_expiry",
                schema: "penny",
                table: "receipt_inbox_items",
                column: "expires_at",
                filter: "status IN ('to_attach','partly_attached')"
            );

            migrationBuilder.CreateIndex(
                name: "IX_receipt_inbox_items_inbound_message_id",
                schema: "penny",
                table: "receipt_inbox_items",
                column: "inbound_message_id",
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "IX_receipt_inbox_items_user_id_status_received_at",
                schema: "penny",
                table: "receipt_inbox_items",
                columns: new[] { "user_id", "status", "received_at" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_receipt_inbox_receipts_inbox_item_id_position",
                schema: "penny",
                table: "receipt_inbox_receipts",
                columns: new[] { "inbox_item_id", "position" },
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "IX_receipt_inbox_receipts_receipt_id",
                schema: "penny",
                table: "receipt_inbox_receipts",
                column: "receipt_id",
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "IX_receipt_inbox_receipts_user_id_inbox_item_id",
                schema: "penny",
                table: "receipt_inbox_receipts",
                columns: new[] { "user_id", "inbox_item_id" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_receipt_inbox_receipts_user_id_receipt_id",
                schema: "penny",
                table: "receipt_inbox_receipts",
                columns: new[] { "user_id", "receipt_id" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_receipt_mail_addresses_local_part_hash",
                schema: "penny",
                table: "receipt_mail_addresses",
                column: "local_part_hash",
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "ux_receipt_mail_addresses_current",
                schema: "penny",
                table: "receipt_mail_addresses",
                column: "user_id",
                unique: true,
                filter: "revoked_at IS NULL"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "receipt_inbox_receipts", schema: "penny");

            migrationBuilder.DropTable(name: "receipt_inbox_items", schema: "penny");

            migrationBuilder.DropTable(name: "inbound_messages", schema: "penny");

            migrationBuilder.DropTable(name: "receipt_mail_addresses", schema: "penny");
        }
    }
}
