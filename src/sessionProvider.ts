import * as vscode from 'vscode';
import { SSHSession } from './types';
import { SessionManager } from './sessionManager';

// Элемент сессии (папка)
export class SessionGroupItem extends vscode.TreeItem {
    constructor(
        public readonly session: SSHSession
    ) {
        super(session.name, vscode.TreeItemCollapsibleState.Expanded);

        this.description = `${session.servers.length} серверов`;
        this.tooltip = `Сессия: ${session.name}\nСерверов: ${session.servers.length}\nСоздана: ${new Date(session.savedAt).toLocaleString()}`;
        
        this.iconPath = new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('charts.blue'));
        this.contextValue = 'sessionGroup';
    }
}

// Элемент сервера в сессии
export class SessionServerItem extends vscode.TreeItem {
    constructor(
        public readonly serverName: string,
        public readonly sessionId: string,
        private readonly sshConfigManager: any
    ) {
        super(serverName, vscode.TreeItemCollapsibleState.None);

        // Получаем информацию о сервере для отображения
        const servers = sshConfigManager.getServers();
        const server = servers.find((s: any) => s.name === serverName);
        
        if (server) {
            this.description = `${server.host}:${server.port}`;
            this.tooltip = `Сервер: ${server.name}\nХост: ${server.host}:${server.port}\nПользователь: ${server.username}`;
        } else {
            this.description = 'Сервер не найден';
            this.tooltip = `Сервер: ${serverName}`;
        }
        
        this.iconPath = new vscode.ThemeIcon('remote-explorer');
        this.contextValue = 'sessionServer';
    }
}

export type SessionTreeItem = SessionGroupItem | SessionServerItem;

export class SessionProvider implements vscode.TreeDataProvider<SessionTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionTreeItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SessionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private sessionManager: SessionManager, private sshConfigManager: any) {
        sessionManager.onDidChangeSessions(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SessionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
        if (element) {
            // Если это сессия - возвращаем серверы
            if (element instanceof SessionGroupItem) {
                return element.session.servers.map(
                    serverName => new SessionServerItem(serverName, element.session.id, this.sshConfigManager)
                );
            }
            return [];
        }

        // Корневой уровень - сессии
        const sessions = this.sessionManager.getSessions();
        return sessions.map(session => new SessionGroupItem(session));
    }

    getParent(element: SessionTreeItem): vscode.ProviderResult<SessionTreeItem> {
        return undefined;
    }
}
