export interface GlobalOptions {
  json: boolean;
  noInput: boolean;
  cwd: string;
}

let globalOptions: GlobalOptions = {
  json: false,
  noInput: false,
  cwd: process.cwd(),
};

export function setGlobalOptions(opts: GlobalOptions): void {
  globalOptions = opts;
}

export function getGlobalOptions(): GlobalOptions {
  return globalOptions;
}
