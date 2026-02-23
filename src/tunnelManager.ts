import * as vscode from 'vscode';
import { ServerConfig, TunnelConfig } from './types';
import { Client } from 'ssh2';
import * as crypto from 'crypto';

function generateId(): string {
    return crypto.randomBytes(16).toString('hex');
}

export class TunnelManager {
    private tunnels: Map<number, { client: Client; config: TunnelConfig }> = new Map();
    private savedTunnels: TunnelConfig[] = [];
    private _onDidChangeTunnels: vscode.EventEmitter<void> = new vscode.EventEmitter();
    readonly onDidChangeTunnels: vscode.Event<void> = this._onDidChangeTunnels.event;

    constructor(private sshConfigManager: any) {
        this.loadTunnels();
    }

    private loadTunnels(): void {
        const servers = this.sshConfigManager.getServers();
        const tunnelsData = (this.sshConfigManager as any).data.tunnels || [];
        
        this.savedTunnels = tunnelsData.map((t: any) => {
            // Находим сервер по имени или ID
            const server = servers.find((s: any) => s.name === t.serverName || s.id === t.serverId);
            if (server) {
                t.serverId = server.name; // Используем имя как ID для обратной совместимости
            }
            t.isActive = false; // Туннели не активны после перезагрузки
            return t;
        });
    }

    private saveTunnels(): void {
        (this.sshConfigManager as any).data.tunnels = this.savedTunnels;
        (this.sshConfigManager as any).save();
    }

    async createTunnel(
        server: ServerConfig,
        localPort: number,
        remoteHost: string,
        remotePort: number,
        autoStart: boolean = false
    ): Promise<void> {
        // Проверяем, не занят ли порт
        if (this.tunnels.has(localPort)) {
            vscode.window.showErrorMessage(`Порт ${localPort} уже используется`);
            return;
        }

        const client = new Client();

        return new Promise((resolve, reject) => {
            const sshConfig: any = {
                host: server.host,
                port: server.port,
                username: server.username,
            };

            // Настройка Gateway (Bastion/Jump Host)
            if (server.gateway) {
                const gateway = server.gateway;
                
                // Базовая конфигурация gateway
                const gatewayConfig: any = {
                    host: gateway.host,
                    port: gateway.port,
                    username: gateway.username,
                };
                
                // Аутентификация gateway
                if (gateway.authMethod === 'privateKey' && gateway.privateKeyPath) {
                    try {
                        const fs = require('fs');
                        gatewayConfig.privateKey = fs.readFileSync(gateway.privateKeyPath);
                    } catch (error) {
                        reject(new Error(`Не удалось прочитать ключ gateway: ${error}`));
                        return;
                    }
                } else if (gateway.authMethod === 'password' && gateway.password) {
                    gatewayConfig.password = gateway.password;
                }
                
                // Используем bastion для подключения
                sshConfig.bastion = gatewayConfig;
            }

            // Аутентификация основного сервера
            if (server.authMethod === 'privateKey' && server.privateKeyPath) {
                try {
                    const fs = require('fs');
                    sshConfig.privateKey = fs.readFileSync(server.privateKeyPath);
                } catch (error) {
                    reject(new Error(`Не удалось прочитать ключ: ${error}`));
                    return;
                }
            } else if (server.authMethod === 'password' && server.password) {
                sshConfig.password = server.password;
            }

            client.on('ready', () => {
                client.forwardIn('localhost', localPort, (err: any) => {
                    if (err) {
                        client.end();
                        reject(new Error(`Ошибка создания туннеля: ${err.message}`));
                        return;
                    }

                    const tunnelConfig: TunnelConfig = {
                        id: generateId(),
                        serverName: server.name,
                        serverId: server.name,
                        localPort,
                        remoteHost,
                        remotePort,
                        isActive: true,
                        autoStart
                    };

                    this.tunnels.set(localPort, { client, config: tunnelConfig });
                    
                    // Сохраняем туннель если он новый
                    if (!this.savedTunnels.find(t => t.localPort === localPort)) {
                        this.savedTunnels.push(tunnelConfig);
                        this.saveTunnels();
                    } else {
                        const saved = this.savedTunnels.find(t => t.localPort === localPort);
                        if (saved) {
                            saved.isActive = true;
                            this.saveTunnels();
                        }
                    }

                    this._onDidChangeTunnels.fire();

                    const gatewayInfo = server.gateway ? ` через ${server.gateway.host}` : '';
                    vscode.window.showInformationMessage(
                        `Туннель создан${gatewayInfo}: localhost:${localPort} -> ${remoteHost}:${remotePort}`
                    );
                    resolve();
                });
            });

            client.on('error', (err: Error) => {
                vscode.window.showErrorMessage(`SSH ошибка: ${err.message}`);
                reject(err);
            });

            client.connect(sshConfig);
        });
    }

    async closeTunnel(localPort: number): Promise<void> {
        const tunnel = this.tunnels.get(localPort);
        if (tunnel) {
            tunnel.client.end();
            this.tunnels.delete(localPort);
            
            const saved = this.savedTunnels.find(t => t.localPort === localPort);
            if (saved) {
                saved.isActive = false;
                this.saveTunnels();
            }
            
            this._onDidChangeTunnels.fire();
            vscode.window.showInformationMessage(`Туннель на порту ${localPort} закрыт`);
        }
    }

    async deleteTunnel(localPort: number): Promise<void> {
        // Сначала закрываем если активен
        await this.closeTunnel(localPort);
        
        // Удаляем из сохранённых
        this.savedTunnels = this.savedTunnels.filter(t => t.localPort !== localPort);
        this.saveTunnels();
        this._onDidChangeTunnels.fire();
    }

    getActiveTunnels(): TunnelConfig[] {
        const result: TunnelConfig[] = [];
        for (const [, tunnel] of this.tunnels.entries()) {
            result.push(tunnel.config);
        }
        return result;
    }

    getSavedTunnels(): TunnelConfig[] {
        return this.savedTunnels;
    }

    async startTunnel(localPort: number): Promise<void> {
        const savedTunnel = this.savedTunnels.find(t => t.localPort === localPort);
        if (!savedTunnel) {
            throw new Error('Туннель не найден');
        }

        if (this.tunnels.has(localPort)) {
            throw new Error('Туннель уже активен');
        }

        const servers = this.sshConfigManager.getServers();
        const server = servers.find((s: any) => s.name === savedTunnel.serverId);
        
        if (!server) {
            throw new Error(`Сервер "${savedTunnel.serverName}" не найден`);
        }

        await this.createTunnel(
            server,
            savedTunnel.localPort,
            savedTunnel.remoteHost,
            savedTunnel.remotePort,
            savedTunnel.autoStart
        );
    }

    async startAllAutoTunnels(): Promise<void> {
        const autoTunnels = this.savedTunnels.filter(t => t.autoStart && !t.isActive);
        
        if (autoTunnels.length === 0) {
            return;
        }

        vscode.window.showInformationMessage(`Запуск ${autoTunnels.length} автотуннелей...`);

        for (const tunnel of autoTunnels) {
            try {
                await this.startTunnel(tunnel.localPort);
            } catch (error: any) {
                vscode.window.showErrorMessage(
                    `Не удалось запустить туннель ${tunnel.localPort}: ${error.message}`
                );
            }
        }
    }

    dispose(): void {
        for (const [port, tunnel] of this.tunnels.entries()) {
            tunnel.client.end();
        }
        this.tunnels.clear();
    }
}
