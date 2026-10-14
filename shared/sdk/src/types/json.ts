type ObjectKeys<T> = T extends object ? keyof T : never;

export type JsonFields<T extends object> = { [Key in ObjectKeys<T>]?: unknown };
