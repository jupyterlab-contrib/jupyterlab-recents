import { Token } from '@lumino/coreutils';
import { ISignal } from '@lumino/signaling';

export namespace PluginIDs {
  export const recents = 'jupyterlab-recents';
  /**
   * We must respect the package name to resolve settings schema path
   */
  export const contrib = '@jlab-enhanced/recents';
}

export const IRecents = new Token<IRecents>(`${PluginIDs.recents}:IRecents`);

/**
 * Recent opened items manager
 */
export interface IRecents {
  /**
   * Get the recently opened items.
   */
  readonly recents: Recents.Recent[];

  /**
   * Signal emitted when the recent list changes.
   */
  readonly recentsChanged: ISignal<IRecents, Recents.Recent[]>;
}

export namespace Recents {
  export type Recent = {
    root: string;
    path: string;
    contentType: string;
  };
}

export namespace StateIDs {
  export const recents = `${PluginIDs.recents}:recents`;
}

export namespace CommandIDs {
  export const openRecent = `${PluginIDs.recents}:open-recent`;
  export const clearRecents = `${PluginIDs.recents}:clear-recents`;
}
