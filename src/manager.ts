import { PageConfig } from '@jupyterlab/coreutils';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { IStateDB } from '@jupyterlab/statedb';
import { IDisposable } from '@lumino/disposable';
import { Poll } from '@lumino/polling';
import { ISignal, Signal } from '@lumino/signaling';
import { IRecents, PluginIDs, Recents, StateIDs } from './token';

export namespace Utils {
  export function mergePaths(root: string, path: string): string {
    if (root.endsWith('/')) {
      root = root.slice(0, -1);
    }
    if (path.endsWith('/')) {
      path = path.slice(1);
    }
    return `${root}/${path}`;
  }
}

export class RecentsManager implements IRecents, IDisposable {
  constructor(stateDB: IStateDB, contents: Contents.IManager) {
    this._serverRoot = PageConfig.getOption('serverRoot');
    this._stateDB = stateDB;
    this._contentsManager = contents;

    this.loadRecents().catch(r => {
      console.error(`Failed to load recent list from state:\n${r}`);
    });
  }

  /**
   * Whether the manager is disposed or not.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * List of recently opened items
   */
  get recents(): Recents.Recent[] {
    const recents = this._recents || [];
    return recents.filter(r => r.root === this._serverRoot);
  }

  /**
   * Signal emitted when the recent list changes.
   */
  get recentsChanged(): ISignal<IRecents, Recents.Recent[]> {
    return this._recentsChanged;
  }

  /**
   * Maximal number of recent items to list.
   */
  get maximalRecentsLength(): number {
    return this._maxRecentsLength;
  }
  set maximalRecentsLength(value: number) {
    this._maxRecentsLength = Math.round(Math.max(1, value));
    if (this._recents.length > this._maxRecentsLength) {
      this._recents.length = this._maxRecentsLength;
      this._recentsChanged.emit(this._recents);
    }
  }

  /**
   * Dispose recent manager resources
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._poll?.dispose();
    Signal.clearData(this);
  }

  /**
   * Whether the recent list is validated regularly or not.
   */
  isPolling(): boolean {
    return this._poll !== null;
  }

  /**
   * Add a new path to the recent list.
   *
   * @param path Path
   * @param contentType Content type
   */
  addRecent(path: string, contentType: string): void {
    const recent: Recents.Recent = {
      root: this._serverRoot,
      path,
      contentType
    };
    const recents = this.recents;
    // Check if it's already present; if so remove it
    const existingIndex = recents.findIndex(r => r.path === path);
    if (existingIndex >= 0) {
      recents.splice(existingIndex, 1);
    }
    // Add to the front of the list
    recents.unshift(recent);

    this.setRecents(recents);
  }

  /**
   * Clear the recents list
   */
  clearRecents(): void {
    this.recents.length = 0;
  }

  /**
   * Remove paths from recent lis
   *
   * @param paths Path to remove
   */
  removeRecents(...paths: string[]): void {
    const recents = this.recents;
    const newRecents = recents.filter(r => paths.indexOf(r.path) === -1);
    if (recents.length !== newRecents.length) {
      this.setRecents(newRecents);
    }
  }

  /**
   * Check that the recent items are valid.
   */
  async validate(): Promise<void> {
    if (this._poll) {
      await this._poll.refresh();
      await this._poll.tick;
    } else {
      this.removeRecents(...(await this.getInvalidRecents()));
    }
  }

  /**
   * Set the poll interval for refreshing recent list.
   *
   * @param value Interval in seconds
   */
  setPollInterval(value: number): void {
    if (value <= 0) {
      this._poll?.dispose();
      this._poll = null;
    } else {
      if (!this._poll) {
        this._poll = new Poll({
          auto: true,
          factory: async () => {
            this.removeRecents(...(await this.getInvalidRecents()));
          },
          frequency: {
            interval: value * 1000,
            backoff: true,
            max: Math.max(300 * 1000, 5 * value * 1000)
          },
          name: `${PluginIDs.recents}:recents`,
          standby: 'when-hidden'
        });
      } else {
        this._poll.frequency = {
          interval: value * 1000,
          backoff: true,
          max: Math.max(300 * 1000, 5 * value * 1000)
        };
      }
    }
  }

  /**
   * Set the recent list
   * @param recents The new recent list
   */
  protected setRecents(recents: Recents.Recent[]): void {
    this._recents = recents.slice(0, this.maximalRecentsLength).sort((a, b) => {
      if (a.root === b.root) {
        return 0;
      } else {
        return a.root !== this._serverRoot ? 1 : -1;
      }
    });
    this.saveRecents();
    this._recentsChanged.emit(this.recents);
  }

  /**
   * Get the list of invalid path in recents.
   */
  protected async getInvalidRecents(
    recents?: Recents.Recent[]
  ): Promise<string[]> {
    const _recents = recents ?? this.recents;

    const invalidPathsOrNulls = await Promise.all(
      _recents.map(async r => {
        try {
          await this._contentsManager.get(r.path, { content: false });
          return null;
        } catch (e) {
          if ((e as ServerConnection.ResponseError).response?.status === 404) {
            return r.path;
          }
        }
      })
    );
    return invalidPathsOrNulls.filter(x => typeof x === 'string') as string[];
  }

  /**
   * Load the recent items from the state.
   */
  protected async loadRecents(): Promise<void> {
    const recents =
      ((await this._stateDB.fetch(StateIDs.recents)) as Recents.Recent[]) || [];
    const invalidPaths = await this.getInvalidRecents(recents);

    this.setRecents(recents.filter(r => !invalidPaths.includes(r.path)));
  }

  /**
   * Save the recent items to the state.
   */
  protected saveRecents(): void {
    clearTimeout(this._saveRoutine);
    // Save _recents 500 ms after the last time saveRecents has been called
    this._saveRoutine = setTimeout(async () => {
      // If there's a previous request pending, wait 500 ms and try again
      if (this._awaitingSaveCompletion) {
        this.saveRecents();
      } else {
        this._awaitingSaveCompletion = true;
        try {
          await this._stateDB.save(StateIDs.recents, this._recents);
          this._awaitingSaveCompletion = false;
        } catch (e) {
          this._awaitingSaveCompletion = false;
          console.log('Saving recents failed');
          // Try again
          this.saveRecents();
        }
      }
    }, 500);
  }

  private _recentsChanged = new Signal<this, Recents.Recent[]>(this);
  private _serverRoot: string;
  private _stateDB: IStateDB;
  private _contentsManager: Contents.IManager;
  private _recents: Recents.Recent[] = [];
  // Will store a Timemout call that saves recents changes after a delay
  private _saveRoutine: ReturnType<typeof setTimeout> | undefined;
  // Whether there are local changes sent to be recorded without verification
  private _awaitingSaveCompletion = false;

  private _isDisposed = false;
  private _poll: Poll | null = null;

  private _maxRecentsLength = 10;
}
