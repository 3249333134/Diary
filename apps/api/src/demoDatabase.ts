import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Explicit demo-only adapter. Production continues to use MySQL. */
export function createDemoPool(path:string) {
  mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS diaries(user_id INTEGER NOT NULL,date TEXT NOT NULL,content TEXT NOT NULL,version TEXT NOT NULL,saved_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,date));
    CREATE TABLE IF NOT EXISTS settings(user_id INTEGER NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,key));
    CREATE TABLE IF NOT EXISTS assets(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,date TEXT NOT NULL,filename TEXT NOT NULL,path TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at TEXT NOT NULL);
    INSERT OR IGNORE INTO users(id,username,password_hash) VALUES(1,'本地演示','disabled');`);
  return {
    async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]> {
      let statement=sql.replace(/NOW\(\)/gi,'CURRENT_TIMESTAMP');
      if(/INSERT INTO diaries/i.test(statement))statement=statement.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i,'ON CONFLICT(user_id,date) DO UPDATE SET content=excluded.content,version=excluded.version,saved_at=CURRENT_TIMESTAMP');
      if(/INSERT INTO settings/i.test(statement))statement=statement.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i,'ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP');
      const values=params.map(p=>p instanceof Date?p.toISOString():p===undefined?null:p) as (string|number|null)[];
      const prepared=db.prepare(statement);
      if(/^\s*SELECT/i.test(statement))return [prepared.all(...values),[]];
      const result=prepared.run(...values);return [{insertId:Number(result.lastInsertRowid),affectedRows:Number(result.changes)},[]];
    },
    async end(){db.close();},
  };
}
