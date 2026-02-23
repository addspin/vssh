import * as vscode from 'vscode';
import { SSHSession, ServerConfig } from './types';
import * as crypto from 'crypto';

function generateId(): string {
    return crypto.randomBytes(16).toString('hex');
}

export class SessionManager {
    private sessions: SSHSession[] = [];
    private _onDidChangeSessions: vscode.EventEmitter<void> = new vscode.EventEmitter();
    readonly onDidChangeSessions: vscode.Event<void> = this._onDidChangeSessions.event;

    constructor(private sshConfigManager: any) {
        this.loadSessions();
    }

    private loadSessions(): void {
        const sessionsData = (this.sshConfigManager as any).data.sessions || [];
        this.sessions = sessionsData;
    }

    private saveSessions(): void {
        (this.sshConfigManager as any).data.sessions = this.sessions;
        (this.sshConfigManager as any).save();
    }

    async createSession(name: string): Promise<SSHSession> {
        const session: SSHSession = {
            id: generateId(),
            name,
            servers: [],
            savedAt: new Date().toISOString()
        };

        this.sessions.push(session);
        this.saveSessions();
        this._onDidChangeSessions.fire();

        vscode.window.showInformationMessage(`Сессия "${name}" создана`);
        return session;
    }

    async addServerToSession(sessionId: string, serverName: string): Promise<void> {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) {
            vscode.window.showErrorMessage('Сессия не найдена');
            return;
        }

        if (!session.servers.includes(serverName)) {
            session.servers.push(serverName);
            this.saveSessions();
            this._onDidChangeSessions.fire();
            vscode.window.showInformationMessage(`Сервер "${serverName}" добавлен в сессию "${session.name}"`);
        } else {
            vscode.window.showInformationMessage(`Сервер "${serverName}" уже в сессии`);
        }
    }

    async removeServerFromSession(sessionId: string, serverName: string): Promise<void> {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) {
            return;
        }

        session.servers = session.servers.filter(s => s !== serverName);
        this.saveSessions();
        this._onDidChangeSessions.fire();
    }

    async deleteSession(sessionId: string): Promise<void> {
        this.sessions = this.sessions.filter(s => s.id !== sessionId);
        this.saveSessions();
        this._onDidChangeSessions.fire();
    }

    getSessions(): SSHSession[] {
        return this.sessions;
    }

    async connectToSession(session: SSHSession): Promise<void> {
        const servers = this.sshConfigManager.getServers();
        
        for (const serverName of session.servers) {
            const server = servers.find((s: any) => s.name === serverName);
            if (server) {
                // Открываем терминал для каждого сервера
                const SSHConnection = require('./sshConnection').SSHConnection;
                const connection = new SSHConnection(server);
                await connection.connect();
            }
        }

        vscode.window.showInformationMessage(`Сессия "${session.name}" запущена: ${session.servers.length} серверов`);
    }

    dispose(): void {
        this._onDidChangeSessions.dispose();
    }
}
