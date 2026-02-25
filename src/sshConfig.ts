import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ServerConfig, SSHConfigData, FolderConfig } from './types';

const VSSH_CONFIG_FILENAME = 'vssh-config.json';
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

// Генерация уникального ID
function generateId(): string {
    return crypto.randomBytes(16).toString('hex');
}

// Получаем ключ шифрования из системных переменных или генерируем
function getEncryptionKey(): Buffer {
    let keyString = process.env.VSSH_ENCRYPTION_KEY;
    
    if (!keyString) {
        const hostname = require('os').hostname();
        const home = process.env.HOME || process.env.USERPROFILE || '';
        keyString = `${hostname}-${home}-vssh-secret-key-2024`;
    }
    
    return crypto.createHash('sha256').update(keyString).digest();
}

function encrypt(text: string): string {
    try {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('Encryption error:', error);
        return text;
    }
}

function decrypt(encryptedText: string): string {
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 2) {
            return encryptedText;
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const key = getEncryptionKey();
        
        const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        return encryptedText;
    }
}

export class SSHConfigManager {
    private configPath: string;
    private data: SSHConfigData;

    constructor() {
        // Используем отдельный файл в директории ~/.vssh/
        // Поддержка Windows (USERPROFILE) и Unix (HOME)
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const vsshDir = path.join(homeDir, '.vssh');
        this.configPath = path.join(vsshDir, VSSH_CONFIG_FILENAME);
        this.data = { servers: [], folders: [], tunnels: [] };
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf-8');
                this.data = JSON.parse(content);

                // Расшифровываем пароли при загрузке (серверы и gateway)
                for (const server of this.data.servers) {
                    if (server.password && server.password.includes(':')) {
                        server.password = decrypt(server.password);
                    }
                    if (server.gateway && server.gateway.password && server.gateway.password.includes(':')) {
                        server.gateway.password = decrypt(server.gateway.password);
                    }
                }

                // Миграция: добавляем ID папкам если нет
                for (const folder of this.data.folders) {
                    if (!folder.id) {
                        folder.id = generateId();
                    }
                }
            }
        } catch (error) {
            console.error('Error loading vSSH config:', error);
            this.data = { servers: [], folders: [], tunnels: [], favorites: [], sessions: [] };
        }
        
        // Инициализируем favorites и sessions если нет
        if (!this.data.favorites) {
            this.data.favorites = [];
        }
        if (!this.data.sessions) {
            this.data.sessions = [];
        }
    }

    private save(): void {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Создаём копию данных для сохранения с зашифрованными паролями
            const dataToSave = {
                servers: this.data.servers.map(server => ({
                    ...server,
                    password: server.password ? encrypt(server.password) : undefined,
                    gateway: server.gateway ? {
                        ...server.gateway,
                        password: server.gateway.password ? encrypt(server.gateway.password) : undefined
                    } : undefined
                })),
                folders: this.data.folders.map(folder => ({
                    id: folder.id,
                    name: folder.name,
                    parentFolder: folder.parentFolder,
                    color: folder.color
                })),
                tunnels: this.data.tunnels || [],
                favorites: this.data.favorites || [],
                sessions: this.data.sessions || []
            };

            fs.writeFileSync(this.configPath, JSON.stringify(dataToSave, null, 2), 'utf-8');
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка сохранения конфигурации: ${error}`);
        }
    }

    getServers(): ServerConfig[] {
        return this.data.servers;
    }

    getFolders(): FolderConfig[] {
        return this.data.folders;
    }

    getFolder(folderId: string): FolderConfig | undefined {
        return this.data.folders.find(f => f.id === folderId);
    }

    async addServer(server: ServerConfig): Promise<void> {
        const existing = this.data.servers.find(s => s.name === server.name);
        if (existing) {
            vscode.window.showWarningMessage(`Сервер "${server.name}" уже существует`);
            return;
        }
        this.data.servers.push(server);
        this.save();
    }

    async updateServer(oldName: string, newConfig: ServerConfig): Promise<void> {
        const index = this.data.servers.findIndex(s => s.name === oldName);
        if (index === -1) {
            vscode.window.showErrorMessage(`Сервер "${oldName}" не найден`);
            return;
        }

        // Если имя изменилось, проверяем нет ли конфликта
        if (oldName !== newConfig.name) {
            const exists = this.data.servers.find(s => s.name === newConfig.name && s.name !== oldName);
            if (exists) {
                vscode.window.showWarningMessage(`Сервер "${newConfig.name}" уже существует`);
                return;
            }
        }

        this.data.servers[index] = newConfig;
        this.save();
    }

    async deleteServer(name: string): Promise<void> {
        this.data.servers = this.data.servers.filter(s => s.name !== name);
        this.save();
    }

    async addFolder(name: string, parentFolder?: string, color?: string): Promise<void> {
        // Проверяем есть ли папка с таким именем в той же родительской папке
        const existing = this.data.folders.find(f => 
            f.name === name && f.parentFolder === parentFolder
        );
        
        if (existing) {
            vscode.window.showWarningMessage(`Папка "${name}" уже существует в этой папке`);
            return;
        }
        
        this.data.folders.push({ id: generateId(), name, parentFolder, color });
        this.save();
    }

    // Получить полный путь папки
    getFolderPath(folderId: string): string {
        const folder = this.data.folders.find(f => f.id === folderId);
        if (!folder) return '';
        
        const parts = [folder.name];
        let current = folder.parentFolder;
        
        while (current) {
            const parent = this.data.folders.find(f => f.id === current);
            if (parent) {
                parts.unshift(parent.name);
                current = parent.parentFolder;
            } else {
                break;
            }
        }
        
        return parts.join('/');
    }

    // Проверка существования папки по полному пути
    folderExistsByPath(name: string, parentFolder?: string): boolean {
        return this.data.folders.some(f => f.name === name && f.parentFolder === parentFolder);
    }

    async moveFolder(folderId: string, parentFolder?: string): Promise<void> {
        const folder = this.data.folders.find(f => f.id === folderId);
        if (!folder) {
            return;
        }
        
        // Проверяем нет ли папки с таким именем в целевой папке
        const existing = this.data.folders.find(f => 
            f.name === folder.name && 
            f.parentFolder === parentFolder && 
            f.id !== folderId
        );
        
        if (existing) {
            vscode.window.showWarningMessage(`Папка "${folder.name}" уже существует в этой папке`);
            return;
        }
        
        folder.parentFolder = parentFolder;
        this.save();
    }

    async renameFolder(folderId: string, newName: string): Promise<void> {
        const folder = this.data.folders.find(f => f.id === folderId);
        if (!folder) {
            return;
        }
        
        // Проверяем нет ли папки с таким именем в той же папке
        const existing = this.data.folders.find(f => 
            f.name === newName && 
            f.parentFolder === folder.parentFolder && 
            f.id !== folderId
        );
        
        if (existing) {
            vscode.window.showWarningMessage(`Папка "${newName}" уже существует в этой папке`);
            return;
        }
        
        folder.name = newName;
        this.save();
    }

    async updateFolder(folder: FolderConfig): Promise<void> {
        const index = this.data.folders.findIndex(f => f.name === folder.name);
        if (index !== -1) {
            this.data.folders[index] = folder;
            this.save();
        }
    }

    async deleteFolder(folderId: string): Promise<void> {
        // Находим все подпапки (рекурсивно)
        const allChildFolders = this.getAllChildFolders(folderId);
        
        // Находим все серверы в удаляемой папке и подпапках
        const serversToDelete: string[] = [];
        for (const server of this.data.servers) {
            if (server.folder === folderId || allChildFolders.includes(server.folder || '')) {
                serversToDelete.push(server.name);
            }
        }
        
        // Удаляем серверы
        for (const serverName of serversToDelete) {
            this.data.servers = this.data.servers.filter(s => s.name !== serverName);
        }
        
        // Удаляем подпапки
        for (const childFolderId of allChildFolders) {
            this.data.folders = this.data.folders.filter(f => f.id !== childFolderId);
        }
        
        // Удаляем саму папку
        this.data.folders = this.data.folders.filter(f => f.id !== folderId);
        
        this.save();
    }

    private getAllChildFolders(folderId: string): string[] {
        const result: string[] = [];
        const directChildren = this.data.folders.filter(f => f.parentFolder === folderId);
        
        for (const child of directChildren) {
            result.push(child.id);
            const grandchildren = this.getAllChildFolders(child.id);
            result.push(...grandchildren);
        }
        
        return result;
    }

    async moveServer(name: string, folder?: string): Promise<void> {
        const server = this.data.servers.find(s => s.name === name);
        if (server) {
            server.folder = folder;
            this.save();
        }
    }

    async openConfigFile(): Promise<void> {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (!fs.existsSync(this.configPath)) {
                fs.writeFileSync(this.configPath, JSON.stringify({ servers: [], folders: [], tunnels: [] }, null, 2), 'utf-8');
            }
            const uri = vscode.Uri.file(this.configPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка открытия конфигурации: ${error}`);
        }
    }

    async importConfig(filePath: string): Promise<void> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            
            // Пробуем распарсить как JSON
            try {
                const imported = JSON.parse(content);
                if (imported.servers) {
                    this.data.servers = [...this.data.servers, ...imported.servers];
                }
                if (imported.folders) {
                    this.data.folders = [...this.data.folders, ...imported.folders];
                }
            } catch {
                // Если не JSON, пробуем распарсить как SSH config
                this.parseSSHConfigFile(content);
            }
            
            this.save();
            vscode.window.showInformationMessage('Конфигурация импортирована');
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка импорта: ${error}`);
        }
    }

    private parseSSHConfigFile(content: string): void {
        const lines = content.split('\n');
        let currentHost: any = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed) continue;

            const hostMatch = trimmed.match(/^Host\s+(.+)$/i);
            if (hostMatch) {
                if (currentHost && currentHost.name) {
                    this.data.servers.push(currentHost);
                }
                currentHost = {
                    name: hostMatch[1].trim(),
                    host: '',
                    port: 22,
                    username: '',
                    authMethod: 'privateKey' as const
                };
                continue;
            }

            if (currentHost) {
                const hostnameMatch = trimmed.match(/^HostName\s+(.+)$/i);
                if (hostnameMatch) currentHost.host = hostnameMatch[1].trim();

                const userMatch = trimmed.match(/^User\s+(.+)$/i);
                if (userMatch) currentHost.username = userMatch[1].trim();

                const portMatch = trimmed.match(/^Port\s+(\d+)$/i);
                if (portMatch) currentHost.port = parseInt(portMatch[1]);

                const identityMatch = trimmed.match(/^IdentityFile\s+(.+)$/i);
                if (identityMatch) {
                    currentHost.privateKeyPath = identityMatch[1].trim();
                    currentHost.authMethod = 'privateKey';
                }
            }
        }

        if (currentHost && currentHost.name) {
            this.data.servers.push(currentHost);
        }
    }

    async exportConfig(filePath: string): Promise<void> {
        try {
            // Экспортируем в формате SSH config для совместимости (legacy)
            let content = '# SSH Config generated by vSSH\n\n';

            for (const server of this.data.servers) {
                content += `Host ${server.name}\n`;
                content += `    HostName ${server.host}\n`;
                content += `    Port ${server.port}\n`;
                content += `    User ${server.username}\n`;
                
                if (server.authMethod === 'privateKey' && server.privateKeyPath) {
                    content += `    IdentityFile ${server.privateKeyPath}\n`;
                }
                
                if (server.folder) {
                    content += `    # Folder: ${server.folder}\n`;
                }
                
                content += '\n';
            }
            
            fs.writeFileSync(filePath, content, 'utf-8');
            vscode.window.showInformationMessage('Конфигурация экспортирована (legacy формат)');
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка экспорта: ${error}`);
        }
    }

    async exportVsshConfig(filePath: string, includePasswords: boolean = false): Promise<void> {
        try {
            // Экспортируем в оригинальном формате vSSH JSON
            const dataToExport = {
                servers: this.data.servers.map(server => ({
                    ...server,
                    // Если не включаем пароли - убираем их из экспорта
                    password: includePasswords ? server.password : undefined
                })),
                folders: this.data.folders,
                tunnels: this.data.tunnels || []
            };
            
            fs.writeFileSync(filePath, JSON.stringify(dataToExport, null, 2), 'utf-8');
            
            if (includePasswords) {
                vscode.window.showWarningMessage('Конфигурация экспортирована с ПАРОЛЯМИ в открытом виде! Будьте осторожны с этим файлом.');
            } else {
                vscode.window.showInformationMessage('Конфигурация vSSH экспортирована (без паролей)');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка экспорта: ${error}`);
        }
    }
}
