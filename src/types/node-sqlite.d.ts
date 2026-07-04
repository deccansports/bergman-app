declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: any);
    prepare(sql: string): {
      all(params?: any): any[];
      get(params?: any): any;
      run(params?: any): any;
    };
    exec(sql: string): void;
    close(): void;
  }
}
