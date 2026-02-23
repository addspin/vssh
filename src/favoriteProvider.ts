import * as vscode from 'vscode';
import { SSHFavorite } from './types';
import { FavoriteManager } from './favoriteManager';

export class FavoriteItem extends vscode.TreeItem {
    constructor(
        public readonly favorite: SSHFavorite
    ) {
        super(favorite.name, vscode.TreeItemCollapsibleState.None);

        this.description = favorite.serverName;
        this.tooltip = `Сервер: ${favorite.serverName}\nДобавлено: ${new Date(favorite.savedAt).toLocaleString()}`;
        
        this.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
        this.contextValue = 'sshFavorite';
        
        // Команда при клике
        this.command = {
            command: 'vssh.openFavorite',
            title: 'Open Favorite',
            arguments: [this]
        };
    }
}

export class FavoriteProvider implements vscode.TreeDataProvider<FavoriteItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FavoriteItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<FavoriteItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private favoriteManager: FavoriteManager) {
        favoriteManager.onDidChangeFavorites(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FavoriteItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FavoriteItem): Promise<FavoriteItem[]> {
        if (element) {
            return [];
        }

        const favorites = this.favoriteManager.getFavorites();
        
        return favorites.map(favorite => new FavoriteItem(favorite));
    }

    getParent(element: FavoriteItem): vscode.ProviderResult<FavoriteItem> {
        return undefined;
    }
}
