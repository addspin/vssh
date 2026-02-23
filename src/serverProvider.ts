import * as vscode from 'vscode';
import { ServerConfig, FolderConfig } from './types';
import { SSHConfigManager } from './sshConfig';

export class ServerItem extends vscode.TreeItem {
    constructor(
        public readonly server: ServerConfig
    ) {
        super(server.name, vscode.TreeItemCollapsibleState.None);

        this.tooltip = `${server.username}@${server.host}:${server.port}`;
        this.description = `${server.host}:${server.port}`;
        this.iconPath = new vscode.ThemeIcon('terminal');
        this.contextValue = 'server';
        
        // Клик для подключения
        this.command = {
            command: 'vssh.connect',
            title: 'Connect to Server',
            arguments: [this]
        };
    }
}

export class FolderItem extends vscode.TreeItem {
    constructor(
        public readonly folderId: string,
        public readonly folderName: string,
        public readonly parentFolder?: string,
        public readonly color?: string
    ) {
        super(folderName, vscode.TreeItemCollapsibleState.Expanded);

        // Маппинг цветов на ThemeColor
        const colorMap: {[key: string]: string} = {
            '#4a90d9': 'charts.blue',
            '#50a14f': 'charts.green',
            '#c1a043': 'charts.yellow',
            '#d48c21': 'charts.orange',
            '#e05555': 'charts.red',
            '#a655d9': 'charts.purple',
            '#858585': 'charts.grey'
        };
        
        // Иконка папки с цветом
        const themeColorId = color ? colorMap[color] : undefined;
        const themeColor = themeColorId ? new vscode.ThemeColor(themeColorId) : undefined;
        this.iconPath = new vscode.ThemeIcon('folder', themeColor);
        this.contextValue = 'folder';
    }
}

export type VsshTreeItem = ServerItem | FolderItem;

