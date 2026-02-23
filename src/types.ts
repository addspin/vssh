import * as vscode from 'vscode';

export interface SSHFavorite {
    id: string;
    name: string;
    serverName: string;
    serverId: string;
    savedAt: string;
}

export interface ServerConfig {
    name: string;
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'privateKey';
    folder?: string;  // ID папки
    privateKeyPath?: string;
    password?: string;
    // Дополнительные SSH опции
    identityFile?: string;
    forwardAgent?: boolean;
    serverAliveInterval?: number;
    // SSH Gateway / Jump Host / Bastion
    gateway?: GatewayConfig;
}

export interface GatewayConfig {
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'privateKey';
    password?: string;
    privateKeyPath?: string;
}

export interface FolderConfig {
    id: string;  // Уникальный идентификатор папки
    name: string;
    parentFolder?: string;  // ID родительской папки
    color?: string;  // Цвет папки (hex)
    icon?: string;
}

export interface TunnelConfig {
    id: string;
    serverName: string;
    serverId: string;  // ID сервера для подключения
    localPort: number;
    remoteHost: string;
    remotePort: number;
    isActive: boolean;
    autoStart?: boolean;  // Автозапуск при старте VS Code
}

export interface SSHConfigData {
    servers: ServerConfig[];
    folders: FolderConfig[];
    tunnels?: TunnelConfig[];
    favorites?: SSHFavorite[];
}
