import * as vscode from 'vscode';
import { TunnelConfig } from './types';
import { TunnelManager } from './tunnelManager';

export class TunnelItem extends vscode.TreeItem {
    constructor(
        public readonly tunnel: TunnelConfig,
        private readonly isActive: boolean
    ) {
        super(
            `${tunnel.serverName}:${tunnel.localPort}`,
            vscode.TreeItemCollapsibleState.None
        );

        this.description = `${tunnel.remoteHost}:${tunnel.remotePort}`;
        this.tooltip = `localhost:${tunnel.localPort} -> ${tunnel.remoteHost}:${tunnel.remotePort}\nСервер: ${tunnel.serverName}\nАвтозапуск: ${tunnel.autoStart ? 'Да' : 'Нет'}`;
        
        const statusIcon = isActive ? 'debug-start' : 'debug-stop';
        const autoIcon = tunnel.autoStart ? '🚀' : '';
        this.iconPath = new vscode.ThemeIcon(statusIcon, isActive ? new vscode.ThemeColor('charts.green') : new vscode.ThemeColor('charts.grey'));
        
        this.contextValue = isActive ? 'activeTunnel' : 'savedTunnel';
        
        // Добавляем префикс с emoji для автозапуска
        if (tunnel.autoStart) {
            this.label = `🚀 ${tunnel.serverName}:${tunnel.localPort}`;
        }
    }
}

export class TunnelProvider implements vscode.TreeDataProvider<TunnelItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TunnelItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<TunnelItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private tunnelManager: TunnelManager) {
        tunnelManager.onDidChangeTunnels(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TunnelItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TunnelItem): Promise<TunnelItem[]> {
        if (element) {
            return [];
        }

        const tunnels = this.tunnelManager.getSavedTunnels();
        
        return tunnels.map(tunnel => {
            const isActive = this.tunnelManager.getActiveTunnels().some(at => at.localPort === tunnel.localPort);
            return new TunnelItem(tunnel, isActive);
        });
    }

    getParent(element: TunnelItem): vscode.ProviderResult<TunnelItem> {
        return undefined;
    }
}
