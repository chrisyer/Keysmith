use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::{AccountPasskey, DEFAULT_QUICK_ACCESS_SHORTCUT};
use crate::error::CoreError;
use crate::protocol::{CipherDto, CollectionDto, FolderDto, SendDto};

#[derive(Debug, Clone)]
pub struct StoredAccount {
    pub id: String,
    pub server_url: String,
    pub email: String,
    pub display_name: String,
    pub kdf_type: u8,
    pub kdf_iterations: u32,
    pub kdf_memory: Option<u32>,
    pub kdf_parallelism: Option<u32>,
    pub protected_symmetric_key: String,
    pub encrypted_private_key: Option<String>,
    pub public_key: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub last_sync_at: Option<String>,
    pub biometric_enabled: bool,
    pub auto_lock_minutes: u32,
    pub clipboard_clear_seconds: u64,
    pub device_identifier: String,
    pub is_active: bool,
    pub close_to_tray: bool,
    pub lock_on_sleep: bool,
    pub screen_capture_protected: bool,
    pub vibrancy_enabled: bool,
    pub favicon_enabled: bool,
    pub quick_access_shortcut: String,
    pub biometric_max_days: u32,
    pub launch_at_login: bool,
    pub last_master_password_unlock_at: Option<String>,
}

impl StoredAccount {
    pub fn default_prefs(
        id: String,
        server_url: String,
        email: String,
        display_name: String,
        kdf_type: u8,
        kdf_iterations: u32,
        kdf_memory: Option<u32>,
        kdf_parallelism: Option<u32>,
        protected_symmetric_key: String,
        device_identifier: String,
    ) -> Self {
        Self {
            id,
            server_url,
            email,
            display_name,
            kdf_type,
            kdf_iterations,
            kdf_memory,
            kdf_parallelism,
            protected_symmetric_key,
            encrypted_private_key: None,
            public_key: None,
            access_token: None,
            refresh_token: None,
            last_sync_at: None,
            biometric_enabled: false,
            auto_lock_minutes: 15,
            clipboard_clear_seconds: 30,
            device_identifier,
            is_active: true,
            close_to_tray: true,
            lock_on_sleep: true,
            screen_capture_protected: false,
            vibrancy_enabled: true,
            favicon_enabled: true,
            quick_access_shortcut: DEFAULT_QUICK_ACCESS_SHORTCUT.to_string(),
            biometric_max_days: 7,
            launch_at_login: false,
            last_master_password_unlock_at: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StoredVault {
    pub id: String,
    pub account_id: String,
    pub name_enc: String,
    pub revision_date: String,
    pub dirty_op: Option<String>,
    pub is_organization: bool,
}

#[derive(Debug, Clone)]
pub struct StoredCipher {
    pub id: String,
    pub account_id: String,
    pub folder_id: Option<String>,
    pub cipher_type: u8,
    pub favorite: bool,
    pub name_enc: String,
    pub notes_enc: Option<String>,
    pub raw_json: String,
    pub revision_date: String,
    pub deleted_date: Option<String>,
    pub dirty_op: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredGeneratorHistory {
    pub id: String,
    pub account_id: String,
    pub value_enc: String,
    pub mode: String,
    pub entropy_bits: u32,
    pub source_enc: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct StoredLocalAttachment {
    pub id: String,
    pub account_id: String,
    pub cipher_id: String,
    pub file_name_enc: String,
    pub data_enc: String,
    pub size: u64,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct StoredSend {
    pub id: String,
    pub account_id: String,
    pub raw_json: String,
    pub revision_date: String,
}

#[derive(Clone)]
pub struct Storage {
    conn: Arc<Mutex<Connection>>,
}

const ACCOUNT_COLUMNS: &str = r#"
    id, server_url, email, display_name, kdf_type, kdf_iterations,
    kdf_memory, kdf_parallelism, protected_symmetric_key,
    encrypted_private_key, public_key, access_token, refresh_token,
    last_sync_at, biometric_enabled, auto_lock_minutes,
    clipboard_clear_seconds, device_identifier,
    is_active, close_to_tray, lock_on_sleep, screen_capture_protected,
    vibrancy_enabled, favicon_enabled, quick_access_shortcut,
    biometric_max_days, launch_at_login, last_master_password_unlock_at
"#;

fn map_account_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredAccount> {
    let shortcut: String = row.get(24)?;
    Ok(StoredAccount {
        id: row.get(0)?,
        server_url: row.get(1)?,
        email: row.get(2)?,
        display_name: row.get(3)?,
        kdf_type: row.get::<_, i64>(4)? as u8,
        kdf_iterations: row.get::<_, i64>(5)? as u32,
        kdf_memory: row.get::<_, Option<i64>>(6)?.map(|v| v as u32),
        kdf_parallelism: row.get::<_, Option<i64>>(7)?.map(|v| v as u32),
        protected_symmetric_key: row.get(8)?,
        encrypted_private_key: row.get(9)?,
        public_key: row.get(10)?,
        access_token: row.get(11)?,
        refresh_token: row.get(12)?,
        last_sync_at: row.get(13)?,
        biometric_enabled: row.get::<_, i64>(14)? != 0,
        auto_lock_minutes: row.get::<_, i64>(15)? as u32,
        clipboard_clear_seconds: row.get::<_, i64>(16)? as u64,
        device_identifier: row.get(17)?,
        is_active: row.get::<_, i64>(18)? != 0,
        close_to_tray: row.get::<_, i64>(19)? != 0,
        lock_on_sleep: row.get::<_, i64>(20)? != 0,
        screen_capture_protected: row.get::<_, i64>(21)? != 0,
        vibrancy_enabled: row.get::<_, i64>(22)? != 0,
        favicon_enabled: row.get::<_, i64>(23)? != 0,
        quick_access_shortcut: if shortcut.trim().is_empty() {
            DEFAULT_QUICK_ACCESS_SHORTCUT.to_string()
        } else {
            shortcut
        },
        biometric_max_days: row.get::<_, i64>(25)? as u32,
        launch_at_login: row.get::<_, i64>(26)? != 0,
        last_master_password_unlock_at: row.get(27)?,
    })
}

impl Storage {
    pub fn default_db_path() -> Result<PathBuf, CoreError> {
        let dir = {
            #[cfg(target_os = "macos")]
            {
                let home = std::env::var_os("HOME")
                    .ok_or_else(|| CoreError::Storage("无法获取用户 HOME 目录".to_string()))?;
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join("dev.keysmith.desktop")
            }
            #[cfg(target_os = "windows")]
            {
                let appdata = std::env::var_os("APPDATA")
                    .map(PathBuf::from)
                    .or_else(|| {
                        std::env::var_os("USERPROFILE")
                            .map(|u| PathBuf::from(u).join("AppData").join("Roaming"))
                    })
                    .ok_or_else(|| CoreError::Storage("无法获取 APPDATA 目录".to_string()))?;
                appdata.join("dev.keysmith.desktop")
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let base = std::env::var_os("XDG_DATA_HOME")
                    .map(PathBuf::from)
                    .or_else(|| {
                        std::env::var_os("HOME")
                            .map(|h| PathBuf::from(h).join(".local").join("share"))
                    })
                    .ok_or_else(|| CoreError::Storage("无法获取用户数据目录".to_string()))?;
                base.join("dev.keysmith.desktop")
            }
        };
        std::fs::create_dir_all(&dir)
            .map_err(|e| CoreError::Storage(format!("创建数据目录失败: {e}")))?;
        Ok(dir.join("keysmith.db"))
    }

    pub fn open_default() -> Result<Self, CoreError> {
        let path = Self::default_db_path()?;
        Self::open(&path)
    }

    pub fn open(path: &Path) -> Result<Self, CoreError> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| CoreError::Storage(format!("创建数据库目录失败: {e}")))?;
            }
        }
        let conn = Connection::open(path)
            .map_err(|e| CoreError::Storage(format!("打开 SQLite 数据库失败: {e}")))?;
        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        storage.migrate()?;
        Ok(storage)
    }

    pub fn open_in_memory() -> Result<Self, CoreError> {
        let conn = Connection::open_in_memory()
            .map_err(|e| CoreError::Storage(format!("打开内存数据库失败: {e}")))?;
        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        storage.migrate()?;
        Ok(storage)
    }

    fn exec_alter_ignore_dup(conn: &Connection, sql: &str) -> Result<(), CoreError> {
        match conn.execute(sql, []) {
            Ok(_) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("duplicate column name") {
                    Ok(())
                } else {
                    Err(CoreError::Storage(format!("表结构升级失败: {msg}")))
                }
            }
        }
    }

    fn migrate(&self) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                server_url TEXT NOT NULL,
                email TEXT NOT NULL,
                display_name TEXT NOT NULL DEFAULT '',
                kdf_type INTEGER NOT NULL,
                kdf_iterations INTEGER NOT NULL,
                kdf_memory INTEGER,
                kdf_parallelism INTEGER,
                protected_symmetric_key TEXT NOT NULL,
                encrypted_private_key TEXT,
                public_key TEXT,
                access_token TEXT,
                refresh_token TEXT,
                last_sync_at TEXT,
                biometric_enabled INTEGER NOT NULL DEFAULT 0,
                auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
                clipboard_clear_seconds INTEGER NOT NULL DEFAULT 30,
                device_identifier TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                close_to_tray INTEGER NOT NULL DEFAULT 1,
                lock_on_sleep INTEGER NOT NULL DEFAULT 1,
                screen_capture_protected INTEGER NOT NULL DEFAULT 0,
                vibrancy_enabled INTEGER NOT NULL DEFAULT 1,
                favicon_enabled INTEGER NOT NULL DEFAULT 1,
                quick_access_shortcut TEXT NOT NULL DEFAULT 'CommandOrControl+Shift+Space',
                biometric_max_days INTEGER NOT NULL DEFAULT 7,
                launch_at_login INTEGER NOT NULL DEFAULT 0,
                last_master_password_unlock_at TEXT
            );

