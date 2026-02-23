import * as vscode from 'vscode';
import { SSHFavorite, ServerConfig } from './types';
import * as crypto from 'crypto';

function generateId(): string {
    return crypto.randomBytes(16).toString('hex');
}

export class FavoriteManager {
    private favorites: SSHFavorite[] = [];
    private _onDidChangeFavorites: vscode.EventEmitter<void> = new vscode.EventEmitter();
    readonly onDidChangeFavorites: vscode.Event<void> = this._onDidChangeFavorites.event;

    constructor(private sshConfigManager: any) {
        this.loadFavorites();
    }

    private loadFavorites(): void {
        const favoritesData = (this.sshConfigManager as any).data.favorites || [];
        this.favorites = favoritesData;
    }

    private saveFavorites(): void {
        (this.sshConfigManager as any).data.favorites = this.favorites;
        (this.sshConfigManager as any).save();
    }

    async addFavorite(server: ServerConfig, favoriteName?: string): Promise<SSHFavorite> {
        // Проверяем есть ли уже такой сервер в избранном
        const existing = this.favorites.find(f => f.serverId === server.name || f.serverName === server.name);
        if (existing) {
            vscode.window.showInformationMessage(`Сервер "${server.name}" уже в избранном`);
            return existing;
        }

        const name = favoriteName || server.name;
        
        const favorite: SSHFavorite = {
            id: generateId(),
            name,
            serverName: server.name,
            serverId: server.name,
            savedAt: new Date().toISOString()
        };

        this.favorites.push(favorite);
        this.saveFavorites();
        this._onDidChangeFavorites.fire();

        vscode.window.showInformationMessage(`Сервер "${name}" добавлен в избранное`);
        return favorite;
    }

    getFavorites(): SSHFavorite[] {
        return this.favorites;
    }

    async removeFavorite(favoriteId: string): Promise<void> {
        this.favorites = this.favorites.filter(f => f.id !== favoriteId);
        this.saveFavorites();
        this._onDidChangeFavorites.fire();
    }

    async clearAllFavorites(): Promise<void> {
        this.favorites = [];
        this.saveFavorites();
        this._onDidChangeFavorites.fire();
        vscode.window.showInformationMessage('Все избранные серверы удалены');
    }

    async connectToFavorite(favorite: SSHFavorite): Promise<void> {
        const servers = this.sshConfigManager.getServers();
        const server = servers.find((s: any) => s.name === favorite.serverId || s.name === favorite.serverName);
        
        if (!server) {
            vscode.window.showErrorMessage(`Сервер "${favorite.serverName}" не найден`);
            return;
        }

        // Подключаемся через команду vssh.connect
        const ServerItem = require('./serverProvider').ServerItem;
        vscode.commands.executeCommand('vssh.connect', new ServerItem(server));
    }

    dispose(): void {
        this._onDidChangeFavorites.dispose();
    }
}
