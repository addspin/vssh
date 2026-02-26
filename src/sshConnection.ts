import * as vscode from 'vscode';
import { ServerConfig } from './types';
import { SSHConfigManager } from './sshConfig';

export class SSHConnection {
    private server: ServerConfig;
    private terminal: vscode.Terminal | undefined;

    constructor(server: ServerConfig, _sshConfigManager: SSHConfigManager) {
        this.server = server;
    }

    async connect(): Promise<void> {
        const isWindows = process.platform === 'win32';

        if (isWindows) {
            try {
                const { execSync } = require('child_process');
                execSync('where ssh.exe', { stdio: 'ignore' });
            } catch {
                vscode.window.showErrorMessage(
                    'ssh.exe не найден. Установите OpenSSH Client в Windows: ' +
                    'Settings → Apps → Optional Features → Add "OpenSSH Client"'
                );
                return;
            }

            this.terminal = vscode.window.createTerminal({
                name: `SSH: ${this.server.name}`,
                shellPath: 'ssh.exe',
                shellArgs: this.buildWindowsArgs()
            });
        } else {
            const sshCommand = await this.buildUnixCommand();

            this.terminal = vscode.window.createTerminal({
                name: `SSH: ${this.server.name}`,
                shellPath: '/bin/bash',
                shellArgs: ['-c', sshCommand]
            });
        }

        this.terminal.show();
        vscode.window.showInformationMessage(
            `Подключение к ${this.server.name}${this.server.gateway ? ` через ${this.server.gateway.host}` : ''}...`
        );
    }

    // Строим массив аргументов для ssh.exe напрямую, без промежуточной строки.
    // Каждый элемент — отдельный аргумент процесса, поэтому ProxyCommand
    // (содержащий пробелы и свои флаги -i/-p) передаётся корректно.
    //
    // AddKeysToAgent=yes: ProxyCommand-процесс добавляет ключ в ssh-agent,
    // основное соединение берёт его оттуда — passphrase запрашивается один раз
    // (если OpenSSH Authentication Agent Service запущен в Windows).
    private buildWindowsArgs(): string[] {
        const args: string[] = [];

        // Ключ конечного сервера
        if (this.server.authMethod === 'privateKey' && this.server.privateKeyPath) {
            args.push('-i', this.server.privateKeyPath);
        }

        // Кешируем ключ в агент при первом использовании
        args.push('-o', 'AddKeysToAgent=yes');

        // Gateway через ProxyCommand
        if (this.server.gateway) {
            const gw = this.server.gateway;
            const proxyParts: string[] = ['ssh', '-o', 'AddKeysToAgent=yes'];

            if (gw.authMethod === 'privateKey' && gw.privateKeyPath) {
                proxyParts.push('-i', gw.privateKeyPath);
            }
            proxyParts.push('-p', gw.port.toString(), '-W', '%h:%p', `${gw.username}@${gw.host}`);

            // Значение ProxyCommand — единая строка, ssh.exe разберёт её сам
            args.push('-o', `ProxyCommand=${proxyParts.join(' ')}`);
        }

        if (this.server.port !== 22) {
            args.push('-p', this.server.port.toString());
        }

        args.push('-o', 'StrictHostKeyChecking=no');
        args.push(`${this.server.username}@${this.server.host}`);

        return args;
    }

    // Строим команду для bash на Unix/macOS
    private async buildUnixCommand(): Promise<string> {
        const sshArgs: string[] = [];

        if (this.server.authMethod === 'privateKey' && this.server.privateKeyPath) {
            sshArgs.push('-i', this.server.privateKeyPath);
        }

        if (this.server.gateway) {
            const gw = this.server.gateway;
            // macOS/Linux поддерживают -J (ProxyJump) нативно
            sshArgs.push('-J', `${gw.username}@${gw.host}:${gw.port}`);
        }

        sshArgs.push('-p', this.server.port.toString());
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
        sshArgs.push('-o', 'UserKnownHostsFile=/dev/null');
        sshArgs.push(`${this.server.username}@${this.server.host}`);

        if (this.server.authMethod === 'password' && this.server.password) {
            const hasSshpass = await this.checkSshpass();
            if (hasSshpass) {
                const escapedPassword = this.server.password.replace(/'/g, "'\\''");
                return `sshpass -p '${escapedPassword}' ssh ${sshArgs.join(' ')}`;
            }
        }

        return `ssh ${sshArgs.join(' ')}`;
    }

    private async checkSshpass(): Promise<boolean> {
        try {
            const { exec } = require('child_process');
            return await new Promise((resolve) => {
                exec('command -v sshpass', (error: any) => {
                    resolve(!error);
                });
            });
        } catch {
            return false;
        }
    }

    disconnect(): void {
        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = undefined;
        }
    }
}
