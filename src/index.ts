import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStateDB } from '@jupyterlab/statedb';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { PromiseDelegate } from '@lumino/coreutils';
import { Message } from '@lumino/messaging';
import { Menu } from '@lumino/widgets';
import { RecentsManager, Utils } from './manager';
import { CommandIDs, IRecents, PluginIDs, Recents } from './token';

export { IRecents, Recents } from './token';

/**
 * Recents submenu
 *
 * It will update onBeforeAttach if polling is not active.
 */
class RecentsMenu extends Menu {
  constructor(options: Menu.IOptions & { manager: RecentsManager }) {
    super(options);
    this._manager = options.manager;

    this._manager.recentsChanged.connect(this.updateItems, this);
  }

  protected onBeforeAttach(msg: Message): void {
    if (!this._manager.isPolling()) {
      const timeout = new PromiseDelegate<void>();
      setTimeout(() => {
        timeout.reject('Recents validation timed out.');
      }, 150);
      Promise.race([timeout.promise, this._manager.validate()])
        .then(() => {
          this.update();
        })
        .catch(() => {
          // no-op
        });
    }
    super.onBeforeAttach(msg);
  }

  protected updateItems(): void {
    // We cannot edit the item list on the fly because it will close
    // the menu - so we use `isVisible` in the command and trigger a
    // UI update to emulate that.
    this.clearItems();
    let addSeparator = true;
    this._manager.recents
      .sort((a, b) => {
        if (a.contentType === b.contentType) {
          return 0;
        } else {
          return a.contentType !== 'directory' ? 1 : -1;
        }
      })
      .forEach(recent => {
        if (addSeparator && recent.contentType !== 'directory') {
          addSeparator = false;
          this.addItem({ type: 'separator' });
        }
        this.addItem({
          command: CommandIDs.openRecent,
          args: { recent }
        });
      });
    this.addItem({ type: 'separator' });
    this.addItem({
      command: CommandIDs.clearRecents
    });
  }

  private _manager: RecentsManager;
}

const extension: JupyterFrontEndPlugin<IRecents> = {
  id: `${PluginIDs.recents}:plugin`,
  autoStart: true,
  requires: [IStateDB, IMainMenu, IDocumentManager],
  optional: [ISettingRegistry, ITranslator],
  provides: IRecents,
  activate: (
    app: JupyterFrontEnd,
    stateDB: IStateDB,
    mainMenu: IMainMenu,
    docManager: IDocumentManager,
    settingRegistry: ISettingRegistry | null,
    translator: ITranslator | null
  ): IRecents => {
    const { commands, serviceManager } = app;
    const trans = (translator ?? nullTranslator).load('jupyterlab-recents');

    // Commands
    commands.addCommand(CommandIDs.openRecent, {
      execute: async args => {
        const recent = args.recent as Recents.Recent;
        const path = recent.path === '' ? '/' : recent.path;
        await commands.execute('filebrowser:open-path', { path });
        // If path not found, validating will remove it after an error message
        await recentsManager.validate();
      },
      label: args => {
        const recent = args.recent as Recents.Recent;
        return Utils.mergePaths(recent.root, recent.path);
      },
      isVisible: args =>
        recentsManager.recents.includes(args.recent as Recents.Recent)
    });
    commands.addCommand(CommandIDs.clearRecents, {
      execute: () => {
        recentsManager.clearRecents();
      },
      label: trans.__('Clear Recents'),
      caption: trans.__('Clear the list of recently opened items.')
    });

    // Create the manager
    const recentsManager = new RecentsManager(stateDB, serviceManager.contents);

    const updateSettings = (settings: ISettingRegistry.ISettings) => {
      recentsManager.maximalRecentsLength = settings.get('length')
        .composite as number;
      recentsManager.setPollInterval(
        settings.get('pollFrequency').composite as number
      );
    };

    if (settingRegistry) {
      Promise.all([
        app.restored,
        settingRegistry.load(`${PluginIDs.contrib}:plugin`)
      ]).then(([_, settings]) => {
        settings.changed.connect(updateSettings);
        updateSettings(settings);
      });
    }

    docManager.activateRequested.connect(async (_, path) => {
      const item = await docManager.services.contents.get(path, {
        content: false
      });
      const fileType = app.docRegistry.getFileTypeForModel(item);
      const contentType = fileType.contentType;
      recentsManager.addRecent(path, contentType);
      // Add the containing directory, too
      if (contentType !== 'directory') {
        const parent =
          path.lastIndexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '';
        recentsManager.addRecent(parent, 'directory');
      }
    });

    // Main menu
    const submenu = new RecentsMenu({ commands, manager: recentsManager });
    submenu.title.label = trans.__('Recents');
    mainMenu.fileMenu.addGroup(
      [
        {
          type: 'submenu' as Menu.ItemType,
          submenu
        }
      ],
      1
    );

    return recentsManager;
  }
};

export default extension;
