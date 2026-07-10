import {getTableConfig} from "drizzle-orm/sqlite-core";

function convert_table_to_sqlite_sql(table: any): string {
    const config = getTableConfig(table);

    const convertType = (column: any) => {
        const c = column.config;

        // SQLite AUTOINCREMENT 强制要求 INTEGER PRIMARY KEY
        if (c.primaryKey && c.autoIncrement) {
            return "INTEGER";
        }

        switch (c.dataType?.toLowerCase()) {
            case "number":
            case "integer":
                return "INTEGER";

            case "boolean":
                return "INTEGER";

            case "string":
            case "text":
                return "TEXT";

            case "json":
                return "TEXT";

            case "real":
            case "number":
                return "REAL";

            default:
                return c.dataType?.toUpperCase() ?? "TEXT";
        }
    };


    const columns = config.columns.map((column: any) => {
        const c = column.config;

        const sql: string[] = [];

        sql.push(`"${c.name}"`);

        // 类型
        sql.push(convertType(column));


        // PRIMARY KEY
        if (c.primaryKey) {
            sql.push("PRIMARY KEY");

            // SQLite 只允许 INTEGER PRIMARY KEY AUTOINCREMENT
            if (c.autoIncrement) {
                sql.push("AUTOINCREMENT");
            }
        }


        // NOT NULL
        if (c.notNull) {
            sql.push("NOT NULL");
        }


        // UNIQUE
        if (c.isUnique) {
            sql.push("UNIQUE");
        }


        // DEFAULT
        if (c.default !== undefined && c.default !== null) {
            let value = c.default;


            if (typeof value === "string") {
                value = `'${value.replace(/'/g, "''")}'`;
            } else if (typeof value === "boolean") {
                value = value ? 1 : 0;
            } else if (typeof value === "function") {
                // Drizzle 默认值函数，例如 sql`CURRENT_TIMESTAMP`
                value = value();
            }


            sql.push(`DEFAULT ${value}`);
        }


        return sql.join(" ");
    });


    return `CREATE TABLE IF NOT EXISTS "${config.name}" (\n    ${columns.join(",\n    ")}\n);`;
}

export const orm_utils = {
    convert_table_to_sqlite_sql,
}