export class ServerProvider implements vscode.TreeDataProvider<VsshTreeItem>, vscode.TreeDragAndDropController<VsshTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<VsshTreeItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<VsshTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private folders: Map<string, ServerConfig[]> = new Map();
    private rootServers: ServerConfig[] = [];
    private folderHierarchy: Map<string, string[]> = new Map();

    dragMimeTypes: string[] = ['application/vnd.code.tree.vssh'];
    dropMimeTypes: string[] = ['application/vnd.code.tree.vssh'];

    constructor(private sshConfigManager: SSHConfigManager) {
        this.loadServers();
    }

    refresh(): void {
        this.loadServers();
        this._onDidChangeTreeData.fire();
    }

    private loadServers(): void {
        const servers = this.sshConfigManager.getServers();
        const folders = this.sshConfigManager.getFolders();

        this.folders.clear();
        this.rootServers = [];
        this.folderHierarchy.clear();

        folders.forEach(folder => {
            const folderId = folder.id || folder.name; // Для обратной совместимости
            const parent = folder.parentFolder;
            if (parent) {
                const existing = this.folderHierarchy.get(parent) || [];
                existing.push(folderId);
                this.folderHierarchy.set(parent, existing);
            }
            this.folders.set(folderId, []);
        });

        servers.forEach(server => {
            if (server.folder) {
                const existing = this.folders.get(server.folder) || [];
                existing.push(server);
                this.folders.set(server.folder, existing);
            } else {
                this.rootServers.push(server);
            }
        });
    }

    getTreeItem(element: VsshTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: VsshTreeItem): Promise<VsshTreeItem[]> {
        if (!element) {
            const items: VsshTreeItem[] = [];

            for (const [folderId] of this.folders.entries()) {
                const folder = this.sshConfigManager.getFolder(folderId);
                if (folder && !folder.parentFolder) {
                    items.push(new FolderItem(folder.id, folder.name, undefined, folder.color));
                }
            }

            items.push(...this.rootServers.map(s => new ServerItem(s)));

            return Promise.resolve(items);
        }

        if (element instanceof FolderItem) {
            const result: VsshTreeItem[] = [];

            const childFolderIds = this.folderHierarchy.get(element.folderId) || [];
            childFolderIds.forEach(childFolderId => {
                const folder = this.sshConfigManager.getFolder(childFolderId);
                if (folder) {
                    result.push(new FolderItem(folder.id, folder.name, element.folderId, folder.color));
                }
            });

            const servers = this.folders.get(element.folderId) || [];
            result.push(...servers.map(s => new ServerItem(s)));

            return Promise.resolve(result);
        }

        return Promise.resolve([]);
    }

    getParent(element: VsshTreeItem): vscode.ProviderResult<VsshTreeItem> {
        if (element instanceof ServerItem && element.server.folder) {
            const folder = this.sshConfigManager.getFolder(element.server.folder);
            if (folder) {
                return new FolderItem(folder.id, folder.name, folder.parentFolder, folder.color);
            }
        }
        if (element instanceof FolderItem && element.parentFolder) {
            const parent = this.sshConfigManager.getFolder(element.parentFolder);
            if (parent) {
                return new FolderItem(parent.id, parent.name, parent.parentFolder, parent.color);
            }
        }
        return undefined;
    }

    addFolder(name: string, parentFolder?: string, color?: string): void {
        this.sshConfigManager.addFolder(name, parentFolder, color);
    }

    renameFolder(folderId: string, newName: string, newColor?: string): void {
        const folder = this.sshConfigManager.getFolder(folderId);
        if (folder) {
            if (newName) {
                this.sshConfigManager.renameFolder(folderId, newName);
            }
            if (newColor !== undefined) {
                folder.color = newColor;
                this.sshConfigManager.updateFolder(folder);
            }
        }
    }

    deleteFolder(folderId: string): void {
        const allChildFolders = this.getAllChildFolders(folderId);
        
        // Находим все серверы в удаляемой папке и подпапках
        const serversToDelete: ServerConfig[] = [];
        const folderServers = this.folders.get(folderId);
        if (folderServers) {
            serversToDelete.push(...folderServers);
        }
        
        for (const childFolderId of allChildFolders) {
            const childServers = this.folders.get(childFolderId);
            if (childServers) {
                serversToDelete.push(...childServers);
            }
        }
        
        // Удаляем серверы
        for (const server of serversToDelete) {
            this.sshConfigManager.deleteServer(server.name);
        }
        
        // Удаляем подпапки из иерархии
        for (const childFolderId of allChildFolders) {
            this.folderHierarchy.delete(childFolderId);
            this.folders.delete(childFolderId);
        }
        
        // Удаляем папку из иерархии
        this.folderHierarchy.delete(folderId);
        
        // Удаляем папку из конфигурации
        this.sshConfigManager.deleteFolder(folderId);
        
        // Удаляем из локального кэша
        this.folders.delete(folderId);
    }

    private getAllChildFolders(folderId: string): string[] {
        const result: string[] = [];
        const directChildren = this.folderHierarchy.get(folderId) || [];

        for (const child of directChildren) {
            result.push(child);
            const grandchildren = this.getAllChildFolders(child);
            result.push(...grandchildren);
        }

        return result;
    }

    getFolders(): FolderConfig[] {
        return this.sshConfigManager.getFolders();
    }

    handleDrag(source: readonly VsshTreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
        const items = source.map(item => {
            if (item instanceof ServerItem) {
                return { type: 'server', name: item.server.name };
            } else if (item instanceof FolderItem) {
                return { type: 'folder', id: item.folderId, name: item.folderName, parentFolder: item.parentFolder };
            }
            return null;
        }).filter(Boolean);

        if (items.length > 0) {
            const jsonStr = JSON.stringify(items);
            dataTransfer.set('application/vnd.code.tree.vssh', new vscode.DataTransferItem(jsonStr));
        }
    }

    async handleDrop(target: VsshTreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const dataItem = dataTransfer.get('application/vnd.code.tree.vssh');
        if (!dataItem) {
            return;
        }

        const dataStr = await dataItem.asString();
        const items = JSON.parse(dataStr);

        for (const item of items) {
            if (item.type === 'server' && target instanceof FolderItem) {
                await this.sshConfigManager.moveServer(item.name, target.folderId);
            } else if (item.type === 'server' && !target) {
                await this.sshConfigManager.moveServer(item.name, undefined);
            } else if (item.type === 'folder' && target instanceof FolderItem && item.id !== target.folderId) {
                await this.sshConfigManager.moveFolder(item.id, target.folderId);
            } else if (item.type === 'folder' && !target) {
                // Перемещение папки в корень
                await this.sshConfigManager.moveFolder(item.id, undefined);
            }
        }

        this.refresh();
    }
}