            CREATE TABLE IF NOT EXISTS vaults (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                name_enc TEXT NOT NULL,
                revision_date TEXT NOT NULL,
                dirty_op TEXT,
                is_organization INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS ciphers (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                folder_id TEXT,
                cipher_type INTEGER NOT NULL,
                favorite INTEGER NOT NULL DEFAULT 0,
                name_enc TEXT NOT NULL,
                notes_enc TEXT,
                raw_json TEXT NOT NULL,
                revision_date TEXT NOT NULL,
                deleted_date TEXT,
                dirty_op TEXT
            );

            CREATE TABLE IF NOT EXISTS account_passkeys (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                json_data TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS generator_history (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                value_enc TEXT NOT NULL,
                mode TEXT NOT NULL,
                entropy_bits INTEGER NOT NULL,
                source_enc TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS local_attachments (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                cipher_id TEXT NOT NULL,
                file_name_enc TEXT NOT NULL,
                data_enc TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS favicon_cache (
                host TEXT PRIMARY KEY,
                data_uri TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sends (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                raw_json TEXT NOT NULL,
                revision_date TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| CoreError::Storage(format!("执行数据库迁移失败: {e}")))?;

        // Idempotent column migrations for existing pre-upgrade DBs
        let account_alters = [
            "ALTER TABLE accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE accounts ADD COLUMN close_to_tray INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE accounts ADD COLUMN lock_on_sleep INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE accounts ADD COLUMN screen_capture_protected INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE accounts ADD COLUMN vibrancy_enabled INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE accounts ADD COLUMN favicon_enabled INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE accounts ADD COLUMN quick_access_shortcut TEXT NOT NULL DEFAULT 'CommandOrControl+Shift+Space'",
            "ALTER TABLE accounts ADD COLUMN biometric_max_days INTEGER NOT NULL DEFAULT 7",
            "ALTER TABLE accounts ADD COLUMN launch_at_login INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE accounts ADD COLUMN last_master_password_unlock_at TEXT",
            "ALTER TABLE vaults ADD COLUMN is_organization INTEGER NOT NULL DEFAULT 0",
        ];
        for sql in account_alters {
            Self::exec_alter_ignore_dup(&conn, sql)?;
        }

        Ok(())
    }

    pub fn load_primary_account(&self) -> Result<Option<StoredAccount>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let active_sql = format!(
            "SELECT {ACCOUNT_COLUMNS} FROM accounts WHERE is_active = 1 LIMIT 1"
        );
        let active = conn
            .query_row(&active_sql, [], map_account_row)
            .optional()
            .map_err(|e| CoreError::Storage(format!("读取活跃账户信息失败: {e}")))?;
        if active.is_some() {
            return Ok(active);
        }
        let fallback_sql = format!("SELECT {ACCOUNT_COLUMNS} FROM accounts LIMIT 1");
        conn.query_row(&fallback_sql, [], map_account_row)
            .optional()
            .map_err(|e| CoreError::Storage(format!("读取账户信息失败: {e}")))
    }

    pub fn load_account_by_id(&self, id: &str) -> Result<Option<StoredAccount>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let sql = format!("SELECT {ACCOUNT_COLUMNS} FROM accounts WHERE id = ?1");
        conn.query_row(&sql, params![id], map_account_row)
            .optional()
            .map_err(|e| CoreError::Storage(format!("读取指定账户失败: {e}")))
    }

    pub fn list_accounts(&self) -> Result<Vec<StoredAccount>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let sql = format!(
            "SELECT {ACCOUNT_COLUMNS} FROM accounts ORDER BY is_active DESC, email ASC"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map([], map_account_row)
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::Storage(e.to_string()))?);
        }
        Ok(out)
    }

    pub fn set_active_account(&self, account_id: &str) -> Result<StoredAccount, CoreError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        tx.execute("UPDATE accounts SET is_active = 0", [])
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let updated = tx
            .execute(
                "UPDATE accounts SET is_active = 1 WHERE id = ?1",
                params![account_id],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        if updated == 0 {
            return Err(CoreError::NotFound("目标账户不存在".to_string()));
        }
        tx.commit()
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        drop(conn);
        self.load_account_by_id(account_id)?
            .ok_or_else(|| CoreError::NotFound("目标账户不存在".to_string()))
    }

    pub fn upsert_account(&self, account: &StoredAccount) -> Result<(), CoreError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::Storage(format!("开启账户事务失败: {e}")))?;

        if account.is_active {
            tx.execute(
                "UPDATE accounts SET is_active = 0 WHERE id != ?1",
                params![account.id],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        }

        tx.execute(
            r#"
            INSERT INTO accounts (
                id, server_url, email, display_name, kdf_type, kdf_iterations,
                kdf_memory, kdf_parallelism, protected_symmetric_key,
                encrypted_private_key, public_key, access_token, refresh_token,
                last_sync_at, biometric_enabled, auto_lock_minutes,
                clipboard_clear_seconds, device_identifier,
                is_active, close_to_tray, lock_on_sleep, screen_capture_protected,
                vibrancy_enabled, favicon_enabled, quick_access_shortcut,
                biometric_max_days, launch_at_login, last_master_password_unlock_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28
            )
            ON CONFLICT(id) DO UPDATE SET
                server_url = excluded.server_url,
                email = excluded.email,
                display_name = excluded.display_name,
                kdf_type = excluded.kdf_type,
                kdf_iterations = excluded.kdf_iterations,
                kdf_memory = excluded.kdf_memory,
                kdf_parallelism = excluded.kdf_parallelism,
                protected_symmetric_key = excluded.protected_symmetric_key,
                encrypted_private_key = excluded.encrypted_private_key,
                public_key = excluded.public_key,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                last_sync_at = excluded.last_sync_at,
                biometric_enabled = excluded.biometric_enabled,
                auto_lock_minutes = excluded.auto_lock_minutes,
                clipboard_clear_seconds = excluded.clipboard_clear_seconds,
                device_identifier = excluded.device_identifier,
                is_active = excluded.is_active,
                close_to_tray = excluded.close_to_tray,
                lock_on_sleep = excluded.lock_on_sleep,
                screen_capture_protected = excluded.screen_capture_protected,
                vibrancy_enabled = excluded.vibrancy_enabled,
                favicon_enabled = excluded.favicon_enabled,
                quick_access_shortcut = excluded.quick_access_shortcut,
                biometric_max_days = excluded.biometric_max_days,
                launch_at_login = excluded.launch_at_login,
                last_master_password_unlock_at = excluded.last_master_password_unlock_at
            "#,
            params![
                account.id,
                account.server_url,
                account.email,
                account.display_name,
                account.kdf_type as i64,
                account.kdf_iterations as i64,
                account.kdf_memory.map(|v| v as i64),
                account.kdf_parallelism.map(|v| v as i64),
                account.protected_symmetric_key,
                account.encrypted_private_key,
                account.public_key,
                account.access_token,
                account.refresh_token,
                account.last_sync_at,
                if account.biometric_enabled { 1 } else { 0 },
                account.auto_lock_minutes as i64,
                account.clipboard_clear_seconds as i64,
                account.device_identifier,
                if account.is_active { 1 } else { 0 },
                if account.close_to_tray { 1 } else { 0 },
                if account.lock_on_sleep { 1 } else { 0 },
                if account.screen_capture_protected { 1 } else { 0 },
                if account.vibrancy_enabled { 1 } else { 0 },
                if account.favicon_enabled { 1 } else { 0 },
                account.quick_access_shortcut,
                account.biometric_max_days as i64,
                if account.launch_at_login { 1 } else { 0 },
                account.last_master_password_unlock_at,
            ],
        )
        .map_err(|e| CoreError::Storage(format!("写入账户信息失败: {e}")))?;

        tx.commit()
            .map_err(|e| CoreError::Storage(format!("提交账户事务失败: {e}")))?;
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
        Ok(())
    }

    pub fn clear_account_data(&self, account_id: &str, clear_cache: bool) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        if clear_cache {
            conn.execute(
                "DELETE FROM ciphers WHERE account_id = ?1",
                params![account_id],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
            conn.execute(
                "DELETE FROM vaults WHERE account_id = ?1",
                params![account_id],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
            conn.execute(
                "DELETE FROM account_passkeys WHERE account_id = ?1",
                params![account_id],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
            conn.execute(
                "DELETE FROM generator_history WHERE account_id = ?1",
                params![account_id],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
            conn.execute(
                "DELETE FROM local_attachments WHERE account_id = ?1",
                params![account_id],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
            conn.execute("DELETE FROM sends WHERE account_id = ?1", params![account_id])
                .map_err(|e| CoreError::Storage(e.to_string()))?;
        }
        conn.execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn clear_account_and_data(&self, clear_cache: bool) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        if clear_cache {
            conn.execute_batch(
                "DELETE FROM ciphers; DELETE FROM vaults; DELETE FROM account_passkeys; DELETE FROM generator_history; DELETE FROM local_attachments; DELETE FROM sends; DELETE FROM accounts;",
            )
            .map_err(|e| CoreError::Storage(format!("清空本地缓存失败: {e}")))?;
        } else {
            conn.execute_batch("DELETE FROM accounts;")
                .map_err(|e| CoreError::Storage(format!("清除账户会话失败: {e}")))?;
        }
        Ok(())
    }

    pub fn replace_synced_vaults_clean(
        &self,
        account_id: &str,
        folders: &[FolderDto],
        collections: &[CollectionDto],
    ) -> Result<(), CoreError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::Storage(format!("开启事务失败: {e}")))?;
        tx.execute(
            "DELETE FROM vaults WHERE account_id = ?1 AND dirty_op IS NULL",
            params![account_id],
        )
        .map_err(|e| CoreError::Storage(format!("清理同步文件夹失败: {e}")))?;

        for f in folders {
            let rev = f.revision_date.clone().unwrap_or_default();
            tx.execute(
                r#"
                INSERT INTO vaults (id, account_id, name_enc, revision_date, dirty_op, is_organization)
                VALUES (?1, ?2, ?3, ?4, NULL, 0)
                ON CONFLICT(id) DO UPDATE SET
                    name_enc = excluded.name_enc,
                    revision_date = excluded.revision_date,
                    dirty_op = NULL,
                    is_organization = 0
                WHERE vaults.dirty_op IS NULL
                "#,
                params![f.id, account_id, f.name, rev],
            )
            .map_err(|e| CoreError::Storage(format!("写入文件夹失败: {e}")))?;
        }

        for c in collections {
            tx.execute(
                r#"
                INSERT INTO vaults (id, account_id, name_enc, revision_date, dirty_op, is_organization)
                VALUES (?1, ?2, ?3, '', NULL, 1)
                ON CONFLICT(id) DO UPDATE SET
                    name_enc = excluded.name_enc,
                    is_organization = 1,
                    dirty_op = NULL
                "#,
                params![c.id, account_id, c.name],
            )
            .map_err(|e| CoreError::Storage(format!("写入组织集合失败: {e}")))?;
        }

        tx.commit()
            .map_err(|e| CoreError::Storage(format!("提交事务失败: {e}")))?;
        Ok(())
    }

    pub fn upsert_vault(&self, v: &StoredVault) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            r#"
            INSERT INTO vaults (id, account_id, name_enc, revision_date, dirty_op, is_organization)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                name_enc = excluded.name_enc,
                revision_date = excluded.revision_date,
                dirty_op = excluded.dirty_op,
                is_organization = excluded.is_organization
            "#,
            params![
                v.id,
                v.account_id,
                v.name_enc,
                v.revision_date,
                v.dirty_op,
                if v.is_organization { 1 } else { 0 }
            ],
        )
        .map_err(|e| CoreError::Storage(format!("保存文件夹失败: {e}")))?;
        Ok(())
    }

    pub fn delete_vault_row(&self, id: &str) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute("DELETE FROM vaults WHERE id = ?1", params![id])
            .map_err(|e| CoreError::Storage(format!("删除文件夹失败: {e}")))?;
        Ok(())
    }

    pub fn list_vaults(&self, account_id: &str) -> Result<Vec<StoredVault>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, account_id, name_enc, revision_date, dirty_op, is_organization FROM vaults WHERE account_id = ?1",
            )
            .map_err(|e| CoreError::Storage(format!("查询文件夹失败: {e}")))?;
        let rows = stmt
            .query_map(params![account_id], |row| {
                Ok(StoredVault {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    name_enc: row.get(2)?,
                    revision_date: row.get(3)?,
                    dirty_op: row.get(4)?,
                    is_organization: row.get::<_, i64>(5)? != 0,
                })
            })
            .map_err(|e| CoreError::Storage(format!("读取文件夹行失败: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::Storage(e.to_string()))?);
        }
        Ok(out)
    }

    pub fn replace_synced_ciphers_clean(
        &self,
        account_id: &str,
        ciphers: &[CipherDto],
    ) -> Result<(), CoreError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::Storage(format!("开启事务失败: {e}")))?;
        tx.execute(
            "DELETE FROM ciphers WHERE account_id = ?1 AND dirty_op IS NULL",
            params![account_id],
        )
        .map_err(|e| CoreError::Storage(format!("清理同步条目失败: {e}")))?;

        for c in ciphers {
            let raw_json = serde_json::to_string(c)
                .map_err(|e| CoreError::Storage(format!("序列化 Cipher 失败: {e}")))?;
            let name_enc = c.name.clone().unwrap_or_default();
            let rev = c.revision_date.clone().unwrap_or_default();
            tx.execute(
                r#"
                INSERT INTO ciphers (
                    id, account_id, folder_id, cipher_type, favorite,
                    name_enc, notes_enc, raw_json, revision_date, deleted_date, dirty_op
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    folder_id = excluded.folder_id,
                    cipher_type = excluded.cipher_type,
                    favorite = excluded.favorite,
                    name_enc = excluded.name_enc,
                    notes_enc = excluded.notes_enc,
                    raw_json = excluded.raw_json,
                    revision_date = excluded.revision_date,
                    deleted_date = excluded.deleted_date,
                    dirty_op = NULL
                WHERE ciphers.dirty_op IS NULL
                "#,
                params![
                    c.id,
                    account_id,
                    c.folder_id,
                    c.cipher_type as i64,
                    if c.favorite { 1 } else { 0 },
                    name_enc,
                    c.notes,
                    raw_json,
                    rev,
                    c.deleted_date,
                ],
            )
            .map_err(|e| CoreError::Storage(format!("写入条目密文失败: {e}")))?;
        }
        tx.commit()
            .map_err(|e| CoreError::Storage(format!("提交事务失败: {e}")))?;
        Ok(())
    }

    pub fn upsert_cipher(
        &self,
        account_id: &str,
        c: &CipherDto,
        dirty_op: Option<&str>,
    ) -> Result<(), CoreError> {
        let raw_json = serde_json::to_string(c)
            .map_err(|e| CoreError::Storage(format!("序列化 Cipher 失败: {e}")))?;
        let name_enc = c.name.clone().unwrap_or_default();
        let rev = c.revision_date.clone().unwrap_or_default();

        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            r#"
            INSERT INTO ciphers (
                id, account_id, folder_id, cipher_type, favorite,
                name_enc, notes_enc, raw_json, revision_date, deleted_date, dirty_op
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
                folder_id = excluded.folder_id,
                cipher_type = excluded.cipher_type,
                favorite = excluded.favorite,
                name_enc = excluded.name_enc,
                notes_enc = excluded.notes_enc,
                raw_json = excluded.raw_json,
                revision_date = excluded.revision_date,
                deleted_date = excluded.deleted_date,
                dirty_op = excluded.dirty_op
            "#,
            params![
                c.id,
                account_id,
                c.folder_id,
                c.cipher_type as i64,
                if c.favorite { 1 } else { 0 },
                name_enc,
                c.notes,
                raw_json,
                rev,
                c.deleted_date,
                dirty_op,
            ],
        )
        .map_err(|e| CoreError::Storage(format!("保存条目密文失败: {e}")))?;
        Ok(())
    }

    pub fn delete_cipher_row(&self, id: &str) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute("DELETE FROM ciphers WHERE id = ?1", params![id])
            .map_err(|e| CoreError::Storage(format!("删除条目缓存失败: {e}")))?;
        Ok(())
    }

    pub fn list_ciphers(&self, account_id: &str) -> Result<Vec<StoredCipher>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, account_id, folder_id, cipher_type, favorite,
                       name_enc, notes_enc, raw_json, revision_date, deleted_date, dirty_op
                FROM ciphers
                WHERE account_id = ?1
                "#,
            )
            .map_err(|e| CoreError::Storage(format!("查询条目密文失败: {e}")))?;
        let rows = stmt
            .query_map(params![account_id], |row| {
                Ok(StoredCipher {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    folder_id: row.get(2)?,
                    cipher_type: row.get::<_, i64>(3)? as u8,
                    favorite: row.get::<_, i64>(4)? != 0,
                    name_enc: row.get(5)?,
                    notes_enc: row.get(6)?,
                    raw_json: row.get(7)?,
                    revision_date: row.get(8)?,
                    deleted_date: row.get(9)?,
                    dirty_op: row.get(10)?,
                })
            })
            .map_err(|e| CoreError::Storage(format!("读取条目密文行失败: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::Storage(e.to_string()))?);
        }
        Ok(out)
    }

    pub fn count_pending_dirty(&self, account_id: &str) -> Result<usize, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let c_cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ciphers WHERE account_id = ?1 AND dirty_op IS NOT NULL",
                params![account_id],
                |r| r.get(0),
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let v_cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM vaults WHERE account_id = ?1 AND dirty_op IS NOT NULL",
                params![account_id],
                |r| r.get(0),
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok((c_cnt + v_cnt) as usize)
    }

    pub fn list_account_passkeys(&self, account_id: &str) -> Result<Vec<AccountPasskey>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let mut stmt = conn
            .prepare("SELECT json_data FROM account_passkeys WHERE account_id = ?1")
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map(params![account_id], |row| row.get::<_, String>(0))
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            let raw = r.map_err(|e| CoreError::Storage(e.to_string()))?;
            let pk: AccountPasskey = serde_json::from_str(&raw)
                .map_err(|e| CoreError::Storage(format!("解析账户通行密钥失败: {e}")))?;
            out.push(pk);
        }
        Ok(out)
    }

    pub fn upsert_account_passkey(
        &self,
        account_id: &str,
        pk: &AccountPasskey,
    ) -> Result<(), CoreError> {
        let json = serde_json::to_string(pk)
            .map_err(|e| CoreError::Storage(format!("序列化账户通行密钥失败: {e}")))?;
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            r#"
            INSERT INTO account_passkeys (id, account_id, json_data)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
            "#,
            params![pk.id, account_id, json],
        )
        .map_err(|e| CoreError::Storage(format!("保存账户通行密钥失败: {e}")))?;
        Ok(())
    }

    pub fn delete_account_passkey(&self, account_id: &str, id: &str) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            "DELETE FROM account_passkeys WHERE account_id = ?1 AND id = ?2",
            params![account_id, id],
        )
        .map_err(|e| CoreError::Storage(format!("删除账户通行密钥失败: {e}")))?;
        Ok(())
    }

    // --- Generator History (encrypted) ---

    pub fn insert_generator_history(
        &self,
        entry: &StoredGeneratorHistory,
    ) -> Result<(), CoreError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        tx.execute(
            r#"
            INSERT INTO generator_history (id, account_id, value_enc, mode, entropy_bits, source_enc, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                entry.id,
                entry.account_id,
                entry.value_enc,
                entry.mode,
                entry.entropy_bits as i64,
                entry.source_enc,
                entry.created_at,
            ],
        )
        .map_err(|e| CoreError::Storage(format!("写入生成器历史失败: {e}")))?;

        // Keep newest 50 entries per account
        tx.execute(
            r#"
            DELETE FROM generator_history
            WHERE account_id = ?1 AND id NOT IN (
                SELECT id FROM generator_history
                WHERE account_id = ?1
                ORDER BY created_at DESC, rowid DESC
                LIMIT 50
            )
            "#,
            params![entry.account_id],
        )
        .map_err(|e| CoreError::Storage(e.to_string()))?;

        tx.commit()
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn list_generator_history(
        &self,
        account_id: &str,
    ) -> Result<Vec<StoredGeneratorHistory>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, account_id, value_enc, mode, entropy_bits, source_enc, created_at
                FROM generator_history
                WHERE account_id = ?1
                ORDER BY created_at DESC, rowid DESC
                LIMIT 50
                "#,
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map(params![account_id], |row| {
                Ok(StoredGeneratorHistory {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    value_enc: row.get(2)?,
                    mode: row.get(3)?,
                    entropy_bits: row.get::<_, i64>(4)? as u32,
                    source_enc: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| CoreError::Storage(e.to_string()))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::Storage(e.to_string()))?);
        }
        Ok(out)
    }

    pub fn clear_generator_history(&self, account_id: &str) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            "DELETE FROM generator_history WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|e| CoreError::Storage(format!("清空生成器历史失败: {e}")))?;
        Ok(())
    }

    // --- Local Encrypted Attachments ---

    pub fn upsert_local_attachment(&self, att: &StoredLocalAttachment) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            r#"
            INSERT INTO local_attachments (id, account_id, cipher_id, file_name_enc, data_enc, size, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                file_name_enc = excluded.file_name_enc,
                data_enc = excluded.data_enc,
                size = excluded.size
            "#,
            params![
                att.id,
                att.account_id,
                att.cipher_id,
                att.file_name_enc,
                att.data_enc,
                att.size as i64,
                att.created_at,
            ],
        )
        .map_err(|e| CoreError::Storage(format!("保存本地加密附件失败: {e}")))?;
        Ok(())
    }

    pub fn get_local_attachment(
        &self,
        account_id: &str,
        attachment_id: &str,
    ) -> Result<Option<StoredLocalAttachment>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.query_row(
            r#"
            SELECT id, account_id, cipher_id, file_name_enc, data_enc, size, created_at
            FROM local_attachments
            WHERE account_id = ?1 AND id = ?2
            "#,
            params![account_id, attachment_id],
            |row| {
                Ok(StoredLocalAttachment {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    cipher_id: row.get(2)?,
                    file_name_enc: row.get(3)?,
                    data_enc: row.get(4)?,
                    size: row.get::<_, i64>(5)? as u64,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| CoreError::Storage(e.to_string()))
    }

    pub fn delete_local_attachment(&self, account_id: &str, attachment_id: &str) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            "DELETE FROM local_attachments WHERE account_id = ?1 AND id = ?2",
            params![account_id, attachment_id],
        )
        .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok(())
    }

    // --- Vaultwarden Sends Cache ---

    pub fn replace_synced_sends(&self, account_id: &str, sends: &[SendDto]) -> Result<(), CoreError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::Storage(format!("开启事务失败: {e}")))?;
        tx.execute("DELETE FROM sends WHERE account_id = ?1", params![account_id])
            .map_err(|e| CoreError::Storage(format!("清理 Send 缓存失败: {e}")))?;

        for s in sends {
            let raw_json = serde_json::to_string(s)
                .map_err(|e| CoreError::Storage(format!("序列化 Send 失败: {e}")))?;
            let rev = s.revision_date.clone().unwrap_or_default();
            tx.execute(
                r#"
                INSERT INTO sends (id, account_id, raw_json, revision_date)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(id) DO UPDATE SET
                    raw_json = excluded.raw_json,
                    revision_date = excluded.revision_date
                "#,
                params![s.id, account_id, raw_json, rev],
            )
            .map_err(|e| CoreError::Storage(format!("写入 Send 缓存失败: {e}")))?;
        }
        tx.commit()
            .map_err(|e| CoreError::Storage(format!("提交事务失败: {e}")))?;
        Ok(())
    }

    pub fn upsert_send(&self, account_id: &str, s: &SendDto) -> Result<(), CoreError> {
        let raw_json = serde_json::to_string(s)
            .map_err(|e| CoreError::Storage(format!("序列化 Send 失败: {e}")))?;
        let rev = s.revision_date.clone().unwrap_or_default();
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            r#"
            INSERT INTO sends (id, account_id, raw_json, revision_date)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                raw_json = excluded.raw_json,
                revision_date = excluded.revision_date
            "#,
            params![s.id, account_id, raw_json, rev],
        )
        .map_err(|e| CoreError::Storage(format!("保存 Send 缓存失败: {e}")))?;
        Ok(())
    }

    pub fn delete_send_row(&self, id: &str) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute("DELETE FROM sends WHERE id = ?1", params![id])
            .map_err(|e| CoreError::Storage(format!("删除 Send 缓存失败: {e}")))?;
        Ok(())
    }

    pub fn list_sends(&self, account_id: &str) -> Result<Vec<StoredSend>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let mut stmt = conn
            .prepare("SELECT id, account_id, raw_json, revision_date FROM sends WHERE account_id = ?1 ORDER BY revision_date DESC")
            .map_err(|e| CoreError::Storage(format!("查询 Send 缓存失败: {e}")))?;
        let rows = stmt
            .query_map(params![account_id], |row| {
                Ok(StoredSend {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    raw_json: row.get(2)?,
                    revision_date: row.get(3)?,
                })
            })
            .map_err(|e| CoreError::Storage(format!("读取 Send 行失败: {e}")))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::Storage(e.to_string()))?);
        }
        Ok(out)
    }

    // --- Favicon Cache ---

    pub fn get_favicon_cache(&self, host: &str) -> Result<Option<(String, String)>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.query_row(
            "SELECT data_uri, fetched_at FROM favicon_cache WHERE host = ?1",
            params![host],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| CoreError::Storage(e.to_string()))
    }

    pub fn upsert_favicon_cache(
        &self,
        host: &str,
        data_uri: &str,
        fetched_at: &str,
    ) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            r#"
            INSERT INTO favicon_cache (host, data_uri, fetched_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(host) DO UPDATE SET
                data_uri = excluded.data_uri,
                fetched_at = excluded.fetched_at
            "#,
            params![host, data_uri, fetched_at],
        )
        .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok(())
    }

    // --- App Settings & WAL Maintenance ---

    pub fn get_all_app_settings(&self) -> Result<HashMap<String, String>, CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        let mut stmt = conn
            .prepare("SELECT key, value FROM app_settings")
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let mut out = HashMap::new();
        for r in rows {
            let (k, v) = r.map_err(|e| CoreError::Storage(e.to_string()))?;
            out.insert(k, v);
        }
        Ok(out)
    }

    pub fn set_app_setting(&self, key: &str, value: &str) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute(
            r#"
            INSERT INTO app_settings (key, value)
            VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value
            "#,
            params![key, value],
        )
        .map_err(|e| CoreError::Storage(format!("保存应用设置失败: {e}")))?;
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
        Ok(())
    }

    pub fn wal_checkpoint(&self) -> Result<(), CoreError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| CoreError::Storage("数据库锁已损坏".to_string()))?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| CoreError::Storage(format!("同步数据库日志失败: {e}")))?;
        Ok(())
    }
}

pub fn new_device_identifier() -> String {
    Uuid::new_v4().to_string()
}
