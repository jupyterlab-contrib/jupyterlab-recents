import { Token } from '@lumino/coreutils';

export namespace types {
    export type Recent = {
      root: string;
      path: string;
      contentType: string;
    };
  }

export const IRecents = new Token<IRecents>('jupyterlab-recents:IRecents');

export interface IRecents {
  readonly recents: types.Recent[];
}